import { meridianFlipStrategies, type MountFlipExecution, type MountFlipStrategy, pierSideProvenance } from 'nebulosa/src/devices/commanders/mount'
import type { Mount } from 'nebulosa/src/devices/indi/device'
import { type Angle, deg, normalizePI } from 'nebulosa/src/math/units/angle'
import type { MeridianFlipMonitor } from './meridianflip'

// Pure decisions of the Meridian Flip Executor (meridianflipexecutor.ts): whether a flip may start now, must wait, or is
// refused; how strong the evidence of an executed flip is; whether that evidence lets imaging go on; and the identity of a
// meridian passage that must never be flipped twice. Nothing here reads a clock, a device, or a service: the caller passes
// the instant, the mount, and the Meridian Flip Monitor it observed. Instants are Unix milliseconds, durations seconds, angles
// radians unless stated otherwise.

// How strongly an executed flip is established:
// - verified: the driver reported the pier side changing, not from a simulator, after a settled arrival on the target.
// - inferred: no usable pier side, but the mount moved and plate solutions before and after the motion show the field turned
//   by half a turn with its parity kept, the rotator untouched, and the target found again. Supporting evidence, never a
//   mechanical proof.
// - unverified: the evidence is missing or contradicts a flip. Never treated as a success.
export type FlipVerification = 'verified' | 'inferred' | 'unverified'

// What the Executor can verify a flip with, decided before it starts: the driver's pier side, plate solutions, or nothing, when
// the mount publishes no usable pier side and the setup cannot solve (such a flip can only end unverified).
export type FlipVerificationMode = 'driverPierSide' | 'inference' | 'none'

// How a flip is commanded, as the operator chooses it: auto takes the driver's own flip when it has one, else a forced GoTo.
export type FlipStrategyChoice = 'auto' | MountFlipStrategy

// What started a flip: an explicit request to flip now, a one-shot request to flip once the window opens, or the automatic
// arm.
export type FlipTrigger = 'manual' | 'scheduled' | 'automatic'

// Policy of the Executor for one mount, as the operator configured it.
export interface MeridianFlipExecutorPolicy {
	// How the flip is commanded.
	readonly strategy: FlipStrategyChoice
	// Whether the target is centered again with Target Centering after the flip.
	readonly recenterAfterFlip: boolean
	// Whether Auto Focus runs after the flip.
	readonly autofocusAfterFlip: boolean
	// Wait after the flip motion before anything measures or moves again, in seconds; >= 0.
	readonly mountSettleSeconds: number
	// Whether a mount without a usable pier side may be flipped by the automatic arm, its flip then established by plate
	// solutions before and after (inferred), never by the pier side.
	readonly allowInferredVerification: boolean
	// Whether an inferred flip lets the paused capture go on by itself; the operator acknowledged that inference is not a
	// mechanical confirmation. Off, an inferred flip leaves the capture paused for the operator.
	readonly allowInferredAutoResume: boolean
	// Whether a mount reporting an UNKNOWN mount type is a German equatorial mount, as the operator classified it.
	readonly treatUnknownMountAsGem: boolean
	// Seconds after the transit at which the mount firmware stops tracking or flips by itself, as the operator read it from
	// the mount (such as the Meridian Treatment of an iOptron mount); absent when unknown. A flip must end before it.
	readonly firmwareLimitSeconds?: number
}

// Policy a mount starts with: the driver's own flip when it has one, recentering, no Auto Focus, 5 s of mount settle, and no
// inference without the operator's consent.
export const DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY: MeridianFlipExecutorPolicy = {
	strategy: 'auto',
	recenterAfterFlip: true,
	autofocusAfterFlip: false,
	mountSettleSeconds: 5,
	allowInferredVerification: false,
	allowInferredAutoResume: false,
	treatUnknownMountAsGem: false,
}

