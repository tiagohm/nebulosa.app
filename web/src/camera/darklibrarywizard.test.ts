import { expect, test } from 'bun:test'
import type { CameraCapabilities, DarkLibraryWizardSessionSummary, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS, DEFAULT_DARK_LIBRARY_WIZARD_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, type DarkLibraryWizardSettings } from '../profile/schema'
import { cameraKey } from './capture'
import {
	continueDarkLibraryWizard,
	darkLibraryWizardBlocker,
	darkLibraryWizardCapture,
	darkLibraryWizardEstimate,
	darkLibraryWizardRequest,
	darkLibraryWizardRunning,
	darkLibraryWizardWarning,
	type DarkLibraryWizardRuntime,
	duplicateDarkGroup,
	handleDarkLibraryWizardEvent,
	pauseDarkLibraryWizard,
	refreshDarkLibraryWizard,
	resumeDarkLibraryWizard,
	startDarkLibraryWizard,
	stopDarkLibraryWizard,
} from './darklibrarywizard'

function newState() {
	return proxy<DarkLibraryWizardRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })
}

const READY = { status: 'ready' } as const
const ONLY_CAMERA = { camera: READY }
const BUSY = { status: 'busy', message: 'The device is busy.' } as never
const KEY = cameraKey('c', 'cam')
const CAMERA = { connectionId: 'c', deviceId: 'cam' }

const CAPABILITIES = {
	exposure: { min: 0.001, max: 3600 },
	gain: { min: 0, max: 100 },
	offset: { min: 0, max: 100 },
	bin: { x: 4, y: 4 },
	sensor: { width: 1000, height: 500, pixelSize: 3.76 },
	subframe: { width: 1000, height: 500 },
	canSetTemperature: true,
	temperature: -5,
	frameFormats: [],
	transferFormats: [],
} as unknown as CameraCapabilities

function summary(patch: Partial<DarkLibraryWizardSessionSummary> = {}): DarkLibraryWizardSessionSummary {
	return { sessionId: 's1', operationId: 'o1', planId: 'p1', camera: CAMERA, cameraName: 'CCD', state: 'exposing', pauseRequested: false, group: 0, groups: [], cleanupWarnings: [], startedAt: 1, revision: 1, ...patch } as DarkLibraryWizardSessionSummary
}

// Fake fetch recording the URLs and answering each with the body its path gives.
function server(answers: Readonly<Record<string, unknown>> = {}) {
	const calls: { url: string; body?: unknown }[] = []

	const request = ((url: string, init?: RequestInit) => {
		calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
		const path = Object.keys(answers).find((prefix) => url.startsWith(prefix))
		return Promise.resolve(path ? Response.json(answers[path]) : new Response(null, { status: 204 }))
	}) as typeof fetch

	return { request, calls }
}

test('a duplicated group goes right below its original', () => {
	const groups = [
		{ exposure: 60, count: 5 },
		{ exposure: 120, temperature: -10, count: 3 },
	]
	expect(duplicateDarkGroup(groups, 0)).toEqual([groups[0], groups[0], groups[1]])
	expect(duplicateDarkGroup(groups, 1)).toEqual([groups[0], groups[1], groups[1]])
	expect(groups).toHaveLength(2)
})

test('a copy blocks the start until one of its settings changes', () => {
	const [group] = DEFAULT_DARK_LIBRARY_WIZARD_SETTINGS.groups
	const groups = duplicateDarkGroup([group], 0)
	const settings = { ...DEFAULT_DARK_LIBRARY_WIZARD_SETTINGS, groups }
	expect(darkLibraryWizardBlocker(ONLY_CAMERA, settings, undefined, CAPABILITIES)).toBe('Group 2 repeats another one.')
	expect(darkLibraryWizardBlocker(ONLY_CAMERA, { ...settings, groups: [group, { ...group, temperature: -10 }] }, undefined, CAPABILITIES)).toBeUndefined()
})

