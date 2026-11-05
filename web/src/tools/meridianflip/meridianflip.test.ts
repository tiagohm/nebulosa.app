import { describe, expect, test } from 'bun:test'
import type { MeridianFlipEvent, MeridianFlipMonitor, MeridianFlipSnapshot, MeridianFlipTransition } from 'api'
import { proxy } from 'valtio'
import { DEFAULT_MERIDIAN_FLIP_SETTINGS, MERIDIAN_FLIP_MAXIMUM_SECONDS } from '../../profile/schema'
import {
	applyMeridianFlipSnapshot,
	enableMeridianFlip,
	handleMeridianFlipEvent,
	loadMeridianFlipTransitions,
	MERIDIAN_FLIP_STALE_AFTER,
	meridianFlipHeadline,
	meridianFlipStatusText,
	type MeridianFlipState,
	monitorKey,
	normalizeMeridianFlipSettings,
	refreshMeridianFlip,
	secondsToTransit,
	updateMeridianFlipSettings,
} from './meridianflip'

function newState() {
	return proxy<MeridianFlipState>({ revision: 0, monitors: {}, transitions: {}, pending: {}, errors: {} })
}

function monitor(revision: number, overrides: Partial<MeridianFlipMonitor> = {}): MeridianFlipMonitor {
	return {
		monitorId: 'm1',
		connectionId: 'c',
		deviceId: 'd',
		revision,
		settings: DEFAULT_MERIDIAN_FLIP_SETTINGS,
		settingsRevision: 1,
		sampledAt: 1000,
		mount: { mountType: 'EQ_GEM', pierSide: 'WEST', tracking: true, trackMode: 'SIDEREAL' },
		availability: 'monitoring',
		timing: { phase: 'before', quality: 'valid', secondsToTransit: 600 },
		mechanical: 'notDue',
		...overrides,
	}
}

function updated(epoch: string, revision: number, value?: MeridianFlipMonitor): MeridianFlipEvent {
	return { type: 'meridianFlip:updated', epoch, revision, key: { connectionId: 'c', deviceId: 'd' }, monitor: value }
}

function transition(id: string, at: number, monitorId = 'm1'): MeridianFlipTransition {
	return { transitionId: id, kind: 'approaching', monitorId, connectionId: 'c', deviceId: 'd', revision: at, at, phase: 'approaching', mechanical: 'notDue', pierSide: 'WEST' }
}

const KEY = monitorKey('c', 'd')

describe('mirror', () => {
	test('applies updates in revision order and drops older ones', () => {
		const state = newState()
		handleMeridianFlipEvent(state, updated('e', 1, monitor(1)))
		handleMeridianFlipEvent(state, updated('e', 2))
		handleMeridianFlipEvent(state, updated('e', 1, monitor(1)))
		expect(state.monitors).toEqual({})
		expect(state.revision).toBe(2)
	})

	test('drops a snapshot older than the events and starts over in a new epoch', () => {
		const state = newState()
		const stale: MeridianFlipSnapshot = { epoch: 'e', revision: 1, monitors: [monitor(1)] }
		handleMeridianFlipEvent(state, updated('e', 2))
		applyMeridianFlipSnapshot(state, stale)
		expect(state.monitors).toEqual({})

		applyMeridianFlipSnapshot(state, { epoch: 'f', revision: 1, monitors: [monitor(1)] })
		expect(Object.keys(state.monitors)).toEqual([KEY])
		handleMeridianFlipEvent(state, updated('g', 1))
		expect(state.monitors).toEqual({})
		expect(state.epoch).toBe('g')
	})

	test('keeps the transitions of the current enablement only, once each and in order', () => {
		const state = newState()
		handleMeridianFlipEvent(state, updated('e', 1, monitor(1)))
		handleMeridianFlipEvent(state, { type: 'meridianFlip:transition', epoch: 'e', transition: transition('t2', 20) })
		handleMeridianFlipEvent(state, { type: 'meridianFlip:transition', epoch: 'e', transition: transition('t1', 10) })
		handleMeridianFlipEvent(state, { type: 'meridianFlip:transition', epoch: 'e', transition: transition('t1', 10) })
		handleMeridianFlipEvent(state, { type: 'meridianFlip:transition', epoch: 'old', transition: transition('t3', 30) })
		handleMeridianFlipEvent(state, { type: 'meridianFlip:transition', epoch: 'e', transition: transition('t4', 40, 'other') })
		expect(state.transitions[KEY]?.map((t) => t.transitionId)).toEqual(['t1', 't2'])

		handleMeridianFlipEvent(state, updated('e', 2, monitor(2, { monitorId: 'm2' })))
		expect(state.transitions[KEY]).toBeUndefined()
	})

	test('refresh drops a response superseded by another refresh', async () => {
		const state = newState()
		let resolveFirst: (response: Response) => void = () => {}
		const first = new Promise<Response>((resolve) => {
			resolveFirst = resolve
		})
		const requests = [() => first, () => Promise.resolve(Response.json({ epoch: 'e', revision: 4, monitors: [monitor(4)] } satisfies MeridianFlipSnapshot))]
		const request = (() => requests.shift()!()) as unknown as typeof fetch

		const older = refreshMeridianFlip(state, request)
		await refreshMeridianFlip(state, request)
		resolveFirst(Response.json({ epoch: 'e', revision: 1, monitors: [] } satisfies MeridianFlipSnapshot))
		await older

		expect(Object.keys(state.monitors)).toEqual([KEY])
	})

	test('loaded transitions merge with the received ones', async () => {
		const state = newState()
		handleMeridianFlipEvent(state, updated('e', 1, monitor(1)))
		handleMeridianFlipEvent(state, { type: 'meridianFlip:transition', epoch: 'e', transition: transition('t2', 20) })
		const request = (() => Promise.resolve(Response.json({ transitions: [transition('t1', 10), transition('t2', 20)] }))) as unknown as typeof fetch
		await loadMeridianFlipTransitions(state, 'c', 'd', request)
		expect(state.transitions[KEY]?.map((t) => t.transitionId)).toEqual(['t1', 't2'])
	})
})

