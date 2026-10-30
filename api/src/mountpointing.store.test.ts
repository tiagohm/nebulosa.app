import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { FittedPointingModel } from 'nebulosa/src/observation/mount/pointing'
import { exportPointingModel, parsePointingModel, type PointingModelFile, pointingModelImportRefusal, PointingModelStore, pointingModelSummary, type PointingRevision, type PointingSampleRecord } from './mountpointing.store'

let directory: string

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'nebulosa-pointing-'))
})

afterEach(async () => {
	await rm(directory, { recursive: true, force: true })
})

const POSITION = { rightAscension: 1, declination: 0.5 }

function sample(id: string, status: PointingSampleRecord['status'] = 'accepted'): PointingSampleRecord {
	return { id, waypoint: 0, attempt: 1, sessionId: 's', role: 'training', status, time: 1000, commandedAt: 900, command: POSITION, solved: POSITION, pierSide: 'EAST' }
}

function model(modelId = 'm1'): Omit<PointingModelFile, 'version' | 'revision' | 'updatedAt'> {
	return {
		modelId,
		label: 'Model',
		mount: { hardwareId: 'h', connectionId: 'c', deviceId: 'd', name: 'Mount', driver: { executable: 'x', version: '1' } },
		site: { latitude: 0.1, longitude: 0.2, elevation: 700 },
		optics: { cameraId: 'cam', cameraName: 'Camera', binning: 1 },
		origin: 'session',
		createdAt: 1,
		plan: { pattern: 'goldenSpiral', minimumAltitude: 0.3, meridianAvoidance: 0, waypoints: [] },
		acquisition: { sessionId: 's', state: 'completed' },
		samples: [sample('a'), sample('b', 'rejected')],
		revisions: [],
	}
}

function revision(fitted: Partial<FittedPointingModel> = {}): PointingRevision {
	return {
		revisionId: 'r1',
		createdAt: 2,
		request: 'auto',
		sampleIds: ['a'],
		heldOutIds: [],
		fitted: { strategy: 'hybrid', usable: true, ...fitted } as FittedPointingModel,
		residuals: [],
		offline: { heldOutCount: 0, perSide: { EAST: 1, WEST: 0, NEITHER: 0 } },
		gate: 'failed',
		verifications: [],
	}
}

test('a model survives a new store, without any active state', async () => {
	const created = await new PointingModelStore(directory).create(model())
	expect(created.revision).toBe(1)

	const reloaded = await new PointingModelStore(directory).get('m1')
	expect(reloaded).toEqual(created)
	expect(JSON.stringify(reloaded)).not.toContain('active":')
})

test('a missing directory gives no models and creates nothing', async () => {
	const missing = join(directory, 'missing')
	expect(await new PointingModelStore(missing).list()).toEqual({ models: [], unavailable: [] })
	expect(await readdir(directory)).toEqual([])
})

test('a corrupt file costs only itself and is left as it was', async () => {
	const store = new PointingModelStore(directory)
	await store.create(model())
	await writeFile(join(directory, 'broken.json'), '{"version":1,')

	const { models, unavailable } = await new PointingModelStore(directory).list()
	expect(models.map((each) => each.modelId)).toEqual(['m1'])
	expect(unavailable).toEqual([{ modelId: 'broken', reason: 'corrupt' }])
	expect(await Bun.file(join(directory, 'broken.json')).text()).toBe('{"version":1,')
})

test('a file of a newer version is listed and never overwritten', async () => {
	const text = JSON.stringify({ ...model('next'), version: 99, revision: 3, updatedAt: 1 })
	await writeFile(join(directory, 'next.json'), text)

	const store = new PointingModelStore(directory)
	expect((await store.list()).unavailable).toEqual([{ modelId: 'next', reason: 'newerVersion' }])
	expect(await store.update('next', (each) => each)).toEqual({ status: 'notFound' })
	expect(await store.delete('next')).toBeFalse()
	expect(await Bun.file(join(directory, 'next.json')).text()).toBe(text)
})