test('the estimate counts the frames, their exposure, and the size of their files', () => {
	const groups = [
		{ exposure: 60, count: 10 },
		{ exposure: 300, count: 2 },
	]
	const capture = darkLibraryWizardCapture({ ...DEFAULT_EXPOSURE_SETTINGS, binX: 2, binY: 2 }, CAPABILITIES)
	const bytes = (channels: number) => 12 * (2 + Math.ceil((500 * 250 * 2 * channels) / 2880)) * 2880
	expect(darkLibraryWizardEstimate(groups, capture, CAPABILITIES)).toEqual({ frames: 12, exposure: 1200, bytes: [bytes(1), bytes(3)] })
	expect(darkLibraryWizardEstimate(groups, capture)).toEqual({ frames: 12, exposure: 1200 })
})

test('the estimate takes the settings a capture gets, not the ones typed', () => {
	const groups = [{ exposure: 1, count: 1 }]
	const size = (patch: Partial<typeof DEFAULT_EXPOSURE_SETTINGS>) => darkLibraryWizardEstimate(groups, darkLibraryWizardCapture({ ...DEFAULT_EXPOSURE_SETTINGS, ...patch }, CAPABILITIES), CAPABILITIES).bytes
	const bytes = (data: number, channels: number) => (2 + Math.ceil((data * channels) / 2880)) * 2880
	const file = (data: number) => [bytes(data, 1), bytes(data, 3)] as const

	expect(size({ subframe: true, x: 0, y: 0, width: 101, height: 64, binX: 2, binY: 2 })).toEqual(file(51 * 32 * 2))
	// A subframe wider than the sensor is clamped, and one without a size is the whole sensor.
	expect(size({ subframe: true, x: 0, y: 0, width: 5000, height: 100 })).toEqual(file(1000 * 100 * 2))
	expect(size({ subframe: true, width: 0, height: 0 })).toEqual(file(1000 * 500 * 2))
	// A binning the camera does not have is clamped.
	expect(size({ binX: 8, binY: 8 })).toEqual(file(250 * 125 * 2))
})

test('the estimate is one header block above the files the simulator camera writes', () => {
	const capabilities = { ...CAPABILITIES, bin: { x: 4, y: 4 }, sensor: { width: 1280, height: 1024, pixelSize: 3.76 }, subframe: { width: 1280, height: 1024 }, frameFormats: [{ name: 'RGB', label: 'RGB' }] }
	const bytes = (patch: Partial<typeof DEFAULT_EXPOSURE_SETTINGS>) => darkLibraryWizardEstimate([{ exposure: 1, count: 1 }], darkLibraryWizardCapture({ ...DEFAULT_EXPOSURE_SETTINGS, ...patch }, capabilities), capabilities).bytes

	// Sizes in bytes of the files the simulator wrote for these settings.
	expect(bytes({})).toEqual([2629440, 7871040])
	expect(bytes({ binX: 2, binY: 2 })).toEqual([659520 + 2880, 1972800])
	expect(bytes({ binX: 3, binY: 3 })).toEqual([296640 + 2880, 884160])
	expect(bytes({ binX: 4, binY: 2 })).toEqual([331200 + 2880, 990720])
	expect(bytes({ subframe: true, x: 10, y: 20, width: 256, height: 128 })).toEqual([69120 + 2880, 204480])
	expect(bytes({ subframe: true, x: 10, y: 20, width: 256, height: 128, binX: 2, binY: 2 })).toEqual([20160 + 2880, 57600])
	expect(bytes({ subframe: true, width: 101, height: 65, binX: 2, binY: 2 })).toEqual([8640 + 2880, 17280])
	expect(bytes({ frameFormat: 'RGB' })).toEqual([2629440, 7871040])
	expect(bytes({ subframe: true, x: 10, y: 20, width: 256, height: 128, binX: 2, binY: 2, frameFormat: 'RGB' })).toEqual([23040, 57600])
	expect(bytes({ subframe: true, x: 0, y: 0, width: 99999, height: 100, frameFormat: 'RGB' })).toEqual([262080, 771840 + 2880])
})

