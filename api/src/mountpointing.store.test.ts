import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { FittedPointingModel } from 'nebulosa/src/observation/mount/pointing'
import { AppDatabase } from './database'
import { exportPointingModel, type PointingModelFile, pointingModelImportRefusal, PointingModelStore, pointingModelSummary, type PointingRevision, type PointingSampleRecord, type PointingVerification } from './mountpointing.store'

const directory = mkdtempSync(join(tmpdir(), 'nebulosa-pointing-'))

afterAll(() => rmSync(directory, { recursive: true, force: true }))

const POSITION = { rightAscension: 1, declination: 0.5 }

function sample(id: string, status: PointingSampleRecord['status'] = 'accepted'): PointingSampleRecord {
	return { id, waypoint: 0, attempt: 1, sessionId: 's', role: 'training', status, time: 1000, commandedAt: 900, command: POSITION, solved: POSITION, pierSide: 'EAST' }
}

function model(modelId = 'm1'): Omit<PointingModelFile, 'revision' | 'updatedAt'> {
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

function revision(fitted: Partial<FittedPointingModel> = {}, revisionId = 'r1'): PointingRevision {
	return {
		revisionId,
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

function verification(verificationId: string): PointingVerification {
	return { verificationId, createdAt: 3, count: 4, uncorrectedRms: 0.002, correctedRms: 0.001, passed: true }
}

function count(database: AppDatabase, table: string) {
	return (database.db.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count
}

test('a model survives a restart with its samples, revisions, and verifications in order, without any active state', async () => {
	const file = join(directory, 'restart', 'nebulosa.sqlite')
	const database = new AppDatabase(file)
	const store = new PointingModelStore(database)
	await store.create(model())
	await store.update('m1', (each) => ({ ...each, revisions: [revision({}, 'r2'), revision({}, 'r1')] }))
	const saved = await store.update('m1', (each) => ({ ...each, notes: 'Notes', lastActiveAt: 5, revisions: [{ ...each.revisions[0], verifications: [verification('v2'), verification('v1')] }, each.revisions[1]] }))
	database.close()

	const reopened = new AppDatabase(file)
	const reloaded = await new PointingModelStore(reopened).get('m1')
	expect(saved.status).toBe('saved')
	expect(reloaded).toEqual((saved as { model: PointingModelFile }).model)
	expect(reloaded!.revisions.map((each) => [each.revisionId, each.verifications.map(({ verificationId }) => verificationId)])).toEqual([
		['r2', ['v2', 'v1']],
		['r1', []],
	])
	expect(JSON.stringify(reloaded)).not.toContain('active":')
	reopened.close()
})

test('an empty database lists no models', async () => {
	expect(await new PointingModelStore(AppDatabase.memory()).list()).toEqual({ models: [] })
})

test('a save from an outdated revision is refused, and saves of a model never interleave', async () => {
	const store = new PointingModelStore(AppDatabase.memory())
	await store.create(model())

	const saves = await Promise.all(Array.from({ length: 8 }, (_, index) => store.update('m1', (each) => ({ ...each, samples: [...each.samples, sample(`s${index}`)] }))))
	expect(saves.every((save) => save.status === 'saved')).toBeTrue()

	const current = (await store.get('m1'))!
	expect(current.samples.map(({ id }) => id)).toEqual(['a', 'b', 's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'])
	expect(current.revision).toBe(9)

	const stale = await store.update('m1', (each) => ({ ...each, label: 'Other' }), 1)
	expect(stale.status).toBe('conflict')
	expect((await store.get('m1'))?.label).toBe('Model')
	expect(await store.update('gone', (each) => each)).toEqual({ status: 'notFound' })
})

test('a sample, revision, or verification written once is never changed nor removed', async () => {
	const store = new PointingModelStore(AppDatabase.memory())
	await store.create(model())
	await store.update('m1', (each) => ({ ...each, revisions: [{ ...revision(), verifications: [verification('v1')] }] }))

	expect(store.update('m1', (each) => ({ ...each, samples: [{ ...each.samples[0], status: 'rejected' }, each.samples[1]] }))).rejects.toThrow('samples')
	expect(store.update('m1', (each) => ({ ...each, samples: each.samples.slice(1) }))).rejects.toThrow('samples')
	expect(store.update('m1', (each) => ({ ...each, revisions: [{ ...each.revisions[0], gate: 'passed' }] }))).rejects.toThrow('revisions')
	expect(store.update('m1', (each) => ({ ...each, revisions: [] }))).rejects.toThrow('revisions')
	expect(store.update('m1', (each) => ({ ...each, revisions: [{ ...each.revisions[0], verifications: [] }] }))).rejects.toThrow('verifications')
	expect(store.update('m1', (each) => ({ ...each, label: 'Other', samples: [...each.samples, sample('c')], revisions: [{ ...each.revisions[0], gate: 'passed' }] }))).rejects.toThrow('revisions')

	const current = (await store.get('m1'))!
	expect(current).toMatchObject({ revision: 2, label: 'Model', samples: [{ status: 'accepted' }, { id: 'b' }], revisions: [{ gate: 'failed', verifications: [{ verificationId: 'v1' }] }] })
	expect(current.samples).toHaveLength(2)

	// An equal copy of a row is not a change.
	expect(await store.update('m1', (each) => ({ ...each, samples: structuredClone(each.samples), revisions: structuredClone(each.revisions) }))).toMatchObject({ status: 'saved' })
})

test('a condition number that is not finite is read back as null', async () => {
	const store = new PointingModelStore(AppDatabase.memory())
	await store.create(model())
	const fitted = { strategy: 'empirical', usable: false, diagnostics: { conditionNumber: Number.POSITIVE_INFINITY } } as unknown as FittedPointingModel
	await store.update('m1', (each) => ({ ...each, revisions: [revision(fitted)] }))

	const [saved] = (await store.get('m1'))!.revisions
	expect(saved.fitted.usable).toBeFalse()
	expect(saved.fitted.diagnostics.conditionNumber).toBeNull()
})

test('an acquisition a previous run left running or paused is interrupted, and nothing else changes', async () => {
	const database = AppDatabase.memory()
	const store = new PointingModelStore(database)
	await store.create({ ...model('running'), acquisition: { sessionId: 's', state: 'running' } })
	await store.create({ ...model('paused'), acquisition: { sessionId: 's', state: 'paused' } })
	await store.create(model('done'))

	expect(new PointingModelStore(database).interruptRunning()).toBe(2)
	const { models } = await store.list()
	expect(Object.fromEntries(models.map((each) => [each.modelId, [each.acquisition.state, each.revision]]))).toEqual({ running: ['interrupted', 1], paused: ['interrupted', 1], done: ['completed', 1] })
})

test('a deleted model leaves no row', async () => {
	const database = AppDatabase.memory()
	const store = new PointingModelStore(database)
	await store.create({ ...model(), revisions: [{ ...revision(), verifications: [verification('v1')] }] })
	expect(await store.delete('m1')).toBeTrue()
	expect(await store.delete('m1')).toBeFalse()
	expect(['pointing_models', 'pointing_samples', 'pointing_revisions', 'pointing_verifications'].map((table) => count(database, table))).toEqual([0, 0, 0, 0])
})

test('a summary counts the samples and carries no array', () => {
	const summary = pointingModelSummary({ ...model(), revision: 4, updatedAt: 3, revisions: [revision()] })
	expect(summary).toMatchObject({ revision: 4, acceptedCount: 1, rejectedCount: 1, plannedCount: 0, revisionCount: 1, latest: { revisionId: 'r1', gate: 'failed', strategy: 'hybrid', verified: false } })
	expect(summary).not.toHaveProperty('samples')
	expect(summary).not.toHaveProperty('revisions')
})

test('an export holds what was measured and no verdict or coefficients', () => {
	const document = exportPointingModel({ ...model(), revision: 4, updatedAt: 3, revisions: [{ ...revision(), gate: 'passed' }] })
	expect(document.samples).toHaveLength(2)
	expect(document.fit).toEqual({ request: 'auto', sampleIds: ['a'], heldOutIds: [] })
	expect(JSON.stringify(document)).not.toContain('gate')
	expect(JSON.stringify(document)).not.toContain('fitted')
})

test('an import of a newer format or of another document is refused', () => {
	const document = exportPointingModel({ ...model(), revision: 1, updatedAt: 1 })
	expect(pointingModelImportRefusal(document)).toBeUndefined()
	expect(pointingModelImportRefusal({ ...document, version: 2 })).toContain('newer')
	expect(pointingModelImportRefusal({ ...document, kind: 'other' as never })).toContain('not a Nebulosa')
})
