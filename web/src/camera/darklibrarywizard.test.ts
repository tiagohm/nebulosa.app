import { expect, test } from 'bun:test'
import type { CameraCapabilities, DarkLibraryWizardSessionSummary, DarkPlanDetail, DarkPlanSummary, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS, DEFAULT_DARK_LIBRARY_WIZARD_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, type DarkLibraryWizardSettings } from '../profile/schema'
import { cameraKey } from './capture'
import {
	completeDarkPlan,
	continueDarkLibraryWizard,
	darkLibraryWizardBlocker,
	darkLibraryWizardEstimate,
	darkLibraryWizardRequest,
	darkLibraryWizardRunning,
	type DarkLibraryWizardRuntime,
	darkPlanForm,
	expandDarkMatrix,
	handleDarkLibraryWizardEvent,
	loadDarkPlans,
	parseDarkValues,
	pauseDarkLibraryWizard,
	refreshDarkLibraryWizard,
	resumeDarkLibraryWizard,
	startDarkLibraryWizard,
	stopDarkLibraryWizard,
} from './darklibrarywizard'

function newState() {
	return proxy<DarkLibraryWizardRuntime>({ sessions: {}, details: {}, plans: {}, pending: {}, errors: {} })
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

test('a list a person typed gives its numbers once, in order', () => {
	expect(parseDarkValues('60, 120 180;300,, x 60')).toEqual([60, 120, 180, 300])
	expect(parseDarkValues('-10 -20')).toEqual([-10, -20])
	expect(parseDarkValues('')).toEqual([])
})

test('a matrix adds every combination after the rows, repeating none', () => {
	const groups = expandDarkMatrix([{ exposure: 60, gain: 0, temperature: -10, count: 5 }], [60, 120], [0, 100], [-10], 30)
	expect(groups.map(({ exposure, gain, temperature, count }) => [exposure, gain, temperature, count])).toEqual([
		[60, 0, -10, 5],
		[120, 0, -10, 30],
		[60, 100, -10, 30],
		[120, 100, -10, 30],
	])
	expect(expandDarkMatrix([], [60], [0], [], 1)).toEqual([{ exposure: 60, gain: 0, count: 1 }])
})

test('the estimate counts frames, exposure, and the raw size of the binned frame', () => {
	const groups = [
		{ exposure: 60, gain: 0, count: 10 },
		{ exposure: 300, gain: 0, count: 2 },
	]
	const exposure = { ...DEFAULT_EXPOSURE_SETTINGS, binX: 2, binY: 2 }
	expect(darkLibraryWizardEstimate({ groups, fullSensor: true }, exposure, CAPABILITIES)).toEqual({ frames: 12, exposure: 1200, bytes: 12 * (5760 + 500 * 250 * 2) })
	expect(darkLibraryWizardEstimate({ groups, fullSensor: false }, { ...exposure, subframe: true, width: 100, height: 100 }, CAPABILITIES).bytes).toBe(12 * (5760 + 50 * 50 * 2))
	expect(darkLibraryWizardEstimate({ groups, fullSensor: true }, exposure)).toEqual({ frames: 12, exposure: 1200 })
})

test('a request takes the settings of the camera, drops its exposure and subframe, and sends only what was selected', () => {
	const settings: DarkLibraryWizardSettings = { ...DEFAULT_DARK_LIBRARY_WIZARD_SETTINGS, groups: [{ exposure: 60, gain: 500, count: 3 }], useDarkFilter: true, darkSlot: 4, directory: '/darks' }
	const wheel = { connectionId: 'c', deviceId: 'wheel' }
	const panel = { connectionId: 'c', deviceId: 'panel' }
	const exposure = { ...DEFAULT_EXPOSURE_SETTINGS, offset: 20, gain: 7, exposureTime: 123, subframe: true, width: 100, height: 100 }
	const request = darkLibraryWizardRequest(settings, exposure, { wheel, panel }, {}, CAPABILITIES)

	expect(request).toMatchObject({ capture: { offset: 20, subframe: false, width: 0, height: 0 }, groups: [{ exposure: 60, gain: 100, count: 3 }], protection: { darkFilter: { slot: 4 }, panelOff: false, manualCap: true }, wheel, directory: '/darks', maximumRejections: 5 })
	expect(request.capture).not.toHaveProperty('exposureTime')
	expect(request.capture).not.toHaveProperty('gain')
	expect(request.panel).toBeUndefined()
	expect(darkLibraryWizardRequest({ ...settings, fullSensor: false }, exposure, {}, {}, CAPABILITIES).capture).toMatchObject({ subframe: true, width: 100, height: 100 })
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
	expect(blocker({ groups: [{ exposure: 7200, gain: 0, count: 1 }] })).toContain('outside what the camera accepts')
	expect(
		blocker({
			groups: [
				{ exposure: 1, gain: 0, count: 1 },
				{ exposure: 1, gain: 0, count: 2 },
			],
		}),
	).toBe('Group 2 repeats another one.')
	expect(blocker({ groups: Array.from({ length: DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS + 1 }, (_, exposure) => ({ exposure: exposure + 1, gain: 0, count: 1 })) })).toContain('at most 64 groups')
	expect(blocker({ groups: Array.from({ length: 41 }, (_, exposure) => ({ exposure: exposure + 1, gain: 0, count: 500 })) })).toContain('at most 20000 frames')
	expect(blocker({ groups: [{ exposure: 1, gain: 0, temperature: -10, count: 1 }] }, undefined, undefined, { ...CAPABILITIES, canSetTemperature: false })).toContain('target temperature')
})

test('a plan fills the form with its settings', () => {
	const form = darkPlanForm({
		plan: {
			groups: [{ exposure: 60, gain: 1, temperature: -10, count: 5, groupId: 'g', key: 'k', directory: '/x' }],
			protection: { darkFilter: { slot: 3 }, closeCover: true, panelOff: false, manualCap: false, verifyFirstFrame: false },
			thermal: { tolerance: 1, hold: 2, timeout: 3 },
			maximumRejections: 4,
			capture: { subframe: true },
			directory: '/darks',
		},
	} as unknown as Pick<DarkPlanDetail, 'plan'>)
	expect(form).toEqual({ groups: [{ exposure: 60, gain: 1, temperature: -10, count: 5 }], fullSensor: false, useDarkFilter: true, darkSlot: 3, closeCover: true, panelOff: false, manualCap: false, verifyFirstFrame: false, tolerance: 1, hold: 2, timeout: 3, directory: '/darks', maximumRejections: 4 })
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

test('the plans of a camera are fetched when a session starts and ends, not on every event', async () => {
	const state = newState()
	const plans: DarkPlanSummary[] = [{ planId: 'p1' } as DarkPlanSummary]
	const { request, calls } = server({ '/api/dark-library-wizard/plans': { plans }, '/api/dark-library-wizard/s1': summary() })
	const planCalls = () => calls.filter(({ url }) => url.includes('/plans')).length

	handleDarkLibraryWizardEvent(state, { type: 'darkLibraryWizard:updated', session: summary() }, request)
	handleDarkLibraryWizardEvent(state, { type: 'darkLibraryWizard:updated', session: summary({ revision: 2 }) }, request)
	expect(planCalls()).toBe(1)
	handleDarkLibraryWizardEvent(state, { type: 'darkLibraryWizard:updated', session: summary({ revision: 3, endedAt: 9 }) }, request)
	expect(planCalls()).toBe(2)

	await loadDarkPlans(state, 'c', 'cam', request)
	expect(state.plans[KEY]).toEqual(plans)
})

test('a snapshot replaces the sessions, and fetches their records and plans', async () => {
	const state = newState()
	state.sessions.gone = summary({ sessionId: 'gone' })
	const session = summary()
	const { request, calls } = server({ '/api/dark-library-wizard/plans': { plans: [] }, '/api/dark-library-wizard/s1': { ...session, attempts: [] }, '/api/dark-library-wizard': { sessions: [session] } })
	await refreshDarkLibraryWizard(state, request)
	expect(Object.keys(state.sessions)).toEqual([KEY])
	expect(calls.map(({ url }) => url)).toContain('/api/dark-library-wizard/plans?connectionId=c&deviceId=cam')
})

test('commands address the exact camera and session, with a token and the step id', async () => {
	const state = newState()
	const { request, calls } = server()
	const session = summary()

	await startDarkLibraryWizard(state, 'c', 'cam', { maximumRejections: 1 } as never, request)
	await completeDarkPlan(state, 'c', 'cam', { resumePlanId: 'p1' }, request)
	await continueDarkLibraryWizard(state, session, 'step', request)
	await pauseDarkLibraryWizard(state, session, request)
	await resumeDarkLibraryWizard(state, session, request)
	await stopDarkLibraryWizard(state, session, request)

	expect(calls[0].url).toEndWith('/dark-library-wizard')
	expect(calls[0].body).toMatchObject({ maximumRejections: 1, token: expect.any(String) })
	expect(calls[1].body).toMatchObject({ resumePlanId: 'p1', token: expect.any(String) })
	expect(calls.slice(2).map(({ url }) => url)).toEqual(['continue', 'pause', 'resume', 'stop'].map((action) => `/api/dark-library-wizard/s1/${action}`))
	expect(calls[2].body).toEqual({ stepId: 'step' })
	expect(state.pending).toEqual({})
})

test('a refused command is recorded for its camera, and an unreachable server refreshes the sessions', async () => {
	const state = newState()
	await stopDarkLibraryWizard(state, summary(), (() => Promise.resolve(Response.json({ error: 'No', code: 'notRunning' }, { status: 409 }))) as unknown as typeof fetch)
	expect(state.errors[KEY]).toBe('No')

	await stopDarkLibraryWizard(state, summary(), (() => Promise.reject(new Error('down'))) as unknown as typeof fetch)
	expect(state.errors[KEY]).toBe('Unable to reach the server.')
})