test('a request takes every camera setting of Camera Acquisition but its exposure, and sends only what was selected', () => {
	const groups = [{ exposure: 60, count: 3 }]
	const settings: DarkLibraryWizardSettings = { ...DEFAULT_DARK_LIBRARY_WIZARD_SETTINGS, groups, useDarkFilter: true, darkSlot: 4, directory: '/darks' }
	const wheel = { connectionId: 'c', deviceId: 'wheel' }
	const panel = { connectionId: 'c', deviceId: 'panel' }
	const exposure = { ...DEFAULT_EXPOSURE_SETTINGS, offset: 20, gain: 500, binX: 2, binY: 2, exposureTime: 123, subframe: true, x: 10, y: 20, width: 100, height: 100 }
	const request = darkLibraryWizardRequest(settings, exposure, { wheel, panel }, {}, CAPABILITIES)

	expect(request).toMatchObject({ capture: { gain: 100, offset: 20, binX: 2, binY: 2, subframe: true, x: 10, y: 20, width: 100, height: 100 }, groups, protection: { darkFilter: { slot: 4 }, panelOff: false, manualCap: true }, wheel, directory: '/darks', maximumRejections: 5 })
	expect(request.capture).not.toHaveProperty('exposureTime')
	expect(request.panel).toBeUndefined()
})

test('a start is blocked by what it selected and cannot use, never by what it did not select', () => {
	const blocker = (patch: Partial<DarkLibraryWizardSettings>, availability: Parameters<typeof darkLibraryWizardBlocker>[0] = ONLY_CAMERA, wheel?: { count: number }, capabilities: CameraCapabilities = CAPABILITIES) =>
		darkLibraryWizardBlocker(availability, { ...DEFAULT_DARK_LIBRARY_WIZARD_SETTINGS, ...patch }, wheel, capabilities)

	expect(blocker({})).toBeUndefined()
	expect(blocker({}, { camera: BUSY })).toBe('The device is busy.')
	expect(blocker({ manualCap: false })).toBe('Select how the light is blocked.')
	expect(blocker({ closeCover: true })).toBe('The setup has no cover.')
	expect(blocker({ panelOff: true })).toBe('The setup has no flat panel.')
	expect(blocker({ useDarkFilter: true })).toBe('The setup has no filter wheel.')
	expect(blocker({ useDarkFilter: true }, { camera: READY, wheel: BUSY })).toBe('The device is busy.')
	expect(blocker({}, { camera: READY, wheel: BUSY, cover: BUSY, panel: BUSY })).toBeUndefined()
	expect(blocker({ useDarkFilter: true, darkSlot: 7 }, { camera: READY, wheel: READY }, { count: 7 })).toBe('The wheel has no slot 8.')
	expect(blocker({ groups: [] })).toBe('Add a group of frames.')
	expect(blocker({ groups: [{ exposure: 7200, count: 1 }] })).toContain('outside what the camera accepts')
	expect(
		blocker({
			groups: [
				{ exposure: 1, count: 1 },
				{ exposure: 1, count: 2 },
			],
		}),
	).toBe('Group 2 repeats another one.')
	expect(blocker({ groups: Array.from({ length: DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS + 1 }, (_, exposure) => ({ exposure: exposure + 1, count: 1 })) })).toContain('at most 64 groups')
	expect(blocker({ groups: Array.from({ length: 41 }, (_, exposure) => ({ exposure: exposure + 1, count: 500 })) })).toContain('at most 20000 frames')
	expect(blocker({ groups: [{ exposure: 1, temperature: -10, count: 1 }] }, undefined, undefined, { ...CAPABILITIES, canSetTemperature: false })).toContain('target temperature')
})

test('the warning above Start names what no device verifies', () => {
	const protection = { manualCap: false, useDarkFilter: false, darkSlot: 0, panelOff: false, closeCover: false }
	expect(darkLibraryWizardWarning({ ...protection, manualCap: true })).toBe('Before starting, make sure that an opaque cap covers the optical path.')
	expect(darkLibraryWizardWarning({ ...protection, manualCap: true, useDarkFilter: true, darkSlot: 2 })).toBe('Before starting, make sure that an opaque cap covers the optical path and the filter at slot 3 is opaque.')
	expect(darkLibraryWizardWarning({ ...protection, panelOff: true })).toContain('the unlit flat panel blocks the outside light')
	expect(darkLibraryWizardWarning({ ...protection, panelOff: true, closeCover: true })).toBeUndefined()
	expect(darkLibraryWizardWarning({ ...protection, closeCover: true })).toBeUndefined()
})

