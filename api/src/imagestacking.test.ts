import { afterAll, describe, expect, test } from 'bun:test'
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { SubframeQualityMetrics } from 'nebulosa/src/imaging/processing/subframe.selector'
import { type FitsHeader, writeFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSink } from 'nebulosa/src/io/io'
import type { ResolvePreview } from './calibrationlibrary'
import type { CalibrationMetadata } from './calibrationlibrary.compatibility'
import { AppDatabase } from './database'
import { createImageStackingRoutes, filterGroups, ImageStacking, type ImageStackingEvent, type StackingMasters } from './imagestacking'
import { type AnalysisMeasurement, type AnalysisWorkerRequest, type FrameAnalyzer, readDigital, registerInThread, StackingAnalyzer } from './imagestacking.analysis'
import { type FrameCompositor, StackingCompositor } from './imagestacking.composition'
import { type FrameIntegrator, integrationPlan } from './imagestacking.integration'
import { cohortKeyOf, filterKeyOf, filterSynonyms, isWithin, lightRoleOf } from './imagestacking.sources'
import { COMPOSITE_FILE, ImageStackingStore, PRODUCT_COVERAGE_FILE, PRODUCT_MASTER_FILE, type StackingComposition, type StackingProduct, type StackingSourceFacts, type StackingStar } from './imagestacking.store'

const SKIP = process.env.RUN_ALL_TESTS !== 'true'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-stacking-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const WIDTH = 8
const HEIGHT = 6

// Writes a 16-bit FITS file of a constant level and returns its path.
async function writeFrame(path: string, keywords: FitsHeader = {}) {
	const header: FitsHeader = { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: WIDTH, NAXIS2: HEIGHT, BZERO: 32768, BSCALE: 1, ...keywords }
	const raw = new Float64Array(WIDTH * HEIGHT).fill(0.1)
	const buffer = Buffer.alloc(8 * 2880 + WIDTH * HEIGHT * 2)
	const sink = bufferSink(buffer)
	await writeFits(sink, [{ header, raw }], { type: false })
	writeFileSync(path, buffer.subarray(0, sink.position))
	return path
}

// Writes a 16-bit light of 96 × 96 pixels with Gaussian stars at the given centers over a flat sky.
async function writeStars(path: string, stars: readonly (readonly [number, number])[], keywords: FitsHeader = {}) {
	const size = 96
	const raw = new Float64Array(size * size)

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let value = 0.05 + ((x * 7 + y * 13) % 5) * 0.0004
			for (const [cx, cy] of stars) value += 0.5 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 1.5 ** 2))
			raw[y * size + x] = value
		}
	}

	const header: FitsHeader = { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: size, NAXIS2: size, BZERO: 32768, BSCALE: 1, IMAGETYP: 'Light Frame', ...keywords }
	const buffer = Buffer.alloc(8 * 2880 + size * size * 2)
	const sink = bufferSink(buffer)
	await writeFits(sink, [{ header, raw }], { type: false })
	writeFileSync(path, buffer.subarray(0, sink.position))
	return path
}

// A light of the usual test camera through a filter.
function light(filter: string | undefined, extra: FitsHeader = {}): FitsHeader {
	return { IMAGETYP: 'Light Frame', INSTRUME: 'Test Camera', GAIN: 100, OFFSET: 50, XBINNING: 1, YBINNING: 1, EXPTIME: 300, OBJECT: 'NGC 7000', ...(filter !== undefined && { FILTER: filter }), ...extra }
}

function directory(name: string) {
	return mkdtempSync(join(root, `${name}-`))
}

// A library offering a preferred dark and flat to frames of the declared camera, and asking a review otherwise. Pins
// resolve while their master is available; leases are counted.
function masters() {
	const available = new Set(['dark', 'flat'])
	const leases = { held: 0, taken: 0 }
	const candidate = (kind: 'dark' | 'flat', verdict: 'compatible' | 'reviewRequired') => ({ masterId: kind, revision: 1, kind, contentDigest: `${kind}-digest`, status: 'ready' as const, preferred: true, verdict, reasons: [] })

	const library: StackingMasters = {
		resolvePreview: (target): Promise<ResolvePreview> => {
			const verdict = target.cameraId === 'camera' ? 'compatible' : 'reviewRequired'
			return Promise.resolve({ candidates: [candidate('dark', verdict), candidate('flat', verdict)], missingKinds: [] })
		},
		pinnedMaster: ({ masterId }) => Promise.resolve(available.has(masterId) ? { path: join(root, `${masterId}.fit`), units: masterId === 'flat' ? 'dimensionless' : 'DN', fullScaleDn: 65535 } : undefined),
		lease: () => {
			leases.held++
			leases.taken++
			let released = false

			return () => {
				if (!released) leases.held--
				released = true
			}
		},
	}

	return { library, available, leases }
}

