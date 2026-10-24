import { expect, test } from 'bun:test'
import type { FlatWizardSession, FlatWizardSessionSummary } from 'api'
import { proxy } from 'valtio'
import { DEFAULT_EXPOSURE_SETTINGS, DEFAULT_FLAT_WIZARD_FILTER, DEFAULT_FLAT_WIZARD_SETTINGS, type FlatWizardSettings } from '../profile/schema'
import { cameraKey } from './capture'
import { continueFlatWizard, flatWizardBlocker, flatWizardFilterName, flatWizardFrameProgress, flatWizardRequest, flatWizardRunning, type FlatWizardRuntime, handleFlatWizardEvent, refreshFlatWizard, startFlatWizard, stopFlatWizard } from './flatwizard'

function newState() {
	return proxy<FlatWizardRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })
}

const READY = { status: 'ready' } as const

const KEY = cameraKey('c', 'cam')

function summary(patch: Partial<FlatWizardSessionSummary> = {}): FlatWizardSessionSummary {
	return {
		sessionId: 's1',
		operationId: 'o1',
		camera: { connectionId: 'c', deviceId: 'cam' },
		cameraName: 'Camera',
		request: flatWizardRequest(DEFAULT_FLAT_WIZARD_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, {}, {}),
		state: 'exposing',
		filter: 0,
		filters: [],
		startedAt: 1000,
		revision: 1,
		...patch,
	}
}

function details(patch: Partial<FlatWizardSession> = {}): FlatWizardSession {
	return { ...summary(), attempts: [], ...patch }
}

// Fetch fake answering each URL with the response its handler builds, recording the requests.
function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
	const requests: { url: string; init?: RequestInit }[] = []
	const request = ((url: string, init?: RequestInit) => {
		requests.push({ url, init })
		return Promise.resolve(handler(url, init))
	}) as typeof fetch
	return { request, requests }
}

test('the request takes the camera settings without the exposure, the slot always, and the brightness only with a panel', () => {
	const settings: FlatWizardSettings = { ...DEFAULT_FLAT_WIZARD_SETTINGS, filters: [{ ...DEFAULT_FLAT_WIZARD_FILTER, slot: 2, brightness: 80 }], directory: '/flats', effectiveClip: 60000 }
	const exposure = { ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 5, gain: 100 }
	const wheel = { connectionId: 'c', deviceId: 'w' }
	const panel = { connectionId: 'c', deviceId: 'p' }

	const manual = flatWizardRequest(settings, exposure, {}, { mount: 'm' })
	expect('exposureTime' in manual.capture).toBeFalse()
	expect(manual.capture.gain).toBe(100)
	expect(manual.filters[0].slot).toBe(2)
	expect(manual.filters[0].brightness).toBeUndefined()
	expect(manual).toMatchObject({ directory: '/flats', effectiveClip: 60000, snoop: { mount: 'm' } })
	expect('wheel' in manual || 'panel' in manual || 'cover' in manual).toBeFalse()

	const cover = { connectionId: 'c', deviceId: 'cv' }
	const assigned = flatWizardRequest(settings, exposure, { wheel, panel, cover }, {})
	expect(assigned).toMatchObject({ wheel, panel, cover, filters: [{ slot: 2, brightness: 80 }] })
})

test('an assigned device that cannot be used, or an incomplete form, blocks the start', () => {
	const busy = { status: 'busy', operations: [], message: 'The Filter Wheel is busy.' } as const
	expect(flatWizardBlocker(READY, undefined, undefined, DEFAULT_FLAT_WIZARD_SETTINGS)).toBeUndefined()
	expect(flatWizardBlocker({ status: 'disconnected', message: 'The camera is disconnected.' }, undefined, undefined, DEFAULT_FLAT_WIZARD_SETTINGS)).toBe('The camera is disconnected.')
	expect(flatWizardBlocker(READY, busy, undefined, DEFAULT_FLAT_WIZARD_SETTINGS)).toBe('The Filter Wheel is busy.')
	expect(flatWizardBlocker(READY, undefined, undefined, DEFAULT_FLAT_WIZARD_SETTINGS, undefined, { status: 'unsupported', message: 'The cover cannot be opened and closed.' })).toBe('The cover cannot be opened and closed.')
	const wheelState = { count: 3, names: ['L', 'R', ''] }
	expect(flatWizardBlocker(READY, READY, undefined, { ...DEFAULT_FLAT_WIZARD_SETTINGS, filters: [{ ...DEFAULT_FLAT_WIZARD_FILTER, slot: 3 }] }, wheelState)).toBe('The wheel has no slot 4.')
	expect(flatWizardBlocker(READY, READY, undefined, { ...DEFAULT_FLAT_WIZARD_SETTINGS, filters: [{ ...DEFAULT_FLAT_WIZARD_FILTER, slot: 1, targetRange: [5, 5] }] }, wheelState)).toBe('The target of R is empty.')
	expect(flatWizardBlocker(READY, undefined, undefined, { ...DEFAULT_FLAT_WIZARD_SETTINGS, filters: [{ ...DEFAULT_FLAT_WIZARD_FILTER, slot: 7 }] }, wheelState)).toBeUndefined()
	expect(flatWizardBlocker(READY, undefined, undefined, { ...DEFAULT_FLAT_WIZARD_SETTINGS, filters: [{ ...DEFAULT_FLAT_WIZARD_FILTER, targetRange: [5, 5] }] })).toContain('target')
})

