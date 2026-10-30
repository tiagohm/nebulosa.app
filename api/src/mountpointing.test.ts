import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { arcsec, deg } from 'nebulosa/src/math/units/angle'
import type { FittedPointingModel } from 'nebulosa/src/observation/mount/pointing'
import { MINIMUM_FIT_SAMPLES, type PointingModelEvent, PointingModels, type PointingModelsSnapshot } from './mountpointing'
import type { PointingFitRequest, PointingFitResult } from './mountpointing.fit'
import { type PointingModelExport, type PointingModelFile, PointingModelStore, type PointingModelSummary, type PointingSampleRecord } from './mountpointing.store'

let directory: string

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'nebulosa-pointing-models-'))
})

afterEach(async () => {
	await rm(directory, { recursive: true, force: true })
})

function sample(id: string, role: PointingSampleRecord['role'] = 'training', status: PointingSampleRecord['status'] = 'accepted'): PointingSampleRecord {
	const position = { rightAscension: 1, declination: 0.5 }
	return { id, waypoint: 0, attempt: 1, sessionId: 's', role, status, time: 1000, commandedAt: 900, command: position, solved: { ...position, declination: position.declination + arcsec(60) }, pierSide: 'EAST' }
}

function record(samples: readonly PointingSampleRecord[] = [sample('a'), sample('b'), sample('h', 'heldOut'), sample('x', 'training', 'rejected')]): Omit<PointingModelFile, 'version' | 'revision' | 'updatedAt'> {
	return {
		modelId: 'm1',
		label: 'Model',
		mount: { hardwareId: 'h', connectionId: 'c', deviceId: 'd', name: 'Mount', driver: { executable: 'x', version: '1' } },
		site: { latitude: deg(-23), longitude: deg(-46), elevation: 700 },
		optics: { cameraId: 'cam', cameraName: 'Camera', binning: 1 },
		origin: 'session',
		createdAt: 1,
		plan: { pattern: 'goldenSpiral', minimumAltitude: deg(25), meridianAvoidance: 0, waypoints: [] },
		acquisition: { sessionId: 's', state: 'completed' },
		samples,
		revisions: [],
	}
}

// A fitter that answers on demand and records what it was asked.
function fakeFitter() {
	const requests: PointingFitRequest[] = []
	let pending: PromiseWithResolvers<PointingFitResult> | undefined

	const result: PointingFitResult = { fitted: { strategy: 'hybrid', usable: true } as FittedPointingModel, residuals: [], offline: { heldOutCount: 1, perSide: { EAST: 2, WEST: 0, NEITHER: 0 } }, gate: 'failed' }

	return {
		requests,
		fit: (request: PointingFitRequest) => {
			requests.push(request)
			pending = Promise.withResolvers<PointingFitResult>()
			return pending.promise
		},
		waiting: () => pending !== undefined,
		finish: () => {
			pending?.resolve(result)
			pending = undefined
		},
		fail: (message: string) => {
			pending?.reject(new Error(message))
			pending = undefined
		},
	}
}

async function setup(samples?: readonly PointingSampleRecord[]) {
	const store = new PointingModelStore(directory)
	const fitter = fakeFitter()
	const events: PointingModelEvent[] = []
	const models = new PointingModels(store, fitter, (event) => events.push(event))
	const created = await store.create(record(samples))
	return { store, fitter, events, models, created }
}

// Waits for a condition of what runs in the background.
async function until(condition: () => boolean) {
	const start = Date.now()

	while (!condition()) {
		if (Date.now() - start > 5000) throw new Error('timeout')
		await Bun.sleep(2)
	}
}

// Waits for a fit to reach the fitter, ends it as told, and waits for its outcome to be published.
async function ended({ fitter, events }: Pick<Awaited<ReturnType<typeof setup>>, 'fitter' | 'events'>, end: () => void, count = 1) {
	await until(() => fitter.requests.length === count && fitter.waiting())
	end()
	await until(() => !fitter.waiting() && events.at(-1)?.type === 'mountPointing:modelUpdated' && !(events.at(-1) as Extract<PointingModelEvent, { fit: unknown }>).fit.running)
}

test('a fit adds a revision of the samples accepted, keeping the withheld ones apart and leaving exclusions out', async () => {
	const context = await setup()
	const { models, fitter, events, store, created } = context

	const response = await models.fit('m1', { expectedRevision: created.revision, strategy: 'auto', excludedSampleIds: ['b'] })
	expect(response.status).toBe(202)
	await until(fitter.waiting)

	const [request] = fitter.requests
	expect(request.training.map((each) => each.id)).toEqual(['a'])
	expect(request.heldOut.map((each) => each.id)).toEqual(['h'])
	expect(request.minimumAltitude).toBe(deg(25))
	expect(events.at(-1)).toMatchObject({ type: 'mountPointing:modelUpdated', fit: { running: true } })

	await ended(context, fitter.finish)

	const saved = (await store.get('m1'))!
	expect(saved.revisions).toHaveLength(1)
	expect(saved.revisions[0]).toMatchObject({ request: 'auto', sampleIds: ['a'], heldOutIds: ['h'], gate: 'failed', verifications: [] })
	expect(saved.samples).toEqual(created.samples)
	expect(events.at(-1)).toMatchObject({ fit: { running: false }, model: { revisionCount: 1 } })
})