// Deterministic uniform numbers in [0, 1).
function random(seed: number) {
	let state = seed >>> 0

	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

// Stars of a field of 40, shifted by pixels; another seed is another field.
function field(dx: number, dy: number, seed = 1): StackingStar[] {
	const next = random(seed)
	return Array.from({ length: 40 }, () => ({ x: 50 + next() * 900 + dx, y: 50 + next() * 900 + dy, flux: 1 + next() * 100, hfd: 3, snr: 30 }))
}

// Quality of a measured frame, with a score that ranks references.
function quality(qualityScore = 100): SubframeQualityMetrics {
	return { starCount: 40, medianSNR: 30, medianHFD: 3, qualityScore, estimatedBackground: 0.01, noise: 0.001, normalizedScore: 0.8 }
}

// Analyzer that answers by file name without reading files, and records every request.
function analyzer(measurements: Record<string, AnalysisMeasurement>, during: () => void = () => undefined) {
	const requests: AnalysisWorkerRequest[] = []

	const fake: FrameAnalyzer = {
		analyze: (request, onMeasured) => {
			requests.push(request)
			during()
			for (const frame of request.frames) onMeasured(frame.sourceId, measurements[basename(frame.path)] ?? { error: 'The frame could not be measured' })
			return Promise.resolve()
		},
		register: registerInThread,
	}

	return { fake, requests }
}

// A service over a database and a managed directory of its own.
function open(library: StackingMasters = masters().library, frameAnalyzer?: FrameAnalyzer, frameIntegrator?: FrameIntegrator, frameCompositor?: FrameCompositor) {
	const events: ImageStackingEvent[] = []
	const managed = directory('managed')
	const stacking = new ImageStacking(new ImageStackingStore(AppDatabase.memory(), managed), (event) => events.push(event), library, [managed], frameAnalyzer, frameIntegrator, frameCompositor)
	return { stacking, events, managed }
}

// Waits until a job ends, and returns it.
async function settled(stacking: ImageStacking, jobId: string) {
	for (let attempt = 0; attempt < 500; attempt++) {
		const job = await stacking.job(jobId)
		if (job.state !== 'scanning' && job.state !== 'analyzing' && job.state !== 'integrating' && job.state !== 'composing') return job
		await Bun.sleep(10)
	}

	throw new Error('The job never ended')
}

// Imports paths into a project and commits everything usable.
async function importAll(stacking: ImageStacking, projectId: string, paths: readonly string[], lights?: Record<string, { readonly reason: string }>) {
	const job = await stacking.startImport(projectId, { paths })
	expect((await settled(stacking, job.jobId)).state).toBe('completed')
	return stacking.commitImport(job.jobId, { lights })
}

// Contents of every file under a directory, by name, to prove nothing was written.
function contents(path: string) {
	return Object.fromEntries(readdirSync(path, { recursive: true, withFileTypes: true }).flatMap((entry) => (entry.isFile() ? [[join(entry.parentPath, entry.name), readFileSync(join(entry.parentPath, entry.name)).toString('base64')]] : [])))
}

// Metadata with every value unknown but the ones given.
function metadata(patch: Partial<CalibrationMetadata> = {}): CalibrationMetadata {
	const unknown = { evidence: 'unknown' } as const
	return { cameraId: unknown, exposure: unknown, setTemperature: unknown, sensorTemperature: unknown, gain: unknown, offset: unknown, binX: unknown, binY: unknown, readoutMode: unknown, filter: unknown, telescope: unknown, focalLength: unknown, width: 10, height: 10, channels: 1, bitpix: 16, ...patch }
}

describe('light frame facts', () => {
	test('filter keys compare spelling variants only, and synonyms are suggested apart', () => {
		expect(filterKeyOf('  Ha ')).toBe('ha')
		expect(filterKeyOf('H Alpha')).toBe('h alpha')
		expect(filterKeyOf('ＯＩＩＩ')).toBe('oiii')
		expect(filterKeyOf(undefined)).toBe('')
		expect(filterKeyOf('   ')).toBe('')
		expect(filterSynonyms('ha', 'h-alpha')).toBeTrue()
		expect(filterSynonyms('hα', 'ha')).toBeTrue()
		expect(filterSynonyms('ha', 'oiii')).toBeFalse()
		expect(filterSynonyms('ha', 'ha')).toBeFalse()
		expect(filterSynonyms('', 'ha')).toBeFalse()
	})

	test('cohorts separate acquisition settings and keep unknown values apart', () => {
		const base = metadata({ gain: { value: 100, evidence: 'verified' }, exposure: { value: 300000000, evidence: 'verified' } })
		expect(cohortKeyOf(base)).toBe(cohortKeyOf({ ...base, filter: { value: 'Ha', evidence: 'verified' } }))
		expect(cohortKeyOf(base)).not.toBe(cohortKeyOf({ ...base, exposure: { value: 600000000, evidence: 'verified' } }))
		expect(cohortKeyOf(base)).not.toBe(cohortKeyOf({ ...base, gain: { evidence: 'unknown' } }))
	})

	test('roles come from the header: lights, unclassified files, and refused calibration frames', () => {
		expect(lightRoleOf({ rejectedRole: 'light' })).toEqual({ role: 'light' })
		expect(lightRoleOf({})).toEqual({ role: 'unclassified' })
		expect(lightRoleOf({ kind: 'dark' })).toEqual({ rejected: 'A dark frame, not a light frame' })
		expect(lightRoleOf({ rejectedRole: 'master' })).toEqual({ rejected: 'An integrated master, not a light frame' })
	})

	test('managed directories hold their own subdirectories but not their siblings', () => {
		const base = join(root, 'data')
		expect(isWithin(join(base, 'image-stacking', 'products'), [join(base, 'image-stacking')])).toBeTrue()
		expect(isWithin(join(base, 'image-stacking'), [join(base, 'image-stacking')])).toBeTrue()
		expect(isWithin(join(base, 'image-stacking-old'), [join(base, 'image-stacking')])).toBeFalse()
		expect(isWithin(base, [join(base, 'image-stacking')])).toBeFalse()
	})
})

describe('filter groups', () => {
	const fact = (filterKey: string, patch: Partial<StackingSourceFacts> = {}): StackingSourceFacts => ({ role: 'light', status: 'available', filterKey, filterName: filterKey.toUpperCase(), cohortKey: 'c', object: 'M31', exposure: 60000000, excluded: false, ...patch })

	test('aliases merge keys, the usable lights count toward exposure, and unassigned comes last', () => {
		const groups = filterGroups([fact('ha'), fact('h-alpha', { filterName: 'H-alpha' }), fact('ha', { excluded: true }), fact('ha', { status: 'missing' }), fact('oiii', { cohortKey: 'd' }), fact('', { filterName: undefined }), fact('ha', { role: 'unclassified' })], [{ filterKey: 'h-alpha', targetKey: 'ha' }])
		expect(groups.map((group) => group.key)).toEqual(['ha', 'oiii', ''])
		const [ha, oiii, unassigned] = groups
		expect(ha).toMatchObject({ name: 'HA', filterKeys: ['h-alpha', 'ha'], names: ['H-alpha', 'HA'], frames: 4, usable: 2, unavailable: 1, exposure: 120, cohorts: 1, objects: ['M31'] })
		expect(ha.keyNames).toEqual({ ha: ['HA'], 'h-alpha': ['H-alpha'] })
		expect(oiii.cohorts).toBe(1)
		expect(unassigned).toMatchObject({ name: 'Unassigned', frames: 1 })
	})

	test('synonyms are suggested, never merged', () => {
		const groups = filterGroups([fact('ha'), fact('h-alpha')], [])
		expect(groups).toHaveLength(2)
		expect(groups.find((group) => group.key === 'ha')?.suggestion).toBe('h-alpha')
	})
})

describe('image stacking projects', () => {
	test('imports lights by reference, refuses calibration frames, and counts one file once', async () => {
		const { stacking, events } = open()
		const folder = directory('lights')
		mkdirSync(join(folder, 'night1'))
		mkdirSync(join(folder, 'night2'))
		await writeFrame(join(folder, 'night1', 'frame.fit'), light('Ha'))
		await writeFrame(join(folder, 'night2', 'frame.fit'), light('H-alpha'))
		await writeFrame(join(folder, 'night2', 'oiii.fits'), light('OIII'))
		await writeFrame(join(folder, 'dark.fit'), { IMAGETYP: 'Dark Frame' })
		await writeFrame(join(folder, 'mystery.fit'), { FILTER: 'Ha' })
		writeFileSync(join(folder, 'broken.fit'), 'not a FITS file')
		linkSync(join(folder, 'night1', 'frame.fit'), join(folder, 'same-file.fit'))
		const before = contents(folder)

		const project = await stacking.createProject({ name: ' NGC 7000 ' })
		expect(project.name).toBe('NGC 7000')
		const job = await stacking.startImport(project.projectId, { paths: [folder] })
		expect(JSON.stringify(job)).not.toContain(folder)
		const ended = await settled(stacking, job.jobId)
		expect(ended.state).toBe('completed')
		expect(ended.found).toBe(6)
		expect([ended.lights, ended.unclassified]).toEqual([3, 1])
		expect(stacking.importCandidates(job.jobId, 4, 2)).toMatchObject({ total: 6, items: [{}, {}] })

		const { items } = stacking.importCandidates(job.jobId, 0, 50)
		const byName = Object.fromEntries(items.map((item) => [item.name, item]))
		expect(byName[join('night1', 'frame.fit')]).toMatchObject({ role: 'light', filter: 'Ha', object: 'NGC 7000', known: false })
		expect(byName[join('night2', 'frame.fit')].role).toBe('light')
		expect(byName['dark.fit'].rejected).toContain('dark')
		expect(byName['mystery.fit'].role).toBe('unclassified')
		expect(byName['broken.fit'].error).toBeDefined()
		expect(Object.keys(byName)).not.toContain('same-file.fit')

		const { committed } = await stacking.commitImport(job.jobId, {})
		expect(committed).toBe(4)
		expect(contents(folder)).toEqual(before)
		expect(events.some((event) => event.type === 'imageStacking:changed' && JSON.stringify(event).includes(folder))).toBeFalse()

		const summary = await stacking.project(project.projectId)
		expect(summary).toMatchObject({ frames: 4, lights: 3, unclassified: 1, filters: 3, unassigned: 0, exposure: 900, objects: ['NGC 7000'] })

		// The same files again are already known, so nothing enters twice.
		expect(await importAll(stacking, project.projectId, [folder])).toEqual({ committed: 0 })
		await expect(stacking.commitImport(job.jobId, {})).rejects.toThrow('cannot be committed')
	})

	test('single files can be imported, and unclassified files declared lights with a reason', async () => {
		const { stacking } = open()
		const folder = directory('single')
		const mystery = await writeFrame(join(folder, 'mystery.fit'), { FILTER: 'L', EXPTIME: 60 })
		const project = await stacking.createProject({ name: 'M31' })

		expect(await importAll(stacking, project.projectId, [mystery], { [mystery]: { reason: 'Taken as lights by the session log' } })).toEqual({ committed: 1 })
		const [frame] = (await stacking.frames(project.projectId, {}, 0, 50)).items
		expect(frame.role).toBe('light')
		expect(frame.warnings.at(-1)).toContain('session log')
		expect(frame).not.toHaveProperty('path')
		expect((await stacking.frame(frame.sourceId)).path).toBe(mystery)
	})

	test('directories of Nebulosa and missing paths are refused', async () => {
		const { stacking, managed } = open()
		const project = await stacking.createProject({ name: 'Refused' })
		mkdirSync(join(managed, 'products'))
		await expect(stacking.startImport(project.projectId, { paths: [join(managed, 'products')] })).rejects.toThrow('files of Nebulosa')
		await expect(stacking.startImport(project.projectId, { paths: [join(root, 'nowhere')] })).rejects.toThrow('cannot be read')
		await expect(stacking.startImport('unknown', { paths: [root] })).rejects.toThrow('Unknown project')
	})

	test('filters are declared only when unknown, merged by alias, and listed by group', async () => {
		const { stacking } = open()
		const folder = directory('aliases')
		await writeFrame(join(folder, 'a.fit'), light('Ha'))
		await writeFrame(join(folder, 'b.fit'), light('H-alpha'))
		await writeFrame(join(folder, 'c.fit'), light('OIII'))
		await writeFrame(join(folder, 'd.fit'), light(undefined))
		const project = await stacking.createProject({ name: 'Veil' })
		await importAll(stacking, project.projectId, [folder])

		const unassigned = (await stacking.frames(project.projectId, { group: '' }, 0, 50)).items
		expect(unassigned.map((frame) => frame.name)).toEqual(['d.fit'])
		const [verified] = (await stacking.frames(project.projectId, { group: 'ha' }, 0, 50)).items
		await expect(stacking.updateFrame(verified.sourceId, { filter: { value: 'OIII', reason: 'No' } })).rejects.toThrow('does not name')

		const declared = await stacking.updateFrame(unassigned[0].sourceId, { filter: { value: ' OIII ', reason: 'Wheel slot 3 all night' } })
		expect(declared.metadata.filter).toEqual({ value: 'OIII', evidence: 'operatorDeclared' })
		expect(declared.filterKey).toBe('oiii')

		let groups = await stacking.groups(project.projectId)
		expect(groups.map((group) => [group.key, group.frames, group.suggestion])).toEqual([
			['h-alpha', 1, 'ha'],
			['ha', 1, 'h-alpha'],
			['oiii', 2, undefined],
		])

		groups = await stacking.setAlias(project.projectId, { filterKey: 'h-alpha', targetKey: 'ha' })
		expect(groups.map((group) => [group.key, group.frames])).toEqual([
			['ha', 2],
			['oiii', 2],
		])
		expect((await stacking.frames(project.projectId, { group: 'ha' }, 0, 50)).total).toBe(2)
		expect((await stacking.frames(project.projectId, { group: 'h-alpha' }, 0, 50)).total).toBe(0)

		// Merging the target elsewhere carries what was merged into it.
		await stacking.setAlias(project.projectId, { filterKey: 'ha', targetKey: 'oiii' })
		expect((await stacking.project(project.projectId)).aliases).toEqual([
			{ filterKey: 'h-alpha', targetKey: 'oiii' },
			{ filterKey: 'ha', targetKey: 'oiii' },
		])
		await expect(stacking.setAlias(project.projectId, { filterKey: 'oiii', targetKey: 'ha' })).rejects.toThrow('into itself')
		await expect(stacking.setAlias(project.projectId, { filterKey: 'sii', targetKey: 'ha' })).rejects.toThrow('must name lights')

		groups = await stacking.removeAlias(project.projectId, 'ha')
		expect(groups.map((group) => [group.key, group.frames])).toEqual([
			['ha', 1],
			['oiii', 3],
		])
	})

	test('frames are left out and back, taken out of the project, and compared with the disk', async () => {
		const { stacking } = open()
		const folder = directory('states')
		const kept = await writeFrame(join(folder, 'a.fit'), light('L'))
		const moved = await writeFrame(join(folder, 'b.fit'), light('L'))
		const edited = await writeFrame(join(folder, 'c.fit'), light('L'))
		const project = await stacking.createProject({ name: 'States' })
		await importAll(stacking, project.projectId, [folder])
		const ids = Object.fromEntries((await stacking.frames(project.projectId, {}, 0, 50)).items.map((frame) => [frame.name, frame.sourceId]))

		expect((await stacking.updateFrame(ids['a.fit'], { excluded: 'Clouds' })).excluded).toBe('Clouds')
		expect((await stacking.frames(project.projectId, { included: false }, 0, 50)).total).toBe(1)
		expect((await stacking.updateFrame(ids['a.fit'], { excluded: null })).excluded).toBeUndefined()

		rmSync(moved)
		writeFileSync(edited, 'changed')
		await stacking.refresh(project.projectId)
		const states = Object.fromEntries((await stacking.frames(project.projectId, {}, 0, 50)).items.map((frame) => [frame.name, frame.status]))
		expect(states).toEqual({ 'a.fit': 'available', 'b.fit': 'missing', 'c.fit': 'changed' })
		expect((await stacking.groups(project.projectId))[0]).toMatchObject({ frames: 3, usable: 1, unavailable: 2 })

		await stacking.removeFrame(ids['b.fit'])
		expect((await stacking.project(project.projectId)).frames).toBe(2)
		expect(readdirSync(folder)).toEqual(['a.fit', 'c.fit'])
		expect(readFileSync(kept).length).toBeGreaterThan(0)
	})

	test('a rename needs the revision it was edited from, and a deletion keeps the files', async () => {
		const { stacking } = open()
		const folder = directory('project')
		await writeFrame(join(folder, 'a.fit'), light('R'))
		const project = await stacking.createProject({ name: 'First' })
		await importAll(stacking, project.projectId, [folder])

		const renamed = await stacking.updateProject(project.projectId, { name: 'Second', revision: 1 })
		expect(renamed).toMatchObject({ name: 'Second', revision: 2 })
		expect((await stacking.frames(project.projectId, {}, 0, 50)).total).toBe(1)
		await expect(stacking.updateProject(project.projectId, { name: 'Third', revision: 1 })).rejects.toThrow('changed meanwhile')

		await stacking.deleteProject(project.projectId)
		expect(stacking.snapshot().projects).toEqual([])
		expect(readdirSync(folder)).toEqual(['a.fit'])
	})

	test('a scan can be cancelled', async () => {
		const { stacking } = open()
		const folder = directory('cancel')
		for (let i = 0; i < 20; i++) await writeFrame(join(folder, `${i}.fit`), light('G'))
		const project = await stacking.createProject({ name: 'Cancel' })
		const job = await stacking.startImport(project.projectId, { paths: [folder] })
		stacking.cancel(job.jobId)
		expect((await settled(stacking, job.jobId)).state).toBe('cancelled')
		expect(() => stacking.cancel(job.jobId)).toThrow('has ended')
	})
})

describe('calibration and registration planning', () => {
	// Imports three Ha lights of 300 s and two OIII lights of 600 s into a new project.
	async function project(stacking: ImageStacking) {
		const folder = directory('planning')
		for (const name of ['ha0', 'ha1', 'ha2']) await writeFrame(join(folder, `${name}.fit`), light('Ha'))
		for (const name of ['o0', 'o1']) await writeFrame(join(folder, `${name}.fit`), light('OIII', { EXPTIME: 600 }))
		const { projectId } = await stacking.createProject({ name: 'Veil' })
		await importAll(stacking, projectId, [folder])
		const ids = Object.fromEntries((await stacking.frames(projectId, {}, 0, 50)).items.map((frame) => [frame.name.replace('.fit', ''), frame.sourceId]))
		return { projectId, ids }
	}

	// Measurements of one field: Ha frames shifted a little, ha1 the sharpest, and OIII frames of the same field or another.
	function measurements(oiiiSeed = 1): Record<string, AnalysisMeasurement> {
		return {
			'ha0.fit': { digest: 'a', quality: quality(), stars: field(0, 0) },
			'ha1.fit': { digest: 'b', quality: quality(200), stars: field(5, -3) },
			'ha2.fit': { digest: 'c', quality: quality(), stars: field(-4, 7) },
			'o0.fit': { digest: 'd', quality: quality(), stars: field(12, 4, oiiiSeed) },
			'o1.fit': { digest: 'e', quality: quality(), stars: field(10, 6, oiiiSeed) },
		}
	}

	// Decides both cohorts: Ha pinned to the suggested masters under the declared camera, OIII not calibrated.
	async function decide(stacking: ImageStacking, projectId: string) {
		const [ha, oiii] = await stacking.cohorts(projectId)
		const declared = await stacking.updateCohort(projectId, ha.cohortId, { camera: { id: 'camera', reason: 'The only camera of this rig' } })
		await stacking.updateCohort(projectId, ha.cohortId, { calibration: { kind: 'masters', ...declared.suggested } })
		await stacking.updateCohort(projectId, oiii.cohortId, { calibration: { kind: 'none', reason: 'No flats through OIII yet' } })
		return { ha: declared, oiii }
	}

	test('cohorts are calibrated only with revisions compatible under the declared camera', async () => {
		const { stacking } = open()
		const { projectId } = await project(stacking)
		const [ha, oiii] = await stacking.cohorts(projectId)
		expect([ha.groupName, ha.frames, ha.target.exposure, oiii.groupName, oiii.frames, oiii.target.exposure]).toEqual(['Ha', 3, 300, 'OIII', 2, 600])
		expect(ha.candidates).toEqual([])
		expect(ha.reviewCandidates).toBe(2)
		await expect(stacking.updateCohort(projectId, ha.cohortId, { calibration: { kind: 'masters', dark: { masterId: 'dark', revision: 1, digest: 'dark-digest' } } })).rejects.toThrow('not a compatible revision')

		const declared = await stacking.updateCohort(projectId, ha.cohortId, { camera: { id: 'camera', reason: 'The only camera of this rig' } })
		expect(declared).toMatchObject({ cameraId: 'camera', cameraReason: 'The only camera of this rig' })
		expect(declared.suggested).toEqual({ dark: { masterId: 'dark', revision: 1, digest: 'dark-digest' }, flat: { masterId: 'flat', revision: 1, digest: 'flat-digest' } })
		await expect(stacking.updateCohort(projectId, ha.cohortId, { calibration: { kind: 'masters', dark: { masterId: 'dark', revision: 1, digest: 'other' } } })).rejects.toThrow('not a compatible revision')
		await expect(stacking.updateCohort(projectId, ha.cohortId, { calibration: { kind: 'masters' } })).rejects.toThrow('at least one master')

		const pinned = await stacking.updateCohort(projectId, ha.cohortId, { calibration: { kind: 'masters', ...declared.suggested } })
		expect(pinned.calibration).toEqual({ kind: 'masters', ...declared.suggested })
		await expect(stacking.startAnalysis(projectId)).rejects.toThrow('OIII frames are calibrated')

		await stacking.updateCohort(projectId, oiii.cohortId, { calibration: { kind: 'none', reason: 'No flats through OIII yet' } })
		const { findings, ready, samples, memoryBytes } = await stacking.validate(projectId)
		expect(ready).toBeFalse()
		expect(findings.map(({ severity, code, groupKey }) => [severity, code, groupKey])).toEqual([
			['review', 'cameraUndeclared', 'oiii'],
			['review', 'noCalibration', 'oiii'],
			['blocker', 'analysisStale', 'ha'],
			['blocker', 'analysisStale', 'oiii'],
		])
		expect([samples, memoryBytes]).toEqual([WIDTH * HEIGHT, WIDTH * HEIGHT * 26])
	})

	test('an analysis measures stale frames with leased masters, registers every group, and resumes', async () => {
		const library = masters()
		let held = 0
		const { fake, requests } = analyzer(measurements(), () => (held = library.leases.held))
		const { stacking } = open(library.library, fake)
		const { projectId, ids } = await project(stacking)
		const { ha } = await decide(stacking, projectId)

		const job = await stacking.startAnalysis(projectId)
		expect(job).toMatchObject({ type: 'analysis', state: 'analyzing', found: 5 })
		expect(await settled(stacking, job.jobId)).toMatchObject({ state: 'completed', measured: 5, failures: 0 })
		expect([held, library.leases.held, library.leases.taken]).toEqual([1, 0, 1])
		expect(requests[0].calibrations[ha.cohortId]).toEqual({ dark: { path: join(root, 'dark.fit'), fullScale: 65535 }, flat: { path: join(root, 'flat.fit'), fullScale: 1 } })

		const { analysis } = await stacking.project(projectId)
		expect(analysis?.groups.ha.referenceSourceId).toBe(ids.ha1)
		expect(analysis?.groups.oiii.toProject?.success).toBeTrue()
		const frames = (await stacking.frames(projectId, {}, 0, 50)).items
		expect(frames.every((frame) => frame.analysis?.registration?.success && !frame.stale && !('stars' in frame.analysis))).toBeTrue()
		const shifted = frames.find((frame) => frame.sourceId === ids.ha0)?.analysis?.registration
		expect(shifted?.success && [Math.round(shifted.transform.summary.translationX), Math.round(shifted.transform.summary.translationY)]).toEqual([5, -3])
		expect((await stacking.validate(projectId)).ready).toBeTrue()

		const again = await stacking.startAnalysis(projectId)
		expect(await settled(stacking, again.jobId)).toMatchObject({ state: 'completed', found: 0 })
		expect(requests).toHaveLength(1)

		await stacking.updateSettings(projectId, { references: { ha: ids.ha2 }, selection: { minMedianSNR: 50 } })
		const moved = await stacking.validate(projectId)
		expect(moved.findings.find((finding) => finding.groupKey === 'ha')).toMatchObject({ severity: 'blocker', code: 'analysisStale' })
		await settled(stacking, (await stacking.startAnalysis(projectId)).jobId)
		expect((await stacking.project(projectId)).analysis?.groups.ha.referenceSourceId).toBe(ids.ha2)
		expect((await stacking.validate(projectId)).findings.filter((finding) => finding.code === 'belowThresholds' || finding.code === 'noLights').map(({ code, groupKey }) => [code, groupKey])).toEqual([
			['belowThresholds', 'ha'],
			['noLights', 'ha'],
			['belowThresholds', 'oiii'],
			['noLights', 'oiii'],
		])
		expect((await stacking.frames(projectId, {}, 0, 50)).items[0].rejected).toEqual(['median-snr-too-low'])

		await stacking.updateCohort(projectId, ha.cohortId, { calibration: { kind: 'masters', flat: ha.suggested.flat } })
		const stale = (await stacking.validate(projectId)).findings.find((finding) => finding.code === 'analysisStale')
		expect([stale?.groupKey, stale?.sourceIds?.toSorted()]).toEqual(['ha', [ids.ha0, ids.ha1, ids.ha2].sort()])
		expect((await stacking.frames(projectId, { group: 'ha' }, 0, 50)).items.every((frame) => frame.stale)).toBeTrue()

		library.available.delete('flat')
		await expect(stacking.startAnalysis(projectId)).rejects.toThrow('no longer available as pinned')
		expect((await stacking.validate(projectId)).findings.some((finding) => finding.code === 'masterUnavailable')).toBeTrue()
	})

	test('a group that does not register onto the project reference fails alone', async () => {
		const { fake } = analyzer(measurements(99))
		const { stacking } = open(masters().library, fake)
		const { projectId } = await project(stacking)
		await decide(stacking, projectId)
		await stacking.updateSettings(projectId, { referenceGroup: 'ha', references: {}, selection: {} })
		await settled(stacking, (await stacking.startAnalysis(projectId)).jobId)

		const { analysis } = await stacking.project(projectId)
		expect([analysis?.referenceGroup, analysis?.groups.ha.toProject?.success, analysis?.groups.oiii.toProject?.success]).toEqual(['ha', true, false])
		const blockers = (await stacking.validate(projectId)).findings.filter((finding) => finding.severity === 'blocker')
		expect(blockers.map(({ code, groupKey }) => [code, groupKey])).toEqual([['registrationFailed', 'oiii']])
	})

	test('a cancelled run keeps the masters it published, and no analysis starts while it works', async () => {
		const { fake } = analyzer(measurements())

		const slow: FrameIntegrator = {
			integrate: async (request, handlers, signal) => {
				const [group] = request.groups
				const directory = join(group.staging, 'product')
				mkdirSync(directory, { recursive: true })
				writeFileSync(join(directory, PRODUCT_MASTER_FILE), 'master')
				writeFileSync(join(directory, PRODUCT_COVERAGE_FILE), 'coverage')
				handlers.onStaged({ group: group.key, directory, contentDigest: 'm', bytes: 6, coverageDigest: 'c', coverageBytes: 8, channels: 1, diagnostics: { mode: 'online', coverageThreshold: 1, coveredPixels: 48, normalization: [] } })
				const aborted = Promise.withResolvers<void>()
				signal.addEventListener('abort', () => aborted.resolve(), { once: true })
				await aborted.promise
				signal.throwIfAborted()
			},
		}

		const { stacking } = open(masters().library, fake, slow)
		const { projectId } = await project(stacking)
		await decide(stacking, projectId)
		await settled(stacking, (await stacking.startAnalysis(projectId)).jobId)
		const { run } = await stacking.startRun(projectId, { token: 'cancel' })
		await expect(stacking.startAnalysis(projectId)).rejects.toThrow('Another analysis or integration')
		await Bun.sleep(20)
		stacking.cancel(run.runId)
		expect(await settled(stacking, run.runId)).toMatchObject({ state: 'cancelled', published: 1 })

		const [saved] = await stacking.runs(projectId)
		expect(saved.state).toBe('cancelled')
		expect(saved.groups.map((group) => group.productId !== undefined)).toEqual([true, false])
		expect((await stacking.products(projectId)).map((product) => product.groupKey)).toEqual([saved.groups[0].groupKey])
	})

	test('an analysis is refused while another runs and can be cancelled, keeping what it measured', async () => {
		const slow: FrameAnalyzer = {
			analyze: async (request, onMeasured, signal) => {
				onMeasured(request.frames[0].sourceId, { error: 'The frame could not be measured' })
				const aborted = Promise.withResolvers<void>()
				signal.addEventListener('abort', () => aborted.resolve(), { once: true })
				await aborted.promise
				signal.throwIfAborted()
			},
			register: registerInThread,
		}

		const { stacking } = open(masters().library, slow)
		const { projectId } = await project(stacking)
		await decide(stacking, projectId)
		const job = await stacking.startAnalysis(projectId)
		await expect(stacking.startAnalysis(projectId)).rejects.toThrow('Another analysis')
		stacking.cancel(job.jobId)
		expect(await settled(stacking, job.jobId)).toMatchObject({ state: 'cancelled', measured: 1, failures: 1 })
		expect((await stacking.frames(projectId, {}, 0, 50)).items.filter((frame) => frame.analysis?.error)).toHaveLength(1)
	})
})

describe('integration and publication', () => {
	// Stars of the field of the integration tests.
	const STARS = [
		[20, 20],
		[70, 25],
		[30, 70],
		[75, 75],
		[50, 48],
		[15, 50],
		[82, 50],
		[48, 12],
		[60, 62],
		[35, 38],
	] as const

	// A project of three L frames of one field shifted by a few pixels, imported, not calibrated, and analyzed.
	async function analyzed(stacking: ImageStacking) {
		const folder = directory('integrate')
		const shifts = [
			[0, 0],
			[3, -2],
			[-2, 4],
		] as const

		for (const [index, [dx, dy]] of shifts.entries()) {
			await writeStars(
				join(folder, `l${index}.fit`),
				STARS.map(([x, y]) => [x + dx, y + dy] as const),
				light('L', { DATE_OBS: undefined, 'DATE-OBS': `2026-10-0${index + 1}T22:00:00` }),
			)
		}

		const { projectId } = await stacking.createProject({ name: 'Field' })
		await importAll(stacking, projectId, [folder])
		const [cohort] = await stacking.cohorts(projectId)
		await stacking.updateCohort(projectId, cohort.cohortId, { calibration: { kind: 'none', reason: 'Synthetic frames' } })
		expect(await settled(stacking, (await stacking.startAnalysis(projectId)).jobId)).toMatchObject({ state: 'completed', failures: 0 })
		return { projectId, folder }
	}

	test('a run integrates on the worker, publishes a master on the project grid, and reuses it for the same inputs', async () => {
		const { stacking, managed } = open()
		const { projectId, folder } = await analyzed(stacking)

		const started = await stacking.startRun(projectId, { token: 'first', recipe: { method: 'sigma-clip' } })
		expect(started.job).toMatchObject({ type: 'integration', state: 'integrating', found: 3 })
		expect(await settled(stacking, started.run.runId)).toMatchObject({ state: 'completed', measured: 3, published: 1 })
		expect((await stacking.startRun(projectId, { token: 'first' })).run.runId).toBe(started.run.runId)

		const [product] = await stacking.products(projectId)
		expect(product).toMatchObject({ status: 'ready', name: 'L', width: 96, height: 96, channels: 1, frames: 3, exposure: 900 })
		expect(product.diagnostics).toMatchObject({ mode: 'spill', coverageThreshold: 2 })
		expect(product.diagnostics.normalization.map(({ scales }) => scales.length)).toEqual([1, 1, 1])
		const detail = await stacking.product(product.productId)
		expect(detail.path).toBe(join(managed, 'products', product.productId, PRODUCT_MASTER_FILE))
		expect(detail.sources).toHaveLength(3)

		const master = await readDigital(detail.path)
		const coverage = await readDigital(detail.coveragePath)
		expect([master.metadata.width, master.metadata.height, master.header.NCOMBINE, master.header.IMAGETYP]).toEqual([96, 96, 3, 'Master Light'])
		let finite = 0
		for (let i = 0; i < master.raw.length; i++) if (Number.isFinite(master.raw[i])) finite++
		expect(finite).toBe(product.diagnostics.coveredPixels)
		expect(Math.max(...coverage.raw)).toBe(3)
		expect(readdirSync(join(managed, 'staging'), { recursive: true }).length).toBe(0)

		const again = await stacking.startRun(projectId, { token: 'second', recipe: { method: 'sigma-clip' } })
		expect(again.run).toMatchObject({ state: 'completed', groups: [{ groupKey: 'l', productId: product.productId, reused: true }] })

		const online = await stacking.startRun(projectId, { token: 'third', recipe: { method: 'average' } })
		await settled(stacking, online.run.runId)
		const products = await stacking.products(projectId)
		expect(products.map((item) => item.diagnostics.mode)).toEqual(['online', 'spill'])

		const changed = join(folder, 'l1.fit')
		utimesSync(changed, new Date(), new Date(Date.now() + 60000))
		await stacking.refresh(projectId)
		expect((await stacking.products(projectId)).map((item) => item.status)).toEqual(['stale', 'stale'])
		expect((await stacking.products(projectId))[0].staleReasons).toEqual(['A frame it integrated is missing or changed'])

		await stacking.deleteProduct(product.productId)
		expect(readdirSync(join(managed, 'products'))).toEqual([products[0].productId])
	})

	test('preflight reports what does not fit, and a run is refused until it does', async () => {
		const { stacking } = open()
		const { projectId } = await analyzed(stacking)
		const tight = await stacking.preflight(projectId, { recipe: { method: 'sigma-clip' }, memoryBudget: 1024 })
		expect(tight.groups).toMatchObject([{ groupKey: 'l', frames: 3, plan: { mode: 'spill', fits: false } }])
		expect(tight.problems[0]).toContain('of memory')
		await expect(stacking.startRun(projectId, { token: 't', recipe: { method: 'sigma-clip' }, memoryBudget: 1024 })).rejects.toThrow('of memory')
		expect(await stacking.runs(projectId)).toEqual([])
		expect((await stacking.preflight(projectId, {})).problems).toEqual([])
	})

	test('plans of large stacks stay in safe integers and strips fit the budget', () => {
		const plan = integrationPlan(9576, 6388, 3, 1000, 'sigma-clip', 2 * 1024 ** 3)
		expect([plan.memoryBytes, plan.diskBytes].every(Number.isSafeInteger)).toBeTrue()
		expect(plan.stripRows).toBe(Math.floor((2 * 1024 ** 3 - 9576 * 6388 * 4) / (9576 * (1000 * 5 + 4))))
		expect(plan.diskBytes).toBe(1000 * 9576 * 6388 * 13)
		expect(integrationPlan(100, 100, 1, 10, 'average', 1e6)).toMatchObject({ mode: 'online', diskBytes: 0, fits: true })
		expect(integrationPlan(100, 100, 1, 10, 'median', 100)).toMatchObject({ stripRows: 0, fits: false })
	})

	test('the next start finishes interrupted publications and runs, and sets aside unknown directories', async () => {
		const database = AppDatabase.memory()
		const managed = directory('recover')
		const store = new ImageStackingStore(database, managed)
		const first = new ImageStacking(store, () => undefined, masters().library, [managed])
		const { projectId } = await first.createProject({ name: 'Crash' })

		const product = (productId: string, contents: string): StackingProduct => {
			const directory = join(managed, 'products', productId)
			mkdirSync(directory, { recursive: true })
			writeFileSync(join(directory, PRODUCT_MASTER_FILE), contents)
			writeFileSync(join(directory, PRODUCT_COVERAGE_FILE), 'coverage')
			const digest = new Bun.CryptoHasher('sha256').update('intact').digest('hex')
			return {
				productId,
				projectId,
				runId: 'run',
				groupKey: 'l',
				name: 'L',
				fingerprint: productId,
				createdAt: 1,
				contentDigest: digest,
				bytes: 6,
				coverageDigest: 'x',
				coverageBytes: 8,
				width: 1,
				height: 1,
				channels: 1,
				referenceSourceId: 's',
				frames: 1,
				exposure: 1,
				recipe: { method: 'average', weighting: 'none', normalization: 'none', interpolation: 'bilinear', minimumCoverage: 1, sigmaLower: 3, sigmaUpper: 3 },
				calibration: {},
				diagnostics: { mode: 'online', coverageThreshold: 1, coveredPixels: 1, normalization: [] },
			}
		}

		store.beginProduct(product('intact', 'intact'), [])
		store.beginProduct(product('broken', 'broken'), [])
		store.beginProduct(product('deleted', 'intact'), [])
		store.setPublication('deleted', 'deleting')
		mkdirSync(join(managed, 'products', 'unknown'), { recursive: true })
		mkdirSync(join(managed, 'staging', 'old'), { recursive: true })
		store.putRun({ runId: 'run', projectId, token: 't', state: 'running', createdAt: 1, recipe: product('x', 'x').recipe, groups: [] })
		rmSync(join(managed, 'products', 'x'), { recursive: true })

		const compositeDirectory = join(managed, 'composites', 'mixed')
		mkdirSync(compositeDirectory, { recursive: true })
		writeFileSync(join(compositeDirectory, COMPOSITE_FILE), 'intact')
		mkdirSync(join(managed, 'composites', 'stray'), { recursive: true })
		const composition: StackingComposition = { preset: 'Custom', sources: [{ productId: 'intact', plane: 0, gain: 1, offset: 0 }], mix: { red: [{ plane: 0, weight: 1 }], green: [{ plane: 0, weight: 1 }], blue: [{ plane: 0, weight: 1 }] } }
		store.beginComposite({ compositeId: 'mixed', projectId, fingerprint: 'f', createdAt: 1, contentDigest: new Bun.CryptoHasher('sha256').update('intact').digest('hex'), bytes: 6, width: 1, height: 1, left: 0, top: 0, composition, diagnostics: { valid: 1, unsupported: 0, nonFinite: 0, luminanceFallback: 0 } })

		const second = new ImageStacking(store, () => undefined, masters().library, [managed])
		expect((await second.products(projectId)).map(({ productId, status }) => [productId, status])).toEqual([['intact', 'ready']])
		expect(readdirSync(join(managed, 'products'))).toEqual(['intact'])
		expect(readdirSync(join(managed, 'orphaned')).some((name) => name.startsWith('unknown-'))).toBeTrue()
		expect(readdirSync(managed)).not.toContain('staging')
		expect((await second.runs(projectId))[0].state).toBe('interrupted')
		expect((await second.composites(projectId)).map(({ compositeId, status }) => [compositeId, status])).toEqual([['mixed', 'ready']])
		expect(readdirSync(join(managed, 'composites'))).toEqual(['mixed'])
		expect(readdirSync(join(managed, 'orphaned')).some((name) => name.startsWith('stray-'))).toBeTrue()
		await expect(second.deleteProduct('intact')).rejects.toThrow('delete the composite first')
	})
})

describe('scale', () => {
	// Writes a 16-bit light of 48 × 48 pixels with Gaussian stars at the given centers over a noisy sky.
	async function writeSmall(path: string, stars: readonly (readonly [number, number])[], seed: number) {
		const size = 48
		const raw = new Float64Array(size * size)
		const next = random(seed)

		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				let value = 0.05 + next() * 0.002
				for (const [cx, cy] of stars) value += 0.4 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 1.3 ** 2))
				raw[y * size + x] = value
			}
		}

		const header: FitsHeader = { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: size, NAXIS2: size, BZERO: 32768, BSCALE: 1, ...light('L', { EXPTIME: 60 }) }
		const buffer = Buffer.alloc(4 * 2880 + size * size * 2)
		const sink = bufferSink(buffer)
		await writeFits(sink, [{ header, raw }], { type: false })
		writeFileSync(path, buffer.subarray(0, sink.position))
	}

	test.skipIf(SKIP)('hundreds of frames integrate in strips of one row as in one strip, and a cancelled run leaves nothing to the next process', async () => {
		const frames = 200
		const folder = directory('scale')
		const field = [
			[8, 8],
			[36, 10],
			[14, 34],
			[38, 38],
			[24, 22],
			[10, 22],
			[40, 24],
			[22, 6],
			[30, 30],
			[18, 16],
		] as const
		const next = random(5)

		for (let index = 0; index < frames; index++) {
			const dx = Math.round(next() * 4 - 2)
			const dy = Math.round(next() * 4 - 2)
			await writeSmall(
				join(folder, `l${index}.fit`),
				field.map(([x, y]) => [x + dx, y + dy] as const),
				index + 1,
			)
		}

		const database = AppDatabase.memory()
		const managed = directory('scale-managed')
		const store = new ImageStackingStore(database, managed)
		const first = new ImageStacking(store, () => undefined, masters().library, [managed])
		const { projectId } = await first.createProject({ name: 'Scale' })
		expect(await importAll(first, projectId, [folder])).toEqual({ committed: frames })
		const [cohort] = await first.cohorts(projectId)
		await first.updateCohort(projectId, cohort.cohortId, { calibration: { kind: 'none', reason: 'Synthetic frames' } })
		expect(await settled(first, (await first.startAnalysis(projectId)).jobId)).toMatchObject({ state: 'completed', measured: frames, failures: 0, registered: frames, registrationTotal: frames })
		expect((await first.validate(projectId)).ready).toBeTrue()

		const recipe = { method: 'sigma-clip' as const, minimumCoverage: 0.9 }
		const tight = await first.preflight(projectId, { recipe, memoryBudget: 100000 })
		expect(tight.groups[0].plan).toMatchObject({ mode: 'spill', stripRows: 1, fits: true })

		const cancelled = await first.startRun(projectId, { token: 'cancel', recipe, memoryBudget: 100000 })
		while ((await first.job(cancelled.run.runId)).measured === 0) await Bun.sleep(5)
		first.cancel(cancelled.run.runId)
		expect(await settled(first, cancelled.run.runId)).toMatchObject({ state: 'cancelled' })

		const second = new ImageStacking(store, () => undefined, masters().library, [managed])
		expect((await second.runs(projectId))[0]).toMatchObject({ state: 'cancelled', groups: [{ groupKey: 'l', frames }] })
		expect(await second.products(projectId)).toEqual([])
		expect(readdirSync(managed)).not.toContain('staging')

		const strips = await second.startRun(projectId, { token: 'strips', recipe, memoryBudget: 100000 })
		expect(await settled(second, strips.run.runId)).toMatchObject({ state: 'completed', measured: frames, published: 1 })
		const [narrow] = await second.products(projectId)
		expect(narrow.diagnostics).toMatchObject({ mode: 'spill', stripRows: 1 })
		await second.deleteProduct(narrow.productId)

		const whole = await second.startRun(projectId, { token: 'whole', recipe })
		await settled(second, whole.run.runId)
		const [wide] = await second.products(projectId)
		expect(wide.diagnostics.stripRows).toBe(48)
		expect(wide.contentDigest).toBe(narrow.contentDigest)
	})
})

