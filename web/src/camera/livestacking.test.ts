import { describe, expect, test } from 'bun:test'
import type { LiveStackingCohort, LiveStackingSession, LiveStackingSnapshot } from 'api'
import { proxy } from 'valtio'
import { DEFAULT_LIVE_STACKING_SETTINGS } from '../profile/schema'
import { COMPOSITION_PRESETS } from '../tools/imagestacking/presets'
import { calibrationFilters, cameraLiveSession, handleLiveStackingEvent, type LiveStackingRuntime, liveSessionActive, NO_FILTER, refreshLiveStacking, removeFilterCalibration, resolveLivePreset, startLiveStacking, wheelFilterNames } from './livestacking'

// A session of camera c1/cam with fields replaced.
function session(revision: number, patch: Partial<LiveStackingSession> = {}): LiveStackingSession {
	return {
		sessionId: 's1',
		connectionId: 'c1',
		deviceId: 'cam',
		cameraName: 'Camera',
		state: 'waiting',
		startedAt: 0,
		recipe: DEFAULT_LIVE_STACKING_SETTINGS.recipe,
		calibration: DEFAULT_LIVE_STACKING_SETTINGS.calibration,
		counters: { received: 0, queued: 0, processing: 0, held: 0, accepted: 0, rejected: 0, skipped: 0, deliveryFailed: 0 },
		backlogBytes: 0,
		newFieldRequested: false,
		fields: [],
		cohorts: [],
		retainedBytes: 0,
		products: [],
		revision,
		...patch,
	}
}

// A mono stack of a filter on a field.
function cohort(cohortId: string, filter: string, fieldId = 'f1', updatedAt = 1, channels = 1): LiveStackingCohort {
	return { cohortId, fieldId, filter, acquisition: { width: 10, height: 10, channels, exposure: 60 }, accepted: 1, exposure: 60, startedAt: 0, updatedAt }
}

function newRuntime() {
	return proxy<LiveStackingRuntime>({ sessions: {}, memoryBudget: 0, memoryUsed: 0, pending: {}, errors: {} })
}

describe('live stacking store', () => {
	test('a session follows its events in revision order, and a new epoch forgets every session', () => {
		const state = newRuntime()
		handleLiveStackingEvent(state, { type: 'liveStacking:updated', epoch: 'e1', revision: 2, session: session(5, { state: 'processing' }) })
		handleLiveStackingEvent(state, { type: 'liveStacking:updated', epoch: 'e1', revision: 1, session: session(4) })
		expect(cameraLiveSession(state, 'c1', 'cam')?.state).toBe('processing')
		expect(cameraLiveSession(state, 'c1', 'other')).toBeUndefined()

		handleLiveStackingEvent(state, { type: 'liveStacking:closed', epoch: 'e1', revision: 3, sessionId: 's1' })
		expect(state.sessions).toEqual({})

		handleLiveStackingEvent(state, { type: 'liveStacking:updated', epoch: 'e1', revision: 4, session: session(1, { sessionId: 's2' }) })
		handleLiveStackingEvent(state, { type: 'liveStacking:updated', epoch: 'e2', revision: 1, session: session(1, { sessionId: 's3' }) })
		expect(Object.keys(state.sessions)).toEqual(['s3'])
	})

	test('a snapshot never takes a session back to an older revision', async () => {
		const state = newRuntime()
		handleLiveStackingEvent(state, { type: 'liveStacking:updated', epoch: 'e1', revision: 9, session: session(9, { state: 'paused' }) })
		const snapshot: LiveStackingSnapshot = { epoch: 'e1', revision: 8, sessions: [session(8), session(1, { sessionId: 's2', deviceId: 'other' })], memoryBudget: 100, memoryUsed: 10 }

		await refreshLiveStacking(state, (() => Promise.resolve(Response.json(snapshot))) as unknown as typeof fetch)
		expect(state.sessions.s1.state).toBe('paused')
		expect(state.sessions.s2.revision).toBe(1)
		expect(state).toMatchObject({ memoryBudget: 100, memoryUsed: 10 })
	})

	test('a start sends the form of the camera with a token and keeps the session it answers', async () => {
		const state = newRuntime()
		const bodies: unknown[] = []
		const request = (_: string, init?: RequestInit) => {
			bodies.push(JSON.parse(init!.body as string))
			return Promise.resolve(Response.json(session(1), { status: 201 }))
		}

		expect(await startLiveStacking(state, 'c1', 'cam', DEFAULT_LIVE_STACKING_SETTINGS, request as typeof fetch)).toMatchObject({ sessionId: 's1' })
		expect(bodies[0]).toMatchObject({ token: expect.any(String), recipe: DEFAULT_LIVE_STACKING_SETTINGS.recipe, calibration: DEFAULT_LIVE_STACKING_SETTINGS.calibration })
		expect(liveSessionActive(state.sessions.s1)).toBeTrue()
		expect(liveSessionActive(session(2, { state: 'stopped' }))).toBeFalse()

		const failed = await startLiveStacking(state, 'c1', 'cam', DEFAULT_LIVE_STACKING_SETTINGS, (() => Promise.resolve(Response.json({ error: 'Live Stacking already runs for this camera', code: 'sessionConflict' }, { status: 409 }))) as unknown as typeof fetch)
		expect(failed).toBeUndefined()
		expect(state.errors['camera:c1:cam']).toBe('Live Stacking already runs for this camera')
	})

	test('a preset composes the latest mono stack of each of its filters on one field, by their canonical names', () => {
		const hoo = COMPOSITION_PRESETS.find((preset) => preset.name === 'HOO')!
		const cohorts = [cohort('old-ha', 'Ha', 'f1', 1), cohort('ha', 'Ha', 'f1', 5), cohort('o3', ' OIII ', 'f1', 2), cohort('other', 'OIII', 'f2', 9), cohort('rgb', 'Ha', 'f1', 9, 3)]

		expect(resolveLivePreset(hoo, cohorts, 'f1')).toEqual({
			composition: {
				preset: 'HOO',
				sources: [
					{ cohortId: 'ha', gain: 1, offset: 0 },
					{ cohortId: 'o3', gain: 1, offset: 0 },
				],
				mix: { red: [{ plane: 0, weight: 1 }], green: [{ plane: 1, weight: 1 }], blue: [{ plane: 1, weight: 1 }] },
			},
		})
		expect(resolveLivePreset(hoo, cohorts, 'f2')).toEqual({ missing: ['Ha'] })
	})

	test('the filters of a calibration come from the wheel, or are None without one, and each can be removed', () => {
		expect(wheelFilterNames([' L ', 'Ha', '', 'Ha', 'OIII', 'SII'], 5)).toEqual(['L', 'Ha', 'OIII'])
		const calibration = { filters: { Ha: { dark: { masterId: 1, digest: 'a' } }, OIII: {} }, otherwise: 'skip' } as const
		expect(calibrationFilters(calibration, ['L', 'Ha'])).toEqual(['Ha', 'OIII'])
		expect(calibrationFilters(calibration, undefined)).toEqual(['Ha', NO_FILTER, 'OIII'])
		expect(calibrationFilters({ filters: {} }, undefined)).toEqual([NO_FILTER])
		expect(removeFilterCalibration(calibration, 'Ha')).toEqual({ filters: { OIII: {} }, otherwise: 'skip' })
	})
})
