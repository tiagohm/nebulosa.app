import { describe, expect, test } from 'bun:test'
import type { TargetCenteringSessionSummary } from 'api'
import { cameraTabKey } from '../images/cameratabs'
import { cameraKey } from './capture'
import type { TargetCenteringRuntime } from './targetcentering'
import { framingAngle, sendToTargetCentering, targetCenteringHandoffBlocker } from './targetcentering.handoff'

const CAMERA = { connectionId: 'c', deviceId: 'main' }
const KEY = cameraKey('c', 'main')

function runtime(): TargetCenteringRuntime {
	return { sessions: {}, details: {}, drafts: {}, pending: {}, errors: {} }
}

describe('target centering hand-off', () => {
	test('merges into the form, keeping what it does not give, clears a refusal, and opens the tool', () => {
		const state = runtime()
		state.drafts[KEY] = { rightAscension: 1, declination: 0.5, label: 'M 31' }
		state.errors[KEY] = 'below the horizon'
		const opened: unknown[] = []
		sendToTargetCentering(CAMERA, { oriented: true, positionAngle: 2, orientationSource: 'framing Panel 2' }, state, (...args) => opened.push(args))

		expect(state.drafts[KEY]).toEqual({ rightAscension: 1, declination: 0.5, label: 'M 31', oriented: true, positionAngle: 2, orientationSource: 'framing Panel 2' })
		expect(state.errors[KEY]).toBeUndefined()
		expect(opened).toEqual([['c', 'main', 'target-centering']])
	})

	test('needs a Main Camera with a tab and no running session', () => {
		const state = runtime()
		const tab = [{ key: cameraTabKey('c', 'main') }]
		expect(targetCenteringHandoffBlocker(tab, state, undefined)).toContain('Main Camera')
		expect(targetCenteringHandoffBlocker([], state, CAMERA)).toContain('no tab')
		expect(targetCenteringHandoffBlocker(tab, state, CAMERA)).toBeUndefined()
		state.sessions[KEY] = { endedAt: undefined } as TargetCenteringSessionSummary
		expect(targetCenteringHandoffBlocker(tab, state, CAMERA)).toContain('centering')
	})

	test('the rotation of a framing, in degrees, is the position angle in radians within a turn', () => {
		expect(framingAngle(90)).toBeCloseTo(Math.PI / 2, 12)
		expect(framingAngle(-90)).toBeCloseTo((3 * Math.PI) / 2, 12)
		expect(framingAngle(360)).toBe(0)
	})
})