test('an exclusion adds a revision and leaves the earlier ones as they were', async () => {
	const context = await setup()
	const { models, fitter, store } = context

	await models.fit('m1', { expectedRevision: 1, strategy: 'hybrid' })
	await ended(context, fitter.finish)

	const first = (await store.get('m1'))!
	await models.fit('m1', { expectedRevision: first.revision, strategy: 'hybrid', excludedSampleIds: ['a'] })
	await ended(context, fitter.finish, 2)

	const { revisions } = (await store.get('m1'))!
	expect(revisions).toHaveLength(2)
	expect(revisions[0]).toEqual(first.revisions[0])
	expect(revisions[1].parent).toBe(revisions[0].revisionId)
	expect(revisions[1].sampleIds).toEqual(['b'])
})

test('a fit from an outdated file is refused with the current model', async () => {
	const { models } = await setup()
	await models.patch('m1', { expectedRevision: 1, label: 'Other' })

	const response = await models.fit('m1', { expectedRevision: 1, strategy: 'hybrid' })
	expect(response.status).toBe(409)
	expect(await response.json()).toMatchObject({ code: 'conflict', model: { label: 'Other', revision: 2 } })
})

test('a second fit waits for the first, and a failed one is reported and can be retried', async () => {
	const context = await setup()
	const { models, fitter, events, store } = context

	await models.fit('m1', { expectedRevision: 1, strategy: 'hybrid' })
	expect((await models.fit('m1', { expectedRevision: 1, strategy: 'auto' })).status).toBe(409)

	await ended(context, () => fitter.fail('no luck'))

	expect(events.at(-1)).toMatchObject({ fit: { running: false, error: 'no luck' } })
	expect((await store.get('m1'))?.revisions).toEqual([])
	expect((await models.snapshot()).fits).toEqual({ m1: { running: false, error: 'no luck' } })
	expect((await models.fit('m1', { expectedRevision: 1, strategy: 'hybrid' })).status).toBe(202)
})

test('a model without a sample to fit is refused', async () => {
	const { models } = await setup([sample('x', 'training', 'rejected')])
	expect((await models.fit('m1', { expectedRevision: 1, strategy: 'hybrid' })).status).toBe(422)
})

test('a model a session holds can neither be fitted nor removed', async () => {
	const { models } = await setup()
	models.protectWith((modelId) => modelId === 'm1')
	expect((await models.fit('m1', { expectedRevision: 1, strategy: 'hybrid' })).status).toBe(409)
	expect((await models.remove('m1')).status).toBe(409)
})

test('a run is fitted by itself only with enough samples', async () => {
	const few = await setup()
	few.models.fitAfterRun(few.created)
	expect(few.fitter.requests).toHaveLength(0)

	const samples = Array.from({ length: MINIMUM_FIT_SAMPLES }, (_, index) => sample(`s${index}`))
	const enough = new PointingModels(new PointingModelStore(directory), fakeFitter(), () => {})
	const fitter = enough.fitter as ReturnType<typeof fakeFitter>
	enough.fitAfterRun({ ...few.created, samples })
	await until(fitter.waiting)
	expect(fitter.requests[0].strategy).toBe('auto')
})

test('an import is fitted here from its samples, never trusted, and keeps the exclusions of the export', async () => {
	const context = await setup()
	const { models, fitter, store } = context
	await models.fit('m1', { expectedRevision: 1, strategy: 'hybrid', excludedSampleIds: ['b'] })
	await ended(context, fitter.finish)

	const document = (await (await models.export('m1')).json()) as PointingModelExport
	expect(document).not.toHaveProperty('revisions')

	const poisoned = { ...document, gate: 'passed', fitted: { usable: true }, active: true }
	const response = await models.import(poisoned)
	expect(response.status).toBe(201)

	const { modelId } = (await response.json()) as PointingModelSummary
	expect(modelId).not.toBe('m1')

	await ended(context, fitter.finish, 2)

	const imported = (await store.get(modelId))!
	expect(imported.origin).toBe('import')
	expect(imported.revisions).toHaveLength(1)
	expect(imported.revisions[0].sampleIds).toEqual(['a'])
	expect(imported.revisions[0].gate).toBe('failed')
})

test('an import of a newer format is refused and creates nothing', async () => {
	const { models, store } = await setup()
	const document = (await (await models.export('m1')).json()) as PointingModelExport
	expect((await models.import({ ...document, version: 9 })).status).toBe(422)
	expect((await store.list()).models).toHaveLength(1)
})

test('notes are replaced, and an empty text removes them', async () => {
	const { models, store } = await setup()
	await models.patch('m1', { expectedRevision: 1, notes: 'New' })
	expect((await store.get('m1'))?.notes).toBe('New')
	await models.patch('m1', { expectedRevision: 2, notes: '' })
	expect(await store.get('m1')).not.toHaveProperty('notes')
})

test('a removal is published, the snapshot carries the sequence of the events, and an unknown model is 404', async () => {
	const { models, events } = await setup()
	expect((await models.remove('m1')).status).toBe(204)
	expect(events.at(-1)).toEqual({ type: 'mountPointing:modelRemoved', modelId: 'm1', sequence: 1 })

	const snapshot: PointingModelsSnapshot = await models.snapshot()
	expect(snapshot).toMatchObject({ models: [], sequence: 1 })
	expect((await models.model('m1')).status).toBe(404)
	expect((await models.export('m1')).status).toBe(404)
	expect((await models.remove('m1')).status).toBe(404)
})