describe('requests', () => {
	test('an enable response never replaces a newer event', async () => {
		const state = newState()
		handleMeridianFlipEvent(state, updated('e', 3, monitor(3, { settingsRevision: 2 })))
		const request = (() => Promise.resolve(Response.json(monitor(2)))) as unknown as typeof fetch
		expect(await enableMeridianFlip(state, 'c', 'd', DEFAULT_MERIDIAN_FLIP_SETTINGS, request)).toBe(true)
		expect(state.monitors[KEY]?.settingsRevision).toBe(2)
		expect(state.pending).toEqual({})
	})

	test('a settings conflict keeps the current monitor and the message', async () => {
		const state = newState()
		handleMeridianFlipEvent(state, updated('e', 1, monitor(1)))
		const current = monitor(5, { settingsRevision: 3 })
		const request = (() => Promise.resolve(Response.json({ error: 'The settings were changed by another tab', code: 'conflict', monitor: current }, { status: 409 }))) as unknown as typeof fetch
		expect(await updateMeridianFlipSettings(state, 'c', 'd', DEFAULT_MERIDIAN_FLIP_SETTINGS, 1, request)).toBe(false)
		expect(state.monitors[KEY]?.settingsRevision).toBe(3)
		expect(state.errors[KEY]).toBe('The settings were changed by another tab')
	})
})

describe('settings', () => {
	test('are kept within what the server accepts', () => {
		expect(normalizeMeridianFlipSettings(DEFAULT_MERIDIAN_FLIP_SETTINGS)).toEqual(DEFAULT_MERIDIAN_FLIP_SETTINGS)
		expect(normalizeMeridianFlipSettings({ earlyWarningSeconds: -5, minimumSeconds: 1000, maximumSeconds: 600, deadlineWarningSeconds: 900, settleSeconds: Number.NaN })).toEqual({
			earlyWarningSeconds: 0,
			minimumSeconds: 600,
			maximumSeconds: 600,
			deadlineWarningSeconds: 0,
			settleSeconds: 0,
		})
		expect(normalizeMeridianFlipSettings({ ...DEFAULT_MERIDIAN_FLIP_SETTINGS, earlyWarningSeconds: 99999, maximumSeconds: 99999 })).toMatchObject({ earlyWarningSeconds: MERIDIAN_FLIP_MAXIMUM_SECONDS, maximumSeconds: MERIDIAN_FLIP_MAXIMUM_SECONDS })
	})
})

describe('countdown', () => {
	test('is interpolated from the sample and missing once it is stale', () => {
		const value = monitor(1)
		expect(secondsToTransit(value, 11000)).toBe(590)
		expect(secondsToTransit(value, 1000 + MERIDIAN_FLIP_STALE_AFTER + 1)).toBeUndefined()
		expect(secondsToTransit({ ...value, timing: { phase: 'unavailable', quality: 'unavailable' } }, 1000)).toBeUndefined()
	})
})

describe('status', () => {
	test('names the state and its tone, warning only for a pending flip', () => {
		expect(meridianFlipHeadline(undefined)).toEqual(['Disabled', 'muted'])
		expect(meridianFlipHeadline(monitor(1, { availability: 'waitingForMount' }))).toEqual(['Waiting for the mount', 'warning'])
		expect(meridianFlipHeadline(monitor(1, { timing: { phase: 'approaching', quality: 'valid' } }))).toEqual(['Approaching', 'active'])
		expect(meridianFlipHeadline(monitor(1, { timing: { phase: 'windowOpen', quality: 'valid' }, mechanical: 'flipCandidate' }))).toEqual(['Flip window open', 'warning'])
		expect(meridianFlipHeadline(monitor(1, { timing: { phase: 'windowOpen', quality: 'valid' }, mechanical: 'alreadyOnExpectedSide' }))).toEqual(['Window open', 'neutral'])
		expect(meridianFlipHeadline(monitor(1, { timing: { phase: 'pastDeadline', quality: 'valid' }, mechanical: 'flipCandidate' }))).toEqual(['Deadline passed', 'danger'])
	})

	test('adds the time to or since the transit while monitoring a current forecast', () => {
		expect(meridianFlipStatusText(monitor(1, { timing: { phase: 'approaching', quality: 'valid', secondsToTransit: 565 } }), 1000)).toBe('Approaching · T−9:25')
		expect(meridianFlipStatusText(monitor(1, { timing: { phase: 'windowOpen', quality: 'valid', secondsToTransit: -370 }, mechanical: 'flipCandidate' }), 1000)).toBe('Flip window open · T+6:10')
		expect(meridianFlipStatusText(monitor(1, { availability: 'idle', timing: { phase: 'unavailable', quality: 'unavailable' } }), 1000)).toBe('Idle')
		expect(meridianFlipStatusText(monitor(1), 1000 + MERIDIAN_FLIP_STALE_AFTER + 1)).toBe('Monitoring')
	})
})
