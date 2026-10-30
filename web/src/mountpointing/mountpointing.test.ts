import { expect, test } from 'bun:test'
import type { MountPointingSessionSummary, MountState, PointingFitState, PointingModelDetail, PointingModelSummary, PointingModelsSnapshot, ServerEvent } from 'api'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { DEFAULT_CAMERA_PLATE_SOLVING, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_POINTING_MODEL_SETTINGS } from '../profile/schema'
import {
	fitPointingModel,
	handleMountPointingEvent,
	importPointingModel,
	loadPointingModel,
	mountPointingBlocker,
	mountPointingMountSupport,
	mountPointingRequest,
	mountPointingRunning,
	type MountPointingRuntime,
	patchPointingModel,
	previewMountPointingPlan,
	refreshMountPointing,
	resumeMountPointing,
	selectPointingModel,
	startMountPointing,
} from './mountpointing'

function runtime(): MountPointingRuntime {
	return proxy<MountPointingRuntime>({ models: {}, unavailable: [], fits: {}, details: {}, sessions: {}, plans: {}, sequence: 0, pending: {}, errors: {} })
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
	expect(urls).toContain('/api/mount-pointing/models/m1')
	expect(urls).toContain('/api/mount-pointing/models')
	expect(urls).toContain('/api/mount-pointing/sessions')
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

const READY = { status: 'ready' } as RoleAvailability
const CAMERA = { camera: { connectionId: 'c', deviceId: 'cam' }, sessionId: 's1', startedAt: 10, revision: 1, state: 'running' } as MountPointingSessionSummary

function mountState(patch: Partial<MountState> = {}): MountState {
	return { mountType: 'EQ_GEM', canGoTo: true, canAbort: true, canTracking: true, tracking: true, parked: false, parking: false, site: { latitude: 0.4, longitude: 0.8, elevation: 0 }, ...patch } as MountState
}

test('an alt-az mount, one without GoTo, and one without abort can never be sampled', () => {
	expect(mountPointingMountSupport(undefined)).toBeUndefined()
	expect(mountPointingMountSupport(mountState())).toBeUndefined()
	expect(mountPointingMountSupport(mountState({ mountType: 'UNKNOWN' }))).toBeUndefined()
	expect(mountPointingMountSupport(mountState({ mountType: 'ALTAZ' }))).toContain('not equatorial')
	expect(mountPointingMountSupport(mountState({ canGoTo: false }))).toContain('go to')
	expect(mountPointingMountSupport(mountState({ canAbort: false }))).toContain('abort')
})

test('a start needs the Main Camera, a located mount free to move, a solver, and a known geometry', () => {
	const blocker = (state?: MountState, role: 'MAIN_CAMERA' | 'GUIDE_CAMERA' | undefined = 'MAIN_CAMERA', configured = true, equatorial = true) => mountPointingBlocker(READY, READY, role, state, configured, equatorial)

	expect(blocker(mountState())).toBeUndefined()
	expect(blocker(mountState(), 'GUIDE_CAMERA')).toContain('Main Camera')
	expect(mountPointingBlocker(READY, READY, undefined, mountState(), true, true)).toContain('Main Camera')
	expect(blocker(undefined)).toContain('not known')
	expect(blocker(mountState({ site: { latitude: 0, longitude: 0, elevation: 0 } }))).toContain('no site')
	expect(blocker(mountState({ parked: true }))).toContain('parked')
	expect(blocker(mountState({ tracking: false, canTracking: false }))).toContain('tracking')
	expect(blocker(mountState({ tracking: false }))).toBeUndefined()
	expect(blocker(mountState(), 'MAIN_CAMERA', false)).toContain('plate solver')
	expect(blocker(mountState(), 'MAIN_CAMERA', true, false)).toContain('confirm')
})

test('the request takes the exposure time of the form, the camera settings, the solver of the camera, and angles in radians', () => {
	const exposure = { ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 99, gain: 120 }
	const solving = { ...DEFAULT_CAMERA_PLATE_SOLVING, provider: 'nova', scaleTolerance: 0.3 } as const
	const request = mountPointingRequest({ ...DEFAULT_POINTING_MODEL_SETTINGS, exposureTime: 7, minimumAltitude: 30, meridianAvoidance: 10 }, exposure, solving, { connectionId: 'c', deviceId: 'm' }, true)

	expect(request.capture.exposureTime).toBe(7)
	expect(request.capture.gain).toBe(120)
	expect(request.solving).toEqual(solving)
	expect(request.plan.minimumAltitude).toBeCloseTo(Math.PI / 6, 12)
	expect(request.plan.meridianAvoidance).toBeCloseTo(Math.PI / 18, 12)
	expect(request.equatorialConfirmed).toBeTrue()
})

test('sessions follow their revision, per camera, and a newer session wins', () => {
	const state = runtime()
	handleMountPointingEvent(state, { type: 'mountPointing:updated', session: { ...CAMERA, revision: 3, state: 'paused' } }, ignore)
	handleMountPointingEvent(state, { type: 'mountPointing:updated', session: { ...CAMERA, revision: 2, state: 'running' } }, ignore)
	expect(state.sessions['c:cam'].state).toBe('paused')

	handleMountPointingEvent(state, { type: 'mountPointing:updated', session: { ...CAMERA, sessionId: 'old', startedAt: 5, revision: 9 } }, ignore)
	expect(state.sessions['c:cam'].sessionId).toBe('s1')

	handleMountPointingEvent(state, { type: 'mountPointing:updated', session: { ...CAMERA, sessionId: 'new', startedAt: 20, revision: 1 } }, ignore)
	expect(state.sessions['c:cam'].sessionId).toBe('new')
})

test('a session is running until it ends, paused or blocked included', () => {
	expect(mountPointingRunning(undefined)).toBeFalse()
	expect(mountPointingRunning({})).toBeTrue()
	expect(mountPointingRunning({ endedAt: 1 })).toBeFalse()
})

test('a snapshot of the sessions leaves a session an event changed during the request', async () => {
	const state = runtime()
	const { promise, resolve } = Promise.withResolvers<Response>()

	const refresh = refreshMountPointing(state, ((url: string) => (url.endsWith('/sessions') ? promise : json(snapshot()))) as unknown as typeof fetch)
	handleMountPointingEvent(state, { type: 'mountPointing:updated', session: { ...CAMERA, revision: 5, state: 'paused' } }, ignore)
	resolve(
		Response.json({
			sessions: [
				{ ...CAMERA, revision: 4 },
				{ ...CAMERA, camera: { connectionId: 'c', deviceId: 'other' } },
			],
		}),
	)
	await refresh

	expect(state.sessions['c:cam'].revision).toBe(5)
	expect(state.sessions['c:other']).toBeDefined()
})

test('a start and a resume carry a token, and a refusal stays with the camera', async () => {
	const state = runtime()
	const bodies: { token?: string }[] = []
	const request = ((_: string, init: RequestInit) => {
		bodies.push(JSON.parse(init.body as string) as { token?: string })
		return json({ error: 'The device is busy' }, 409)
	}) as unknown as typeof fetch

	await startMountPointing(state, 'c', 'cam', mountPointingRequest(DEFAULT_POINTING_MODEL_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_CAMERA_PLATE_SOLVING, { connectionId: 'c', deviceId: 'm' }, false), request)
	await resumeMountPointing(state, CAMERA, request)

	expect(bodies.map((body) => typeof body.token)).toEqual(['string', 'string'])
	expect(state.errors['c:cam']).toBe('The device is busy')
})

test('a preview keeps the plan of its camera and reports a refusal', async () => {
	const state = runtime()
	const mount = { connectionId: 'c', deviceId: 'm' }

	await previewMountPointingPlan(state, 'c:cam', mount, DEFAULT_POINTING_MODEL_SETTINGS, (() => json({ requestedCount: 30, waypoints: [] })) as unknown as typeof fetch)
	expect(state.plans['c:cam'].requestedCount).toBe(30)

	await previewMountPointingPlan(state, 'c:cam', mount, DEFAULT_POINTING_MODEL_SETTINGS, (() => json({ error: 'no site' }, 422)) as unknown as typeof fetch)
	expect(state.errors['c:cam']).toBe('no site')
})