describe('composition', () => {
	// A project with Ha and OIII masters of one field, integrated by averaging on the worker.
	async function masters2(stacking: ImageStacking) {
		const folder = directory('compose')
		const field = [
			[20, 20],
			[70, 25],
			[30, 70],
			[75, 75],
			[50, 48],
			[15, 50],
			[82, 50],
			[48, 12],
			[60, 62],
			[35, 38],
		] as const

		for (const [filter, shifts] of [
			[
				'Ha',
				[
					[0, 0],
					[2, -3],
				],
			],
			[
				'OIII',
				[
					[-3, 2],
					[4, 1],
				],
			],
		] as const) {
			for (const [index, [dx, dy]] of shifts.entries())
				await writeStars(
					join(folder, `${filter}${index}.fit`),
					field.map(([x, y]) => [x + dx, y + dy] as const),
					light(filter),
				)
		}

		const { projectId } = await stacking.createProject({ name: 'Mix' })
		await importAll(stacking, projectId, [folder])
		for (const cohort of await stacking.cohorts(projectId)) await stacking.updateCohort(projectId, cohort.cohortId, { calibration: { kind: 'none', reason: 'Synthetic frames' } })
		await settled(stacking, (await stacking.startAnalysis(projectId)).jobId)
		expect(await settled(stacking, (await stacking.startRun(projectId, { token: 'masters', recipe: { method: 'average', minimumCoverage: 1 } })).run.runId)).toMatchObject({ state: 'completed', published: 2 })
		const products = await stacking.products(projectId)
		return { projectId, ha: products.find((product) => product.name === 'Ha')!, oiii: products.find((product) => product.name === 'OIII')! }
	}

	// HOO of the masters: Ha in red, OIII in green and blue.
	function hoo(ha: string, oiii: string): StackingComposition {
		return {
			preset: 'HOO',
			sources: [
				{ productId: ha, plane: 0, gain: 1, offset: 0 },
				{ productId: oiii, plane: 0, gain: 1, offset: 0 },
			],
			mix: { red: [{ plane: 0, weight: 1 }], green: [{ plane: 1, weight: 1 }], blue: [{ plane: 1, weight: 1 }] },
		}
	}

	test('a composition mixes masters into a cropped linear composite, reads no light frame, and keeps its masters', async () => {
		const real = new StackingCompositor()
		const read: string[] = []

		const spy: FrameCompositor = {
			compose: (request, onProgress, signal) => {
				read.push(...request.planes.map((plane) => plane.path))
				return real.compose(request, onProgress, signal)
			},
			preview: (request, signal) => {
				read.push(...request.planes.map((plane) => plane.path))
				return real.preview(request, signal)
			},
		}

		const { stacking, managed } = open(masters().library, undefined, undefined, spy)
		const { projectId, ha, oiii } = await masters2(stacking)
		const composition = hoo(ha.productId, oiii.productId)

		const unresolved = await stacking.validateComposition(projectId, { ...composition, sources: [composition.sources[0], { ...composition.sources[1], productId: 'missing' }], mix: { ...composition.mix, green: [] } })
		expect(unresolved.ready).toBeFalse()
		expect(unresolved.issues.map((issue) => issue.code)).toEqual(['unknownProduct', 'emptyChannel'])
		await expect(stacking.startComposition(projectId, { ...composition, mix: { ...composition.mix, green: [] } })).rejects.toThrow('has no source')

		const valid = await stacking.validateComposition(projectId, composition)
		expect(valid).toMatchObject({ ready: true, issues: [] })
		const jpeg = await stacking.previewComposition(projectId, composition)
		expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8])

		const started = await stacking.startComposition(projectId, composition)
		expect(await settled(stacking, started.job!.jobId)).toMatchObject({ type: 'composition', state: 'completed', published: 1 })
		const [composite] = await stacking.composites(projectId)
		expect(composite).toMatchObject({ status: 'ready', fingerprint: valid.fingerprint })
		expect(composite.width).toBeLessThan(96)
		expect(read.every((path) => path.startsWith(join(managed, 'products')))).toBeTrue()

		const detail = await stacking.composite(composite.compositeId)
		const image = await readDigital(detail.path)
		const red = await readDigital((await stacking.product(ha.productId)).path)
		const green = await readDigital((await stacking.product(oiii.productId)).path)
		expect([image.metadata.width, image.metadata.height, image.metadata.channels]).toEqual([composite.width, composite.height, 3])
		const x = Math.trunc(composite.width / 2)
		const y = Math.trunc(composite.height / 2)
		const at = (composite.top + y) * 96 + composite.left + x
		expect([image.raw[(y * composite.width + x) * 3], image.raw[(y * composite.width + x) * 3 + 1], image.raw[(y * composite.width + x) * 3 + 2]]).toEqual([red.raw[at], green.raw[at], green.raw[at]])

		expect(await stacking.startComposition(projectId, composition)).toMatchObject({ reused: true, composite: { compositeId: composite.compositeId } })
		await expect(stacking.deleteProduct(ha.productId)).rejects.toThrow('delete the composite first')

		const lhoo: StackingComposition = { ...composition, preset: 'LHOO', luminance: { source: 0, alpha: 1, match: 'robustLinear' } }
		await settled(stacking, (await stacking.startComposition(projectId, lhoo)).job!.jobId)
		const blended = (await stacking.composites(projectId))[0]
		expect(blended.composition.preset).toBe('LHOO')
		expect(blended.diagnostics.luminanceMatch?.matched).toBeTrue()

		for (const { compositeId } of await stacking.composites(projectId)) await stacking.deleteComposite(compositeId)
		await stacking.deleteProduct(ha.productId)
		expect((await stacking.products(projectId)).map((product) => product.name)).toEqual(['OIII'])
	})

	test('only the latest preview is computed, and an earlier one answers superseded', async () => {
		const gate = Promise.withResolvers<void>()

		const slow: FrameCompositor = {
			compose: () => Promise.reject(new Error('unused')),
			preview: async (_, signal) => {
				const aborted = Promise.withResolvers<void>()
				signal.addEventListener('abort', () => aborted.resolve(), { once: true })
				await Promise.race([aborted.promise, gate.promise])
				signal.throwIfAborted()
				return new Uint8Array([0xff, 0xd8])
			},
		}

		const { stacking } = open(masters().library, undefined, undefined, slow)
		const { projectId, ha, oiii } = await masters2(stacking)
		const composition = hoo(ha.productId, oiii.productId)
		const first = stacking.previewComposition(projectId, composition).then(
			() => 'computed',
			(error: unknown) => (Error.isError(error) ? error.message : 'failed'),
		)
		await Bun.sleep(20)
		const second = stacking.previewComposition(projectId, composition)
		await Bun.sleep(20)
		gate.resolve()
		expect(await first).toBe('A newer preview was asked for')
		expect(await second).toEqual(new Uint8Array([0xff, 0xd8]))
	})
})

