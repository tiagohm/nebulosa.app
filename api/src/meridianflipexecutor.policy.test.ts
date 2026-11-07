import { describe, expect, test } from 'bun:test'
import type { MountFlipExecution } from 'nebulosa/src/devices/commanders/mount'
import { DEFAULT_MOUNT, type Mount } from 'nebulosa/src/devices/indi/device'
import { deg, hour } from 'nebulosa/src/math/units/angle'
import type { MeridianFlipMonitor } from './meridianflip'
import { acceptsVerification, classifyFlip, compareWcs, DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, type EligibilityInput, evaluateEligibility, FLIP_DURATION_SECONDS, passageKey } from './meridianflipexecutor.policy'

const NOW = Date.UTC(2026, 10, 7, 2, 0, 0)

function mount(patch: Partial<Mount> = {}): Mount {
	return { ...structuredClone(DEFAULT_MOUNT), name: 'GEM', connected: true, mountType: 'EQ_GEM', canGoTo: true, canFlip: false, hasPierSide: true, pierSide: 'WEST', client: { type: 'INDI', id: 'indi' }, equatorialCoordinate: { rightAscension: hour(5), declination: deg(20) }, ...patch }
}

function monitor(patch: Partial<MeridianFlipMonitor> = {}, timing: Partial<MeridianFlipMonitor['timing']> = {}): MeridianFlipMonitor {
	return {
		monitorId: 'monitor',
		connectionId: 'connection',
		deviceId: 'mount',
		revision: 1,
		settings: { earlyWarningSeconds: 900, minimumSeconds: 300, maximumSeconds: 900, deadlineWarningSeconds: 180, settleSeconds: 2 },
		settingsRevision: 1,
		sampledAt: NOW,
		contextId: 'context',
		episodeId: 'episode',
		mount: { mountType: 'EQ_GEM', pierSide: 'WEST', tracking: true, trackMode: 'SIDEREAL' },
		availability: 'monitoring',
		timing: { phase: 'windowOpen', quality: 'valid', transitAt: NOW - 400000, windowOpensAt: NOW - 100000, windowClosesAt: NOW + 500000, ...timing },
		mechanical: 'flipCandidate',
		...patch,
	}
}

function input(patch: Partial<EligibilityInput> = {}): EligibilityInput {
	return { now: NOW, trigger: 'manual', monitor: monitor(), mount: mount(), policy: DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, canInfer: true, boundarySeconds: 0, serviced: new Set(), ...patch }
}

function execution(patch: Partial<MountFlipExecution> = {}): MountFlipExecution {
	const position = { rightAscension: hour(5), declination: deg(20) }
	return { strategy: 'forcedGoto', outcome: 'moved', target: position, initial: { ...position, pierSide: 'WEST' }, final: { ...position, pierSide: 'EAST' }, pierSideProvenance: 'driverReported', pierSideChanged: true, movementObserved: true, arrivalSeparation: 0, trackingAfter: true, dispatchedAt: NOW, ...patch }
}