test('events are applied in revision order and a new exposure or the end fetches the record', async () => {
	const state = newState()
	const { request, requests } = fakeFetch(() => Response.json(details({ revision: 3 })))

	handleFlatWizardEvent(state, { type: 'flatWizard:updated', session: summary({ revision: 2 }) }, request)
	expect(state.sessions[KEY].revision).toBe(2)
	expect(requests).toHaveLength(1)

	handleFlatWizardEvent(state, { type: 'flatWizard:updated', session: summary({ revision: 1, state: 'failed' }) }, request)
	expect(state.sessions[KEY].state).toBe('exposing')

	handleFlatWizardEvent(state, { type: 'flatWizard:updated', session: summary({ revision: 3, state: 'measuring' }) }, request)
	expect(requests).toHaveLength(1)

	const attempt = { index: 1, filter: 0, kind: 'trial', exposure: 1, time: 1, planes: [], verdict: 'usable', reasons: [] } as const
	handleFlatWizardEvent(state, { type: 'flatWizard:updated', session: summary({ revision: 4, lastAttempt: attempt }) }, request)
	handleFlatWizardEvent(state, { type: 'flatWizard:updated', session: summary({ revision: 5, lastAttempt: attempt, state: 'completed', endedAt: 9 }) }, request)
	expect(requests.map((r) => r.url)).toEqual(['/api/flat-wizard/s1', '/api/flat-wizard/s1', '/api/flat-wizard/s1'])
	await Bun.sleep(0)
	expect(state.details.s1.revision).toBe(3)
	expect(flatWizardRunning(state.sessions[KEY])).toBeFalse()
})

test('an older session of the camera never replaces a newer one, and a newer one drops the old record', () => {
	const state = newState()
	const { request } = fakeFetch(() => new Response(null, { status: 404 }))
	state.details.s1 = details()

	handleFlatWizardEvent(state, { type: 'flatWizard:updated', session: summary({ sessionId: 's2', startedAt: 2000 }) }, request)
	expect(state.sessions[KEY].sessionId).toBe('s2')
	expect(state.details.s1).toBeUndefined()

	handleFlatWizardEvent(state, { type: 'flatWizard:updated', session: summary({ sessionId: 's1', startedAt: 1000, revision: 9 }) }, request)
	expect(state.sessions[KEY].sessionId).toBe('s2')
})

test('the snapshot replaces the sessions, and a late snapshot is dropped', async () => {
	const state = newState()
	const late = Promise.withResolvers<Response>()
	const slow = fakeFetch((url) => (url === '/api/flat-wizard' ? late.promise : Response.json(details())))
	const fast = fakeFetch((url) => (url === '/api/flat-wizard' ? Response.json({ sessions: [summary({ sessionId: 'new' })] }) : Response.json(details({ sessionId: 'new' }))))

	const first = refreshFlatWizard(state, slow.request)
	await refreshFlatWizard(state, fast.request)
	late.resolve(Response.json({ sessions: [summary({ sessionId: 'old' })] }))
	await first
	expect(state.sessions[KEY].sessionId).toBe('new')
})

test('commands carry a fresh token, the step id, and record failures', async () => {
	const state = newState()
	const { request, requests } = fakeFetch((url) => (url.endsWith('/continue') ? Response.json({ error: 'The Flat Wizard session is not waiting for this step', code: 'staleStep' }, { status: 409 }) : new Response(null, { status: 202 })))
	const body = flatWizardRequest(DEFAULT_FLAT_WIZARD_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, {}, {})

	await startFlatWizard(state, 'c', 'cam', body, request)
	await startFlatWizard(state, 'c', 'cam', body, request)
	const tokens = requests.map((r) => (JSON.parse(r.init!.body as string) as { token: string }).token)
	expect(requests[0].url).toBe('/api/connections/c/cameras/cam/flat-wizard')
	expect(new Set(tokens).size).toBe(2)

	await continueFlatWizard(state, summary(), 'step-1', request)
	expect(requests[2]).toMatchObject({ url: '/api/flat-wizard/s1/continue' })
	expect(JSON.parse(requests[2].init!.body as string)).toEqual({ stepId: 'step-1' })
	expect(state.errors[KEY]).toBe('The Flat Wizard session is not waiting for this step')

	await stopFlatWizard(state, summary(), request)
	expect(requests[3].url).toBe('/api/flat-wizard/s1/stop')
	expect(state.errors[KEY]).toBeUndefined()
	expect(state.pending[KEY]).toBeUndefined()
})

test('a filter is named as the wheel names its slot, or by its 1-based slot number', () => {
	expect(flatWizardFilterName(['Luminance', ' ', 'Red'], 0)).toBe('Luminance')
	expect(flatWizardFilterName(['Luminance', ' ', 'Red'], 1)).toBe('Filter 2')
	expect(flatWizardFilterName(['Luminance'], 4)).toBe('Filter 5')
	expect(flatWizardFilterName(undefined, 2)).toBe('Filter 3')
})

test('the frame progress converts the driver countdown to seconds and a bounded fraction', () => {
	expect(flatWizardFrameProgress(undefined)).toBeUndefined()
	expect(flatWizardFrameProgress({ elapsedTime: 2_500_000, remainingTime: 7_500_000, progress: 25 })).toEqual({ elapsed: 2.5, remaining: 7.5, fraction: 0.25 })
	expect(flatWizardFrameProgress({ elapsedTime: 10_000_000, remainingTime: -1, progress: 104 })).toEqual({ elapsed: 10, remaining: 0, fraction: 1 })
	expect(flatWizardFrameProgress({ elapsedTime: 0, remainingTime: 0, progress: Number.NaN })).toBeUndefined()
})