test('a session runs until it ended', () => {
	expect(darkLibraryWizardRunning(undefined)).toBeFalse()
	expect(darkLibraryWizardRunning({})).toBeTrue()
	expect(darkLibraryWizardRunning({ endedAt: 1 })).toBeFalse()
})

test('a late event never replaces a newer state', () => {
	const state = newState()
	const { request } = server()
	const event = (session: DarkLibraryWizardSessionSummary): ServerEvent => ({ type: 'darkLibraryWizard:updated', session })

	handleDarkLibraryWizardEvent(state, event(summary({ revision: 5 })), request)
	handleDarkLibraryWizardEvent(state, event(summary({ revision: 4, state: 'cooling' })), request)
	expect(state.sessions[KEY]).toMatchObject({ revision: 5, state: 'exposing' })

	handleDarkLibraryWizardEvent(state, event(summary({ sessionId: 'old', startedAt: 0, revision: 9 })), request)
	expect(state.sessions[KEY].sessionId).toBe('s1')

	handleDarkLibraryWizardEvent(state, { type: 'capture:updated' } as never, request)
	expect(state.sessions[KEY].revision).toBe(5)
})

test('a snapshot replaces the sessions, and fetches their records', async () => {
	const state = newState()
	state.sessions.gone = summary({ sessionId: 'gone' })
	const session = summary()
	const { request, calls } = server({ '/api/dark-library-wizard/s1': { ...session, attempts: [] }, '/api/dark-library-wizard': { sessions: [session] } })
	await refreshDarkLibraryWizard(state, request)
	expect(Object.keys(state.sessions)).toEqual([KEY])
	expect(calls.map(({ url }) => url)).toContain('/api/dark-library-wizard/s1')
})

test('a snapshot leaves a session an event ended during its request', async () => {
	const state = newState()
	const snapshot = Promise.withResolvers<Response>()
	const ended = summary({ state: 'completed', endedAt: 5000, revision: 2 })
	const request = ((url: string) => (url === '/api/dark-library-wizard' ? snapshot.promise : Promise.resolve(Response.json({ ...ended, attempts: [] })))) as typeof fetch

	const refreshing = refreshDarkLibraryWizard(state, request)
	handleDarkLibraryWizardEvent(state, { type: 'darkLibraryWizard:updated', session: ended }, request)
	snapshot.resolve(Response.json({ sessions: [summary()] }))
	await refreshing

	expect(state.sessions[KEY].endedAt).toBe(5000)
})

test('commands address the exact camera and session, with a token and the step id', async () => {
	const state = newState()
	const { request, calls } = server()
	const session = summary()

	await startDarkLibraryWizard(state, 'c', 'cam', { maximumRejections: 1 } as never, request)
	await continueDarkLibraryWizard(state, session, 'step', request)
	await pauseDarkLibraryWizard(state, session, request)
	await resumeDarkLibraryWizard(state, session, request)
	await stopDarkLibraryWizard(state, session, request)

	expect(calls[0].url).toEndWith('/dark-library-wizard')
	expect(calls[0].body).toMatchObject({ maximumRejections: 1, token: expect.any(String) })
	expect(calls.slice(1).map(({ url }) => url)).toEqual(['continue', 'pause', 'resume', 'stop'].map((action) => `/api/dark-library-wizard/s1/${action}`))
	expect(calls[1].body).toEqual({ stepId: 'step' })
	expect(state.pending).toEqual({})
})

test('a refused command is recorded for its camera, and an unreachable server refreshes the sessions', async () => {
	const state = newState()
	await stopDarkLibraryWizard(state, summary(), (() => Promise.resolve(Response.json({ error: 'No', code: 'notRunning' }, { status: 409 }))) as unknown as typeof fetch)
	expect(state.errors[KEY]).toBe('No')

	await stopDarkLibraryWizard(state, summary(), (() => Promise.reject(new Error('down'))) as unknown as typeof fetch)
	expect(state.errors[KEY]).toBe('Unable to reach the server.')
})