// Stable code of a refusal or a failure of the Executor, for a client to branch on.
export type MeridianFlipExecutorErrorCode =
	| 'notFound'
	| 'disconnected'
	| 'busy'
	| 'conflict'
	| 'monitorDisabled'
	| 'notTracking'
	| 'notDue'
	| 'notEligible'
	| 'unsupportedMount'
	| 'parked'
	| 'nonSidereal'
	| 'nearPole'
	| 'noPierSide'
	| 'alreadyFlipped'
	| 'alreadyServiced'
	| 'unsafeWindow'
	| 'staleContext'
	| 'missingCamera'
	| 'missingFocuser'
	| 'guidingActive'
	| 'captureHandoffFailed'
	| 'noFlipEvidence'
	| 'unknownResult'
	| 'externalChange'
	| 'notReady'
	| 'cancelled'

// Whether a flip may start now:
// - eligible: it may, with the resolved strategy and verification mode, for the monitor context and passage it was decided for.
// - wait: not yet; decide again at reevaluateAt, or on the next monitor update when it is absent.
// - refuse: it may not, for code.
export type ExecutorEligibility =
	| { readonly decision: 'eligible'; readonly strategy: MountFlipStrategy; readonly verificationMode: FlipVerificationMode; readonly contextId: string; readonly passage: string; readonly reason: string }
	| { readonly decision: 'wait'; readonly reevaluateAt?: number; readonly code: MeridianFlipExecutorErrorCode; readonly reason: string }
	| { readonly decision: 'refuse'; readonly code: MeridianFlipExecutorErrorCode; readonly reason: string }

// Everything one eligibility decision reads.
export interface EligibilityInput {
	// Instant of the decision.
	readonly now: number
	// What asks for the flip.
	readonly trigger: FlipTrigger
	// Monitor of the mount; absent when it is not enabled.
	readonly monitor?: MeridianFlipMonitor
	// Mount to flip.
	readonly mount: Mount
	// Policy in force.
	readonly policy: MeridianFlipExecutorPolicy
	// Whether the setup can establish a flip by plate solutions: a main camera and Target Centering settings.
	readonly canInfer: boolean
	// Seconds the flip may still wait for the capture to reach a frame boundary, and for its dither and settle; >= 0.
	readonly boundarySeconds: number
	// Passages of the mount already flipped or being flipped (see passageKey).
	readonly serviced: ReadonlySet<string>
	// Context the request was decided for, when it must still be the monitor's (a scheduled or automatic flip).
	readonly expectedContextId?: string
}

// Seconds a flip motion and its checks are assumed to take, so it starts early enough to end before a firmware limit;
// a planning margin, not a measurement.
export const FLIP_DURATION_SECONDS = 180

// Longest a decision that must wait is postponed before it is taken again, in milliseconds, so a forecast that drifts is
// followed even without a monitor update.
export const MAXIMUM_REEVALUATION_DELAY = 60000

// Half-width of the band around half a turn within which the field orientation after a flip counts as turned by it, in
// radians (10°). Plate solutions of one optical train agree to well under a degree; the band only absorbs a slightly
// rotated recentering frame, never a rotator move.
export const ORIENTATION_TOLERANCE = deg(10)

// Largest change of a rotator angle between the two plate solutions of an inferred flip, in degrees.
export const ROTATOR_TOLERANCE = 0.1

// Identity of the meridian passage a monitor follows for a mount: the mount's resource key, the right ascension of the
// target to the arcminute, and the minute of its transit. Two decisions of the same passage share it however often the
// monitor is enabled again or the episode renamed; undefined without a forecast.
export function passageKey(mountKey: string, monitor: MeridianFlipMonitor, rightAscension: Angle): string | undefined {
	const transitAt = monitor.timing.transitAt
	if (transitAt === undefined) return undefined
	return `${mountKey}:${Math.round((rightAscension * 10800) / Math.PI)}:${Math.round(transitAt / 60000)}`
}

// Resolves the strategy the mount supports for a choice, or undefined when it supports none of it.
export function resolveStrategy(mount: Mount, choice: FlipStrategyChoice): MountFlipStrategy | undefined {
	const supported = meridianFlipStrategies(mount)
	return choice === 'auto' ? supported[0] : supported.includes(choice) ? choice : undefined
}