test('a save from an outdated revision is refused, and saves of a model never interleave', async () => {
	const store = new PointingModelStore(directory)
	await store.create(model())

	const saves = await Promise.all(Array.from({ length: 8 }, (_, index) => store.update('m1', (each) => ({ ...each, samples: [...each.samples, sample(`s${index}`)] }))))
	expect(saves.every((save) => save.status === 'saved')).toBeTrue()

	const current = (await store.get('m1'))!
	expect(current.samples).toHaveLength(10)
	expect(current.revision).toBe(9)

	const stale = await store.update('m1', (each) => ({ ...each, label: 'Other' }), 1)
	expect(stale.status).toBe('conflict')
	expect((await store.get('m1'))?.label).toBe('Model')
	expect((await new PointingModelStore(directory).get('m1'))?.samples).toHaveLength(10)
})

test('a condition number that is not finite survives the file as null', async () => {
	const store = new PointingModelStore(directory)
	await store.create(model())
	const fitted = { strategy: 'empirical', usable: false, diagnostics: { conditionNumber: Number.POSITIVE_INFINITY } } as unknown as FittedPointingModel
	await store.update('m1', (each) => ({ ...each, revisions: [revision(fitted)] }))

	const [saved] = (await new PointingModelStore(directory).get('m1'))!.revisions
	expect(saved.fitted.usable).toBeFalse()
	expect(saved.fitted.diagnostics.conditionNumber).toBeNull()
})

test('a session that did not end loads as interrupted', () => {
	const text = JSON.stringify({ ...model(), version: 1, revision: 1, updatedAt: 1, acquisition: { sessionId: 's', state: 'running' } })
	expect((parsePointingModel(text) as PointingModelFile).acquisition.state).toBe('interrupted')
})

test('a deleted model leaves nothing on the disk', async () => {
	const store = new PointingModelStore(directory)
	await store.create(model())
	expect(await store.delete('m1')).toBeTrue()
	expect(await store.delete('m1')).toBeFalse()
	expect(await readdir(directory)).toEqual([])
})

test('a summary counts the samples and carries no array', () => {
	const summary = pointingModelSummary({ ...model(), version: 1, revision: 4, updatedAt: 3, revisions: [revision()] })
	expect(summary).toMatchObject({ revision: 4, acceptedCount: 1, rejectedCount: 1, plannedCount: 0, revisionCount: 1, latest: { revisionId: 'r1', gate: 'failed', strategy: 'hybrid', verified: false } })
	expect(summary).not.toHaveProperty('samples')
	expect(summary).not.toHaveProperty('revisions')
})

test('an export holds what was measured and no verdict or coefficients', () => {
	const document = exportPointingModel({ ...model(), version: 1, revision: 4, updatedAt: 3, revisions: [{ ...revision(), gate: 'passed' }] })
	expect(document.samples).toHaveLength(2)
	expect(document.fit).toEqual({ request: 'auto', sampleIds: ['a'], heldOutIds: [] })
	expect(JSON.stringify(document)).not.toContain('gate')
	expect(JSON.stringify(document)).not.toContain('fitted')
})

test('an import of a newer format or of another document is refused', () => {
	const document = exportPointingModel({ ...model(), version: 1, revision: 1, updatedAt: 1 })
	expect(pointingModelImportRefusal(document)).toBeUndefined()
	expect(pointingModelImportRefusal({ ...document, version: 2 })).toContain('newer')
	expect(pointingModelImportRefusal({ ...document, kind: 'other' as never })).toContain('not a Nebulosa')
})

test('a directory holding other files is read past them', async () => {
	await mkdir(join(directory, 'nested'))
	await writeFile(join(directory, 'notes.txt'), 'x')
	expect((await new PointingModelStore(directory).list()).models).toEqual([])
})
