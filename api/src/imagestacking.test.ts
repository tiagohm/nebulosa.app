import { afterAll, describe, expect, test } from 'bun:test'
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type FitsHeader, writeFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSink } from 'nebulosa/src/io/io'
import type { CalibrationMetadata } from './calibrationlibrary.compatibility'
import { AppDatabase } from './database'
import { createImageStackingRoutes, filterGroups, ImageStacking, type ImageStackingEvent } from './imagestacking'
import { cohortKeyOf, filterKeyOf, filterSynonyms, isWithin, lightRoleOf } from './imagestacking.sources'
import { ImageStackingStore, type StackingSourceFacts } from './imagestacking.store'

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

// A service over a database and a managed directory of its own.
function open() {
	const events: ImageStackingEvent[] = []
	const managed = directory('managed')
	const stacking = new ImageStacking(new ImageStackingStore(AppDatabase.memory(), managed), (event) => events.push(event), [managed])
	return { stacking, events, managed }
}

// Waits until a job ends, and returns it.
async function settled(stacking: ImageStacking, jobId: string) {
	for (let attempt = 0; attempt < 500; attempt++) {
		const job = await stacking.job(jobId)
		if (job.state !== 'scanning') return job
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
		stacking.cancelImport(job.jobId)
		expect((await settled(stacking, job.jobId)).state).toBe('cancelled')
		expect(() => stacking.cancelImport(job.jobId)).toThrow('has ended')
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