// Decides whether a flip may start, in the order of the Executor contract: the monitor and the mount, the strategy, the
// observed target, the side of the pier, the window and the firmware limit, the passage, and the evidence a flip can be
// verified with. A pier side the driver does not publish never erases the timing; it only changes how the flip is verified.
export function evaluateEligibility({ now, trigger, monitor, mount, policy, canInfer, boundarySeconds, serviced, expectedContextId }: EligibilityInput): ExecutorEligibility {
	if (!monitor) return refuse('monitorDisabled', 'Enable the Meridian Flip Monitor of this mount; the Executor follows its forecast')
	if (!mount.connected) return refuse('disconnected', `${mount.name} is disconnected`)
	if (mount.parked || mount.parking) return refuse('parked', `${mount.name} is parked`)
	if (mount.mountType === 'ALTAZ' || mount.mountType === 'EQ_FORK') return refuse('unsupportedMount', `${mount.name} is not a German equatorial mount and never flips`)
	if (mount.mountType === 'UNKNOWN' && !policy.treatUnknownMountAsGem) return refuse('unsupportedMount', `${mount.name} does not report its mount type; classify it as a German equatorial mount to flip it`)

	const strategy = resolveStrategy(mount, policy.strategy)
	if (!strategy) return refuse('unsupportedMount', policy.strategy === 'auto' ? `${mount.name} can neither flip nor go to a target` : `${mount.name} does not support this flip strategy`)

	if (monitor.availability === 'repositioning' || monitor.availability === 'settling') return wait('notTracking', `${mount.name} is moving or settling`, undefined)
	if (monitor.availability !== 'monitoring' || monitor.contextId === undefined) return refuse('notTracking', `${mount.name} does not track a settled target`)
	if (monitor.reason === 'nearPole') return refuse('nearPole', 'The target is too close to the pole for its side of the pier to be told')
	if (monitor.timing.quality !== 'valid') return refuse('nonSidereal', 'Only a target tracked at the sidereal rate can be flipped')
	if (expectedContextId !== undefined && monitor.contextId !== expectedContextId) return refuse('staleContext', 'The mount observes another target than the one the flip was asked for')
	if (monitor.mechanical === 'alreadyOnExpectedSide') return refuse('alreadyFlipped', `${mount.name} already stands on the side of the pier expected past the meridian`)

	const passage = passageKey(monitor.connectionId + ':' + monitor.deviceId, monitor, mount.equatorialCoordinate.rightAscension)
	if (passage === undefined) return refuse('notTracking', 'The monitor has no forecast of the transit')
	if (serviced.has(passage)) return refuse('alreadyServiced', 'This meridian passage was already flipped')

	const { phase, transitAt, windowOpensAt, windowClosesAt } = monitor.timing

	if (phase === 'before' || phase === 'approaching') {
		if (trigger === 'manual') return refuse('notDue', 'The flip window has not opened; flip when eligible instead')
		return wait('notDue', 'Waiting for the flip window to open', windowOpensAt === undefined ? undefined : Math.min(windowOpensAt, now + MAXIMUM_REEVALUATION_DELAY))
	}

	if (phase === 'pastDeadline' && trigger !== 'manual') return refuse('unsafeWindow', 'The preferred flip window has closed; flip it by hand if the mount still allows it')

	if (policy.firmwareLimitSeconds !== undefined && transitAt !== undefined) {
		const limit = transitAt + policy.firmwareLimitSeconds * 1000
		const end = now + (boundarySeconds + FLIP_DURATION_SECONDS) * 1000
		if (end > limit) return refuse('unsafeWindow', 'The flip would not end before the firmware limit of the mount')
		if (trigger === 'automatic' && windowClosesAt !== undefined && windowClosesAt > limit) return refuse('unsafeWindow', 'The preferred flip window closes after the firmware limit of the mount; shorten the window')
	}

	const usableSide = pierSideProvenance(mount) === 'driverReported' && (mount.pierSide === 'EAST' || mount.pierSide === 'WEST')

	if (!usableSide) {
		if (trigger === 'automatic' && !(policy.allowInferredVerification && canInfer)) return refuse('noPierSide', `${mount.name} publishes no usable pier side; allow inferred verification with a camera and plate solving, or flip it by hand`)
		return eligible(strategy, canInfer ? 'inference' : 'none', monitor.contextId, passage, `${mount.name} publishes no usable pier side; the flip can only be ${canInfer ? 'inferred' : 'unverified'}`)
	}

	return eligible(strategy, 'driverPierSide', monitor.contextId, passage, 'The flip window is open')
}