describe('frame measurement', () => {
	test('the worker measures calibrated frames and reports each, without stopping at one that changed', async () => {
		const folder = directory('measure')
		const stars = [
			[20, 20],
			[70, 25],
			[30, 70],
			[75, 75],
			[50, 48],
			[15, 50],
			[82, 50],
			[48, 12],
		] as const
		const good = await writeStars(join(folder, 'good.fit'), stars)
		const changed = await writeStars(join(folder, 'changed.fit'), stars)
		const info = (path: string) => ({ bytes: statSync(path).size, mtimeMillis: statSync(path).mtimeMs })
		const measured = new Map<string, AnalysisMeasurement>()

		const request: AnalysisWorkerRequest = {
			jobId: 'job',
			frames: [
				{ sourceId: 'good', path: good, ...info(good), cohortId: 'a' },
				{ sourceId: 'changed', path: changed, ...info(changed), bytes: 1, cohortId: 'a' },
				{ sourceId: 'unmastered', path: good, ...info(good), cohortId: 'b' },
			],
			calibrations: { b: { dark: { path: join(folder, 'missing.fit'), fullScale: 65535 } } },
		}

		await new StackingAnalyzer().analyze(request, (sourceId, measurement) => measured.set(sourceId, measurement), new AbortController().signal)
		const result = measured.get('good')!
		expect(result.digest).toMatch(/^[0-9a-f]{64}$/)
		expect(result.stars!.length).toBeGreaterThanOrEqual(6)
		expect(result.quality!.starCount).toBe(result.stars!.length)
		expect(measured.get('changed')).toEqual({ error: 'The file changed since it was checked' })
		expect(measured.get('unmastered')).toEqual({ error: 'A pinned master could not be read' })
	})
})

