import { afterAll, describe, expect, test } from 'bun:test'
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { SubframeQualityMetrics } from 'nebulosa/src/imaging/processing/subframe.selector'
import { type FitsHeader, writeFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSink } from 'nebulosa/src/io/io'
import type { ResolvePreview } from './calibrationlibrary'
import type { CalibrationMetadata } from './calibrationlibrary.compatibility'
import { AppDatabase } from './database'
import { createImageStackingRoutes, filterGroups, ImageStacking, type ImageStackingEvent, type StackingMasters } from './imagestacking'
import { type AnalysisMeasurement, type AnalysisWorkerRequest, type FrameAnalyzer, StackingAnalyzer } from './imagestacking.analysis'
import { cohortKeyOf, filterKeyOf, filterSynonyms, isWithin, lightRoleOf } from './imagestacking.sources'
import { ImageStackingStore, type StackingSourceFacts, type StackingStar } from './imagestacking.store'

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
	}

	return { fake, requests }
}

// A service over a database and a managed directory of its own.
function open(library: StackingMasters = masters().library, frameAnalyzer?: FrameAnalyzer) {
	const events: ImageStackingEvent[] = []
	const managed = directory('managed')
	const stacking = new ImageStacking(new ImageStackingStore(AppDatabase.memory(), managed), (event) => events.push(event), library, [managed], frameAnalyzer)
	return { stacking, events, managed }
}

// Waits until a job ends, and returns it.
async function settled(stacking: ImageStacking, jobId: string) {
	for (let attempt = 0; attempt < 500; attempt++) {
		const job = await stacking.job(jobId)
		if (job.state !== 'scanning' && job.state !== 'analyzing') return job
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

	test('an analysis is refused while another runs and can be cancelled, keeping what it measured', async () => {
		const slow: FrameAnalyzer = {
			analyze: async (request, onMeasured, signal) => {
				onMeasured(request.frames[0].sourceId, { error: 'The frame could not be measured' })
				const aborted = Promise.withResolvers<void>()
				signal.addEventListener('abort', () => aborted.resolve(), { once: true })
				await aborted.promise
				signal.throwIfAborted()
			},
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

describe('frame measurement', () => {
	// Writes a 16-bit light of Gaussian stars at the given centers over a flat sky.
	async function writeStars(path: string, stars: readonly (readonly [number, number])[]) {
		const size = 96
		const raw = new Float64Array(size * size)

		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				let value = 0.05 + ((x * 7 + y * 13) % 5) * 0.0004
				for (const [cx, cy] of stars) value += 0.5 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 1.5 ** 2))
				raw[y * size + x] = value
			}
		}

		const header: FitsHeader = { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: size, NAXIS2: size, BZERO: 32768, BSCALE: 1, IMAGETYP: 'Light Frame' }
		const buffer = Buffer.alloc(8 * 2880 + size * size * 2)
		const sink = bufferSink(buffer)
		await writeFits(sink, [{ header, raw }], { type: false })
		writeFileSync(path, buffer.subarray(0, sink.position))
		return path
	}

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