// Plate solution taken around a flip, as the inference compares it.
export interface WcsMeasurement {
	// Field orientation of the solution, in radians.
	readonly orientation: Angle
	// Parity of the solution.
	readonly parity: 'NORMAL' | 'FLIPPED'
	// Angle the rotator of the setup reported when the frame was taken, in degrees; absent without a rotator.
	readonly rotatorAngle?: number
	// Whether the rotator of the setup was moving when the frame was taken.
	readonly rotatorMoving?: boolean
}

// How the plate solutions around a flip compare:
// - consistent: the field turned by half a turn within ORIENTATION_TOLERANCE, its parity kept, the rotator still.
// - inconsistent: they contradict a flip.
// - missing: a solution is missing, so nothing was compared.
export interface WcsEvidence {
	readonly status: 'consistent' | 'inconsistent' | 'missing'
	// Change of the field orientation from before to after, in radians in (−π, π]; absent when missing.
	readonly orientationChange?: Angle
	// Whether the parity was kept; absent when missing.
	readonly parityKept?: boolean
	// Whether the rotator stayed still between them, or there is none; absent when missing.
	readonly rotatorStable?: boolean
}

// Compares the plate solutions taken before and after a flip.
export function compareWcs(before: WcsMeasurement | undefined, after: WcsMeasurement | undefined): WcsEvidence {
	if (!before || !after) return { status: 'missing' }

	const orientationChange = normalizePI(after.orientation - before.orientation)
	const parityKept = before.parity === after.parity
	const rotatorStable = !before.rotatorMoving && !after.rotatorMoving && (before.rotatorAngle === undefined || after.rotatorAngle === undefined ? before.rotatorAngle === after.rotatorAngle : Math.abs(after.rotatorAngle - before.rotatorAngle) <= ROTATOR_TOLERANCE)
	const halfTurn = Math.abs(normalizePI(orientationChange - Math.PI)) <= ORIENTATION_TOLERANCE

	return { status: halfTurn && parityKept && rotatorStable ? 'consistent' : 'inconsistent', orientationChange, parityKept, rotatorStable }
}

// Classifies the evidence of an executed flip. The pier side counts only when the driver, not a simulator, reported it
// changing after a settled arrival; without it, the motion, the plate solutions, and a position verified after the motion
// must all agree for an inferred flip. Anything less is unverified.
export function classifyFlip(execution: MountFlipExecution | undefined, wcs: WcsEvidence, positionVerified: boolean): FlipVerification {
	if (!execution || execution.outcome !== 'moved') return 'unverified'
	if (execution.pierSideProvenance === 'driverReported' && execution.pierSideChanged) return 'verified'
	return execution.movementObserved && wcs.status === 'consistent' && positionVerified ? 'inferred' : 'unverified'
}

// Whether a flip verified this strongly lets imaging go on by itself under a policy.
export function acceptsVerification(verification: FlipVerification, policy: Pick<MeridianFlipExecutorPolicy, 'allowInferredAutoResume'>) {
	return verification === 'verified' || (verification === 'inferred' && policy.allowInferredAutoResume)
}

// Builds an eligible decision.
function eligible(strategy: MountFlipStrategy, verificationMode: FlipVerificationMode, contextId: string, passage: string, reason: string): ExecutorEligibility {
	return { decision: 'eligible', strategy, verificationMode, contextId, passage, reason }
}

// Builds a decision to wait.
function wait(code: MeridianFlipExecutorErrorCode, reason: string, reevaluateAt: number | undefined): ExecutorEligibility {
	return { decision: 'wait', code, reason, reevaluateAt }
}

// Builds a refusal.
function refuse(code: MeridianFlipExecutorErrorCode, reason: string): ExecutorEligibility {
	return { decision: 'refuse', code, reason }
}