describe('image stacking routes', () => {
	type Handler = (request: Request & { params: Record<string, string> }) => Promise<Response> | Response

	function call(routes: ReturnType<typeof createImageStackingRoutes>, route: keyof typeof routes, method: string, params: Record<string, string> = {}, body?: unknown, query = '') {
		const handler = (routes[route] as Record<string, Handler>)[method]
		const request = Object.assign(new Request(`http://localhost${route}${query}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params })
		return handler(request)
	}

	test('projects, frames, and aliases answer through their routes with stable codes', async () => {
		const { stacking } = open()
		const routes = createImageStackingRoutes(stacking)
		const folder = directory('routes')
		await writeFrame(join(folder, 'a.fit'), light('H Alpha'))
		await writeFrame(join(folder, 'b.fit'), light('Ha'))

		const created = await call(routes, '/api/image-stacking/projects', 'POST', {}, { name: 'Routes' })
		expect(created.status).toBe(201)
		const { projectId } = (await created.json()) as { projectId: string }

		const started = await call(routes, '/api/image-stacking/projects/:projectId/imports', 'POST', { projectId }, { paths: [folder] })
		expect(started.status).toBe(202)
		const { jobId } = (await started.json()) as { jobId: string }
		await settled(stacking, jobId)
		expect((await call(routes, '/api/image-stacking/imports/:jobId/commit', 'POST', { jobId }, {})).status).toBe(200)

		const frames = await call(routes, '/api/image-stacking/projects/:projectId/frames', 'GET', { projectId }, undefined, '?group=h%20alpha&limit=10')
		expect(((await frames.json()) as { total: number }).total).toBe(1)

		expect((await call(routes, '/api/image-stacking/projects/:projectId/aliases', 'POST', { projectId }, { filterKey: 'h alpha', targetKey: 'ha' })).status).toBe(200)
		const separated = await call(routes, '/api/image-stacking/projects/:projectId/aliases/:filterKey', 'DELETE', { projectId, filterKey: 'h alpha' })
		expect(((await separated.json()) as unknown[]).length).toBe(2)

		const missing = await call(routes, '/api/image-stacking/projects/:projectId', 'GET', { projectId: 'unknown' })
		expect(missing.status).toBe(404)
		expect(await missing.json()).toMatchObject({ code: 'notFound' })

		const snapshot = (await (await call(routes, '/api/image-stacking', 'GET')).json()) as { projects: { name: string }[] }
		expect(snapshot.projects.map((project) => project.name)).toEqual(['Routes'])
	})
})