describe('eligibility', () => {
	test('a German equatorial mount with a driver pier side in the open window is eligible by a forced GoTo', () => {
		expect(evaluateEligibility(input())).toMatchObject({ decision: 'eligible', strategy: 'forcedGoto', verificationMode: 'driverPierSide', contextId: 'context' })
		expect(evaluateEligibility(input({ mount: mount({ canFlip: true }) }))).toMatchObject({ decision: 'eligible', strategy: 'nativeFlip' })
		expect(evaluateEligibility(input({ mount: mount({ canFlip: true }), policy: { ...DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, strategy: 'forcedGoto' } }))).toMatchObject({ decision: 'eligible', strategy: 'forcedGoto' })
	})

	test('refuses what never flips, what is not tracked, and what the strategy cannot do', () => {
		expect(evaluateEligibility(input({ monitor: undefined }))).toMatchObject({ decision: 'refuse', code: 'monitorDisabled' })
		expect(evaluateEligibility(input({ mount: mount({ mountType: 'ALTAZ' }) }))).toMatchObject({ decision: 'refuse', code: 'unsupportedMount' })
		expect(evaluateEligibility(input({ mount: mount({ mountType: 'EQ_FORK' }) }))).toMatchObject({ decision: 'refuse', code: 'unsupportedMount' })
		expect(evaluateEligibility(input({ mount: mount({ mountType: 'UNKNOWN' }) }))).toMatchObject({ decision: 'refuse', code: 'unsupportedMount' })
		expect(evaluateEligibility(input({ mount: mount({ mountType: 'UNKNOWN' }), policy: { ...DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, treatUnknownMountAsGem: true } }))).toMatchObject({ decision: 'eligible' })
		expect(evaluateEligibility(input({ mount: mount({ canGoTo: false }) }))).toMatchObject({ decision: 'refuse', code: 'unsupportedMount' })
		expect(evaluateEligibility(input({ policy: { ...DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, strategy: 'nativeFlip' } }))).toMatchObject({ decision: 'refuse', code: 'unsupportedMount' })
		expect(evaluateEligibility(input({ mount: mount({ parked: true }) }))).toMatchObject({ decision: 'refuse', code: 'parked' })
		expect(evaluateEligibility(input({ monitor: monitor({ availability: 'idle', contextId: undefined }) }))).toMatchObject({ decision: 'refuse', code: 'notTracking' })
		expect(evaluateEligibility(input({ monitor: monitor({ availability: 'settling' }) }))).toMatchObject({ decision: 'wait', code: 'notTracking' })
		expect(evaluateEligibility(input({ monitor: monitor({}, { quality: 'approximate' }) }))).toMatchObject({ decision: 'refuse', code: 'nonSidereal' })
		expect(evaluateEligibility(input({ monitor: monitor({ reason: 'nearPole' }) }))).toMatchObject({ decision: 'refuse', code: 'nearPole' })
	})

	test('skips a mount already on its post-meridian side, a passage already flipped, and another target', () => {
		expect(evaluateEligibility(input({ monitor: monitor({ mechanical: 'alreadyOnExpectedSide' }) }))).toMatchObject({ decision: 'refuse', code: 'alreadyFlipped' })
		const eligible = evaluateEligibility(input())
		if (eligible.decision !== 'eligible') throw new Error('not eligible')
		expect(evaluateEligibility(input({ serviced: new Set([eligible.passage]) }))).toMatchObject({ decision: 'refuse', code: 'alreadyServiced' })
		expect(evaluateEligibility(input({ expectedContextId: 'another' }))).toMatchObject({ decision: 'refuse', code: 'staleContext' })
	})

	test('waits for the window unless asked to flip now, and only a manual flip goes past it', () => {
		const approaching = monitor({ mechanical: 'notDue' }, { phase: 'approaching', windowOpensAt: NOW + 30000 })
		expect(evaluateEligibility(input({ monitor: approaching }))).toMatchObject({ decision: 'refuse', code: 'notDue' })
		expect(evaluateEligibility(input({ monitor: approaching, trigger: 'scheduled' }))).toMatchObject({ decision: 'wait', code: 'notDue', reevaluateAt: NOW + 30000 })
		expect(evaluateEligibility(input({ monitor: monitor({ mechanical: 'notDue' }, { phase: 'before', windowOpensAt: NOW + 7200000 }), trigger: 'automatic' }))).toMatchObject({ decision: 'wait', reevaluateAt: NOW + 60000 })

		const past = monitor({}, { phase: 'pastDeadline' })
		expect(evaluateEligibility(input({ monitor: past, trigger: 'automatic' }))).toMatchObject({ decision: 'refuse', code: 'unsafeWindow' })
		expect(evaluateEligibility(input({ monitor: past }))).toMatchObject({ decision: 'eligible' })
	})

	test('refuses a flip that could not end before the firmware limit of the mount', () => {
		const policy = { ...DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, firmwareLimitSeconds: 600 }
		// Transit 400 s ago, limit 600 s after it: 200 s left, while the flip needs FLIP_DURATION_SECONDS plus the boundary.
		expect(evaluateEligibility(input({ policy, boundarySeconds: 0 }))).toMatchObject({ decision: 'eligible' })
		expect(evaluateEligibility(input({ policy, boundarySeconds: 200 - FLIP_DURATION_SECONDS + 1 }))).toMatchObject({ decision: 'refuse', code: 'unsafeWindow' })
		// The automatic arm also refuses a preferred window that closes after the firmware limit.
		expect(evaluateEligibility(input({ policy: { ...policy, firmwareLimitSeconds: 800 }, trigger: 'automatic' }))).toMatchObject({ decision: 'refuse', code: 'unsafeWindow' })
	})

	test('a missing or simulated pier side never erases the timing, and only the automatic arm needs consent to infer', () => {
		for (const unusable of [mount({ hasPierSide: false, pierSide: 'NEITHER' }), mount({ client: { type: 'SIMULATOR', id: 'simulator' } })]) {
			expect(evaluateEligibility(input({ mount: unusable }))).toMatchObject({ decision: 'eligible', verificationMode: 'inference' })
			expect(evaluateEligibility(input({ mount: unusable, canInfer: false }))).toMatchObject({ decision: 'eligible', verificationMode: 'none' })
			expect(evaluateEligibility(input({ mount: unusable, trigger: 'automatic' }))).toMatchObject({ decision: 'refuse', code: 'noPierSide' })
			expect(evaluateEligibility(input({ mount: unusable, trigger: 'automatic', policy: { ...DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, allowInferredVerification: true } }))).toMatchObject({ decision: 'eligible', verificationMode: 'inference' })
			expect(evaluateEligibility(input({ mount: unusable, trigger: 'automatic', canInfer: false, policy: { ...DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, allowInferredVerification: true } }))).toMatchObject({ decision: 'refuse', code: 'noPierSide' })
		}
	})

	test('names one passage across monitor restarts and right ascension wrap', () => {
		const a = passageKey('mount', monitor({ monitorId: 'a', episodeId: 'a' }), hour(5))
		const b = passageKey('mount', monitor({ monitorId: 'b', episodeId: 'b' }), hour(5) + deg(0.001))
		expect(a).toBe(b)
		expect(passageKey('mount', monitor({}, { transitAt: NOW - 400000 + 86164000 }), hour(5))).not.toBe(a)
		expect(passageKey('mount', monitor({}, { transitAt: undefined }), hour(5))).toBeUndefined()
		expect(passageKey('mount', monitor(), deg(359.999))).toBe(passageKey('mount', monitor(), deg(359.999)))
	})
})

