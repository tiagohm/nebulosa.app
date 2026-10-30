import { expect, test } from 'bun:test'
import type { PointingFitState, PointingModelDetail, PointingModelSummary, PointingModelsSnapshot, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { fitPointingModel, handleMountPointingEvent, importPointingModel, loadPointingModel, type MountPointingRuntime, patchPointingModel, refreshMountPointing, selectPointingModel } from './mountpointing'

function runtime(): MountPointingRuntime {
	return proxy<MountPointingRuntime>({ models: {}, unavailable: [], fits: {}, details: {}, sequence: 0, pending: {}, errors: {} })
}

function summary(patch: Partial<PointingModelSummary> = {}): PointingModelSummary {
	return { modelId: 'm1', revision: 1, label: 'Model', acceptedCount: 0, rejectedCount: 0, plannedCount: 0, revisionCount: 0, ...patch } as PointingModelSummary
}

function updated(sequence: number, patch: Partial<PointingModelSummary> = {}, fit?: PointingFitState): ServerEvent {
	return { type: 'mountPointing:modelUpdated', model: summary(patch), fit: fit ?? { running: false }, sequence }
}

function json(body: unknown, status = 200) {
	return Promise.resolve(Response.json(body, { status }))
}

const snapshot = (patch: Partial<PointingModelsSnapshot> = {}): PointingModelsSnapshot => ({ models: [], unavailable: [], fits: {}, sequence: 0, ...patch })

const ignore = (() => json({})) as unknown as typeof fetch

test('an event older than the latest one applied is dropped', () => {
	const state = runtime()
	handleMountPointingEvent(state, updated(3, { label: 'New' }), ignore)
	handleMountPointingEvent(state, updated(2, { label: 'Old' }), ignore)
	expect(state.models.m1.label).toBe('New')
})

test('a fit shows while it runs and after it fails, and is forgotten when it ends', () => {
	const state = runtime()
	handleMountPointingEvent(state, updated(1, {}, { running: true }), ignore)
	expect(state.fits.m1).toEqual({ running: true })

	handleMountPointingEvent(state, updated(2, {}, { running: false, error: 'no luck' }), ignore)
	expect(state.fits.m1.error).toBe('no luck')

	handleMountPointingEvent(state, updated(3), ignore)
	expect(state.fits.m1).toBeUndefined()
})

test('a removed model leaves nothing behind, not even the selection', () => {
	const state = runtime()
	handleMountPointingEvent(state, updated(1), ignore)
	state.details.m1 = { revision: 1 } as PointingModelDetail
	state.selectedModelId = 'm1'

	handleMountPointingEvent(state, { type: 'mountPointing:modelRemoved', modelId: 'm1', sequence: 2 }, ignore)
	expect(state.models.m1).toBeUndefined()
	expect(state.details.m1).toBeUndefined()
	expect(state.selectedModelId).toBeUndefined()
})

test('an open model is fetched again when its file changes, and only then', async () => {
	const state = runtime()
	const urls: string[] = []
	const request = ((url: string) => {
		urls.push(url)
		return json({ modelId: 'm1', revision: 2 })
	}) as typeof fetch

	state.details.m1 = { revision: 1 } as PointingModelDetail
	handleMountPointingEvent(state, updated(1, { revision: 1 }), request)
	expect(urls).toEqual([])

	handleMountPointingEvent(state, updated(2, { revision: 2 }), request)
	await Bun.sleep(0)
	expect(urls).toEqual(['/api/mount-pointing/models/m1'])
	expect(state.details.m1.revision).toBe(2)
})

test('a late record never replaces a newer one, and a record the server dropped is forgotten', async () => {
	const state = runtime()
	state.details.m1 = { revision: 5 } as PointingModelDetail

	await loadPointingModel(state, 'm1', (() => json({ revision: 4 })) as unknown as typeof fetch)
	expect(state.details.m1.revision).toBe(5)

	await loadPointingModel(state, 'm1', (() => json({}, 404)) as unknown as typeof fetch)
	expect(state.details.m1).toBeUndefined()
})

test('a snapshot replaces the models but leaves what an event changed during the request', async () => {
	const state = runtime()
	handleMountPointingEvent(state, updated(1, { modelId: 'gone' }), ignore)

	const { promise, resolve } = Promise.withResolvers<Response>()
	const refresh = refreshMountPointing(state, (() => promise) as unknown as typeof fetch)

	handleMountPointingEvent(state, updated(2, { modelId: 'late', label: 'Event' }), ignore)
	resolve(Response.json(snapshot({ models: [summary({ modelId: 'late', label: 'Snapshot' }), summary({ modelId: 'other' })], unavailable: [{ modelId: 'bad', reason: 'corrupt' }], sequence: 1 })))
	await refresh

	expect(Object.keys(state.models).sort()).toEqual(['late', 'other'])
	expect(state.models.late.label).toBe('Event')
	expect(state.unavailable).toEqual([{ modelId: 'bad', reason: 'corrupt' }])
	expect(state.sequence).toBe(2)
})

test('a fit sends the revision it was made from and reports a refusal', async () => {
	const state = runtime()
	let body: unknown

	await fitPointingModel(state, 'm1', { expectedRevision: 3, strategy: 'auto', excludedSampleIds: ['a'] }, ((_: string, init: RequestInit) => {
		body = JSON.parse(init.body as string)
		return json({ error: 'The model was changed since it was read', code: 'conflict' }, 409)
	}) as unknown as typeof fetch)

	expect(body).toEqual({ expectedRevision: 3, strategy: 'auto', excludedSampleIds: ['a'] })
	expect(state.errors.m1).toBe('The model was changed since it was read')
	expect(state.pending.m1).toBeUndefined()
})

test('a server out of reach is reported and the snapshot is asked for again', async () => {
	const state = runtime()
	const urls: string[] = []

	await patchPointingModel(state, 'm1', { expectedRevision: 1, label: 'A' }, ((url: string) => {
		urls.push(url)
		return Promise.reject(new Error('offline'))
	}) as unknown as typeof fetch)

	expect(state.errors.m1).toBe('Unable to reach the server.')
	expect(urls).toEqual(['/api/mount-pointing/models/m1', '/api/mount-pointing/models'])
})

test('selecting a model loads it', async () => {
	const state = runtime()
	selectPointingModel(state, 'm1', (() => json({ revision: 1 })) as unknown as typeof fetch)
	await Bun.sleep(0)
	expect(state.selectedModelId).toBe('m1')
	expect(state.details.m1.revision).toBe(1)
})

test('an import reports why it was refused', async () => {
	expect(await importPointingModel({} as never, (() => json({ error: 'newer' }, 422)) as unknown as typeof fetch)).toBe('newer')
	expect(await importPointingModel({} as never, (() => json({}, 201)) as unknown as typeof fetch)).toBeUndefined()
})