describe('verification', () => {
	const before = { orientation: deg(10), parity: 'NORMAL' as const }

	test('a field turned by half a turn with its parity kept is consistent, across the ±π wrap', () => {
		expect(compareWcs(before, { orientation: deg(190), parity: 'NORMAL' })).toMatchObject({ status: 'consistent', parityKept: true, rotatorStable: true })
		expect(compareWcs({ orientation: deg(175), parity: 'NORMAL' }, { orientation: deg(-8), parity: 'NORMAL' })).toMatchObject({ status: 'consistent' })
		expect(compareWcs(before, { orientation: deg(10 + 180 + 11), parity: 'NORMAL' })).toMatchObject({ status: 'inconsistent' })
		expect(compareWcs(before, { orientation: deg(12), parity: 'NORMAL' })).toMatchObject({ status: 'inconsistent' })
		expect(compareWcs(before, { orientation: deg(190), parity: 'FLIPPED' })).toMatchObject({ status: 'inconsistent', parityKept: false })
		expect(compareWcs(before, undefined)).toEqual({ status: 'missing' })
	})

	test('a rotator that moved or turned between the solutions makes them inconsistent', () => {
		expect(compareWcs({ ...before, rotatorAngle: 90 }, { orientation: deg(190), parity: 'NORMAL', rotatorAngle: 90.05 })).toMatchObject({ status: 'consistent' })
		expect(compareWcs({ ...before, rotatorAngle: 90 }, { orientation: deg(190), parity: 'NORMAL', rotatorAngle: 270 })).toMatchObject({ status: 'inconsistent', rotatorStable: false })
		expect(compareWcs({ ...before, rotatorMoving: true }, { orientation: deg(190), parity: 'NORMAL' })).toMatchObject({ status: 'inconsistent', rotatorStable: false })
	})

	test('only a driver-reported side change verifies a flip, and inference needs every piece of evidence', () => {
		const consistent = compareWcs(before, { orientation: deg(190), parity: 'NORMAL' })

		expect(classifyFlip(execution(), { status: 'missing' }, false)).toBe('verified')
		expect(classifyFlip(execution({ pierSideProvenance: 'simulated' }), { status: 'missing' }, true)).toBe('unverified')
		expect(classifyFlip(execution({ pierSideProvenance: 'simulated' }), consistent, true)).toBe('inferred')
		expect(classifyFlip(execution({ pierSideProvenance: 'unavailable', pierSideChanged: false }), consistent, false)).toBe('unverified')
		expect(classifyFlip(execution({ pierSideChanged: false }), { status: 'inconsistent' }, true)).toBe('unverified')
		expect(classifyFlip(execution({ outcome: 'noFlipEvidence', movementObserved: false, pierSideChanged: false }), consistent, true)).toBe('unverified')
		expect(classifyFlip(undefined, consistent, true)).toBe('unverified')
	})

	test('imaging goes on by itself only after a verified flip, or an inferred one the policy accepts', () => {
		expect(acceptsVerification('verified', { allowInferredAutoResume: false })).toBeTrue()
		expect(acceptsVerification('inferred', { allowInferredAutoResume: false })).toBeFalse()
		expect(acceptsVerification('inferred', { allowInferredAutoResume: true })).toBeTrue()
		expect(acceptsVerification('unverified', { allowInferredAutoResume: true })).toBeFalse()
	})
})
