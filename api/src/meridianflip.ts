import { angularDistance } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { hourAngle } from 'nebulosa/src/astronomy/events/hourangle'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { PIOVERTWO, SIDEREAL_DRIFT_RATE } from 'nebulosa/src/core/constants'
import { expectedPierSide, type Mount, type MountType, type PierSide, type TrackMode } from 'nebulosa/src/devices/indi/device'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { type Angle, deg } from 'nebulosa/src/math/units/angle'
import { createMeridianFlipState, evaluateMeridianFlip, type MeridianFlipPhase, type MeridianFlipPolicy } from 'nebulosa/src/observation/mount/meridian.flip'
import { type ClientResolver, connectedDevice } from './commands'
import type { DeviceRegistry } from './devices'
import { errorResponse } from './http'
import type { OperationKind, OperationRecord, OperationRegistry } from './operations'
import type { ServerEvent } from './websocket'

// Meridian Flip Monitor: a passive, server-owned observer of the meridian passage of the target a mount tracks. One
// monitor exists per physical mount (resourceKey), enabled and disabled only explicitly, never by a tab, a profile, or
// a route, and never enabled again after a restart. It reads the mount and the host clock, commands nothing, holds no
// device, and starts no operation: it reports where the tracked target stands relative to the upper meridian and the
// preferred flip window, whether the pier side the driver reports still needs a flip, and publishes the edges of that
// state as transitions other services may consume.
//
// Time and frames: the right ascension of the mount is of date (JNOW) and the local apparent sidereal time comes from
// the host clock and the site the mount reports; the hour angle is LAST − RA in (−π, π], positive west. Every setting
// is in wall-clock seconds, and an hour angle of t seconds is t·SIDEREAL_DRIFT_RATE radians. The thresholds are
// classified by the toolkit's evaluateMeridianFlip, whose thresholds are bounded to ±6 sidereal hours.
//
// The observed target is inferred from a settled, tracking mount, not from a catalog object or a command: a position
// stable for the settle time starts an observation context, kept while the mount stays within CONTEXT_TOLERANCE of it.
// A motion, a jump without motion (a sync or a GoTo of another program), or a stop of tracking interrupts it; settling
// back on the same target resumes it, settling elsewhere starts a new one. An episode is the passage of one context
// through the upper meridian. A meridian crossing is published only for two consecutive monitored samples of the same
// context, so a GoTo across the meridian is never a crossing, and a change of pier side is an observation, never a
// verified flip. The settings of the window are timing preferences, not a physical tracking limit of the mount.

// Angular distance under which a settled position is the same target as the context, in radians (0.25°). A detection
// heuristic, never a pointing accuracy: guiding corrections, dithers, and a recentering stay well under it, while a
// GoTo to another object leaves it.
export const CONTEXT_TOLERANCE = deg(0.25)

// Most transitions kept per monitor, oldest first out.
export const TRANSITION_HISTORY = 100

// Largest early warning and maximum offset accepted by the toolkit's thresholds, in wall-clock seconds: 6 sidereal
// hours, π/2 radians of hour angle.
export const MAXIMUM_OFFSET_SECONDS = Math.floor(PIOVERTWO / SIDEREAL_DRIFT_RATE)

// Operations moving a mount to another place; while one runs the mount is repositioning even before its driver
// reports the motion. Nudges and guiding pulses stay within the context tolerance and are not listed.
const MOTION_KINDS: ReadonlySet<OperationKind> = new Set<OperationKind>(['mount.slew', 'mount.goto', 'mount.flip', 'mount.park', 'mount.unpark', 'mount.home', 'mount.findHome', 'mount.remoteMove'])

// Preferences of one monitor, in wall-clock seconds.
export interface MeridianFlipSettings {
	// Seconds before the transit when the target is approaching the meridian, 0..MAXIMUM_OFFSET_SECONDS.
	readonly earlyWarningSeconds: number
	// Seconds after the transit when the preferred flip window opens, 0..maximumSeconds.
	readonly minimumSeconds: number
	// Seconds after the transit when the preferred flip window closes, minimumSeconds..MAXIMUM_OFFSET_SECONDS.
	readonly maximumSeconds: number
	// Seconds before the window closes when the deadline is near, 0..maximumSeconds − minimumSeconds.
	readonly deadlineWarningSeconds: number
	// Seconds a tracked position must stay still before it is a target, ≥ 0.
	readonly settleSeconds: number
}

// Settings a monitor starts with when none were saved: warn 15 minutes before the transit, a window from 5 to 15
// minutes after it, the deadline near 3 minutes before it closes, and 2 seconds to settle.
export const DEFAULT_MERIDIAN_FLIP_SETTINGS: MeridianFlipSettings = { earlyWarningSeconds: 900, minimumSeconds: 300, maximumSeconds: 900, deadlineWarningSeconds: 180, settleSeconds: 2 }

// Whether a monitor can evaluate its mount now:
// - waitingForMount: the mount is disconnected.
// - waitingForCoordinates: the mount has not reported its position or its site.
// - idle: the mount is parked or not tracking, so it observes no fixed celestial target.
// - repositioning: the mount moves, or an operation moves it.
// - settling: the mount tracks a position not yet stable for the settle time.
// - monitoring: the mount tracks a settled target.
export type MeridianAvailability = 'waitingForMount' | 'waitingForCoordinates' | 'idle' | 'repositioning' | 'settling' | 'monitoring'

// Where the target stands relative to the preferred flip window:
// - unavailable: no forecast, the mount observes no settled target.
// - before: earlier than the early warning.
// - approaching: from the early warning to the opening of the window, the transit included.
// - windowOpen: inside the preferred window.
// - pastDeadline: after the window closed.
export type MeridianTimingPhase = 'unavailable' | 'before' | 'approaching' | 'windowOpen' | 'pastDeadline'

// Reliability of a forecast: valid for sidereal tracking, approximate for another rate (a static right ascension only
// approximates a moving body), unavailable when there is no forecast.
export type MeridianTimingQuality = 'valid' | 'approximate' | 'unavailable'

// Whether the reported pier side still needs a flip, as far as the evidence goes:
// - unsupportedMountType: an altazimuth or fork mount, which never needs a German equatorial flip.
// - unknown: the pier side, the mount type, or the target is not known well enough.
// - notDue: the window has not opened.
// - alreadyOnExpectedSide: the reported side is the one expected past the meridian.
// - flipCandidate: the reported side is still the one before the meridian; a flip may be needed, never authorized.
// - verificationPending: the mount is repositioning or settling, so nothing is asserted.
export type MeridianMechanicalAssessment = 'unsupportedMountType' | 'unknown' | 'notDue' | 'alreadyOnExpectedSide' | 'flipCandidate' | 'verificationPending'

// Why a monitor cannot assess everything, the first that applies.
export type MeridianMonitorReason = 'disconnected' | 'noCoordinates' | 'noSite' | 'moving' | 'parked' | 'notTracking' | 'settling' | 'altazimuthMount' | 'forkMount' | 'unknownMountType' | 'noPierSide' | 'nearPole' | 'nonSiderealTracking'

// Forecast of the meridian passage of the target. Instants are Unix milliseconds (UTC), computed from the sample.
export interface MeridianTiming {
	// Where the target stands.
	readonly phase: MeridianTimingPhase
	// Reliability of the instants.
	readonly quality: MeridianTimingQuality
	// Hour angle of the position of the mount at the sample, radians in (−π, π], positive west; present whenever the
	// position and the site are known, also without a forecast.
	readonly hourAngle?: Angle
	// Wall-clock seconds from the sample to the upper transit, negative once past it.
	readonly secondsToTransit?: number
	// Instant of the early warning.
	readonly warningAt?: number
	// Instant of the upper transit.
	readonly transitAt?: number
	// Instant the preferred window opens.
	readonly windowOpensAt?: number
	// Instant the deadline becomes near.
	readonly deadlineWarningAt?: number
	// Instant the preferred window closes.
	readonly windowClosesAt?: number
}

// Mount telemetry a monitor shows beside its assessment.
export interface MeridianMountView {
	// Mount type the driver reports; UNKNOWN until reported.
	readonly mountType: MountType
	// Pier side the driver reports; NEITHER when unknown.
	readonly pierSide: PierSide
	// Pier side the geometry expects for the position now, never proof of the mechanics; absent without position and site.
	readonly expectedPierSide?: PierSide
	// Whether the mount tracks.
	readonly tracking: boolean
	// Tracking rate.
	readonly trackMode: TrackMode
}

// Monitor as published to clients.
export interface MeridianFlipMonitor {
	// Id of this enablement; a monitor enabled again has another.
	readonly monitorId: string
	// Id of the open connection that provides the mount.
	readonly connectionId: string
	// Exact id of the mount.
	readonly deviceId: string
	// Revision of the service at the last publication of this monitor.
	readonly revision: number
	// Settings in force.
	readonly settings: MeridianFlipSettings
	// Revision of the settings, 1 when enabled, incremented by each update.
	readonly settingsRevision: number
	// Instant of the sample the assessment comes from, Unix milliseconds (UTC).
	readonly sampledAt: number
	// Id of the observation context; absent while no target is settled.
	readonly contextId?: string
	// Id of the meridian passage of the context.
	readonly episodeId?: string
	// Telemetry of the mount.
	readonly mount: MeridianMountView
	// Whether the monitor can evaluate the mount.
	readonly availability: MeridianAvailability
	// Forecast of the passage.
	readonly timing: MeridianTiming
	// Whether the pier side still needs a flip.
	readonly mechanical: MeridianMechanicalAssessment
	// Why something is unknown or unavailable, when anything is.
	readonly reason?: MeridianMonitorReason
}

// Every enabled monitor.
export interface MeridianFlipSnapshot {
	// Id of this server process; revisions only compare within one epoch.
	readonly epoch: string
	// Revision of the service when the snapshot was taken; grows with every publication.
	readonly revision: number
	// Enabled monitors, in enable order.
	readonly monitors: readonly MeridianFlipMonitor[]
}

// Edge of the state of a monitor:
// - approaching, windowOpened: the phase was reached, once per episode.
// - upperMeridianCrossed: the same continuously tracked target crossed the upper meridian, once per episode.
// - flipCandidate: the window is open and the reported side is still the one before the meridian, once per episode.
// - deadlineApproaching, deadlinePassed: the window nears its end or ended with a candidate pending, once per episode.
// - pierSideChanged: the reported pier side changed on the same target.
// - externalFlipSuspected: the pier side changed across a motion that came back to the same target in the window;
//   never a verified flip.
// - targetChanged: a new target replaced the previous one.
// - monitorUnavailable, monitorRecovered: the mount or its telemetry was lost while monitoring, and came back.
export type MeridianTransitionKind = 'approaching' | 'upperMeridianCrossed' | 'windowOpened' | 'flipCandidate' | 'deadlineApproaching' | 'deadlinePassed' | 'pierSideChanged' | 'externalFlipSuspected' | 'targetChanged' | 'monitorUnavailable' | 'monitorRecovered'

// Transition as published to clients and consumers.
export interface MeridianFlipTransition {
	// Id of this transition.
	readonly transitionId: string
	// What changed.
	readonly kind: MeridianTransitionKind
	// Monitor that observed it.
	readonly monitorId: string
	// Id of the open connection that provides the mount.
	readonly connectionId: string
	// Exact id of the mount.
	readonly deviceId: string
	// Observation context it belongs to; absent when the context was lost.
	readonly contextId?: string
	// Episode it belongs to; absent when the context was lost.
	readonly episodeId?: string
	// Revision of the monitor publication that carries the state after it.
	readonly revision: number
	// Instant it was observed, Unix milliseconds (UTC).
	readonly at: number
	// Timing phase when it was observed; the last one known for monitorUnavailable.
	readonly phase: MeridianTimingPhase
	// Mechanical assessment when it was observed.
	readonly mechanical: MeridianMechanicalAssessment
	// Pier side reported when it was observed.
	readonly pierSide: PierSide
	// Pier side reported before, for pierSideChanged and externalFlipSuspected.
	readonly previousPierSide?: PierSide
}

// Identity of a monitor in its events.
export interface MeridianFlipKey {
	// Id of the open connection that provides the mount.
	readonly connectionId: string
	// Exact id of the mount.
	readonly deviceId: string
}

// Notification published when a monitor changes materially, on every refresh interval, or once it was disabled or
// removed (monitor absent); and when it observes a transition, after the state it describes was published.
export type MeridianFlipEvent = { readonly type: 'meridianFlip:updated'; readonly epoch: string; readonly revision: number; readonly key: MeridianFlipKey; readonly monitor?: MeridianFlipMonitor } | { readonly type: 'meridianFlip:transition'; readonly epoch: string; readonly transition: MeridianFlipTransition }

// Body of PATCH /api/connections/:id/mounts/:deviceId/meridian-flip/settings.
export interface MeridianFlipSettingsRequest {
	// New settings.
	readonly settings: MeridianFlipSettings
	// Settings revision the change was made from; another one is answered 409 conflict.
	readonly expectedRevision: number
}

// Body of POST /api/connections/:id/mounts/:deviceId/meridian-flip/assess-exposure: a hypothetical next exposure.
export interface MeridianExposureRequest {
	// Exposure time, seconds ≥ 0.
	readonly exposureSeconds: number
	// Download, settle, and other overhead after the exposure, seconds ≥ 0.
	readonly overheadSeconds: number
	// Context the caller decided for; a different current context answers unknown.
	readonly expectedContextId?: string
}

// Whether a hypothetical exposure starting now ends within the preferred window. A preference, never a guarantee that
// the mount can track through it safely, and only valid for validForContextId at the instant it was answered:
// - allowed: it ends before the window closes, or no flip is pending; latestSafeStartAt is the last instant it could
//   start and still end before the window closes, when one applies.
// - defer: it would end after the window closes and the window has not opened; evaluate again at reevaluateAt.
// - blocked: the window is open or past with a flip candidate pending.
// - unknown: there is no settled target, the evidence is insufficient, or the context changed.
export type MeridianExposureAssessment =
	| { readonly decision: 'allowed'; readonly validForContextId: string; readonly latestSafeStartAt?: number; readonly reason: string }
	| { readonly decision: 'defer'; readonly validForContextId: string; readonly reevaluateAt?: number; readonly reason: string }
	| { readonly decision: 'blocked'; readonly validForContextId: string; readonly reason: string }
	| { readonly decision: 'unknown'; readonly reason: string }

// Stable code of a refused monitor request:
// - notFound: no such mount, or no monitor enabled for it.
// - disconnected: the mount is not connected.
// - conflict: the mount is monitored through another interface, or the settings changed meanwhile.
export type MeridianFlipErrorCode = 'notFound' | 'disconnected' | 'conflict'

// Mount telemetry one evaluation reads.
export interface MeridianMountSample {
	// Whether the mount is connected.
	readonly connected: boolean
	// Mount type the driver reports.
	readonly mountType: MountType
	// Whether the mount tracks.
	readonly tracking: boolean
	// Tracking rate.
	readonly trackMode: TrackMode
	// Whether the mount is parked.
	readonly parked: boolean
	// Whether the mount slews, moves, parks, or homes, or an operation moves it.
	readonly moving: boolean
	// Whether the driver reports a pier side.
	readonly hasPierSide: boolean
	// Pier side the driver reports.
	readonly pierSide: PierSide
	// Whether the position was reported in this connection.
	readonly hasEquatorialCoordinate: boolean
	// Right ascension of date, radians.
	readonly rightAscension: Angle
	// Declination of date, radians.
	readonly declination: Angle
	// Whether the site was reported in this connection.
	readonly hasGeographicCoordinate: boolean
	// Longitude of the site, radians, east positive.
	readonly longitude: Angle
}

// Target a monitor infers from a settled, tracking mount.
export interface MeridianObservationContext {
	// Id of the context.
	readonly id: string
	// Right ascension of date when it settled, radians.
	readonly rightAscension: Angle
	// Declination of date when it settled, radians.
	readonly declination: Angle
	// Instant it settled, Unix milliseconds (UTC).
	readonly establishedAt: number
}

// Position a tracking mount holds while it settles.
interface MeridianSettling {
	// Instant the position was first seen, Unix milliseconds (UTC).
	readonly since: number
	// Right ascension of date, radians.
	readonly rightAscension: Angle
	// Declination of date, radians.
	readonly declination: Angle
}

// Last monitored sample of a context.
interface MeridianLastSample {
	// Context it belongs to.
	readonly contextId: string
	// Hour angle, radians in (−π, π].
	readonly hourAngle: Angle
	// Pier side reported.
	readonly pierSide: PierSide
}

// Assessment one evaluation produces.
export interface MeridianView {
	// Whether the mount can be evaluated.
	readonly availability: MeridianAvailability
	// Forecast of the passage.
	readonly timing: MeridianTiming
	// Whether the pier side still needs a flip.
	readonly mechanical: MeridianMechanicalAssessment
	// Why something is unknown or unavailable.
	readonly reason?: MeridianMonitorReason
	// Pier side the geometry expects.
	readonly expectedPierSide?: PierSide
}

// What a monitor remembers between evaluations; immutable, replaced by each one.
export interface MeridianFlipMemory {
	// Target being observed.
	readonly context?: MeridianObservationContext
	// Passage of the context through the upper meridian.
	readonly episodeId?: string
	// Transitions published once per episode that were already published in it.
	readonly emitted: readonly MeridianTransitionKind[]
	// Position settling, while there is one.
	readonly settling?: MeridianSettling
	// Whether the context was left (a motion, a jump, a stop of tracking) since its last monitored sample.
	readonly interrupted: boolean
	// Whether the mount or its telemetry was lost while monitoring and has not come back.
	readonly lost: boolean
	// Last monitored sample.
	readonly last?: MeridianLastSample
	// Assessment of the last evaluation.
	readonly view: MeridianView
}

// Transition one evaluation observed, before the service gives it an id, a revision, and an instant.
export interface MeridianTransitionDraft {
	// What changed.
	readonly kind: MeridianTransitionKind
	// Timing phase when it was observed.
	readonly phase: MeridianTimingPhase
	// Mechanical assessment when it was observed.
	readonly mechanical: MeridianMechanicalAssessment
	// Pier side reported.
	readonly pierSide: PierSide
	// Pier side reported before, for pierSideChanged and externalFlipSuspected.
	readonly previousPierSide?: PierSide
}

// Result of one evaluation.
export interface MeridianFlipEvaluation {
	// Memory after the evaluation.
	readonly memory: MeridianFlipMemory
	// Transitions observed, in order.
	readonly transitions: readonly MeridianTransitionDraft[]
}

// Memory of a monitor that has evaluated nothing yet.
export const INITIAL_MERIDIAN_FLIP_MEMORY: MeridianFlipMemory = { emitted: [], interrupted: false, lost: false, view: { availability: 'waitingForMount', timing: { phase: 'unavailable', quality: 'unavailable' }, mechanical: 'unknown', reason: 'disconnected' } }

// Transitions published at most once per episode.
const ONCE_PER_EPISODE: ReadonlySet<MeridianTransitionKind> = new Set<MeridianTransitionKind>(['approaching', 'upperMeridianCrossed', 'windowOpened', 'flipCandidate', 'deadlineApproaching', 'deadlinePassed'])

// Reads the telemetry of a mount; commanded tells whether an operation moves it.
export function mountSample(mount: Mount, commanded: boolean): MeridianMountSample {
	const { rightAscension, declination } = mount.equatorialCoordinate
	return {
		connected: mount.connected,
		mountType: mount.mountType,
		tracking: mount.tracking,
		trackMode: mount.trackMode,
		parked: mount.parked,
		moving: commanded || mount.slewing || mount.moving || mount.parking || mount.homing,
		hasPierSide: mount.hasPierSide,
		pierSide: mount.pierSide,
		hasEquatorialCoordinate: mount.hasEquatorialCoordinate,
		rightAscension,
		declination,
		hasGeographicCoordinate: mount.hasGeographicCoordinate,
		longitude: mount.geographicCoordinate.longitude,
	}
}

// Policy of the toolkit's decision engine for the settings: the early warning before the meridian and the window after
// it, as hour angles in radians. No pier side is configured, so the engine only classifies the thresholds.
function meridianPolicy(settings: MeridianFlipSettings): MeridianFlipPolicy {
	return { enabled: true, prepareAt: -settings.earlyWarningSeconds * SIDEREAL_DRIFT_RATE, flipAt: settings.minimumSeconds * SIDEREAL_DRIFT_RATE, latestAt: settings.maximumSeconds * SIDEREAL_DRIFT_RATE }
}

// Timing phase of a threshold phase of the engine, which only yields WAITING, PREPARING, or READY without pier sides.
function timingPhase(phase: MeridianFlipPhase, overdue: boolean): MeridianTimingPhase {
	if (overdue) return 'pastDeadline'
	if (phase === 'WAITING') return 'before'
	if (phase === 'PREPARING') return 'approaching'
	if (phase === 'READY') return 'windowOpen'
	return 'unavailable'
}

// Returns whether a timing phase is inside or past the preferred window.
function windowReached(phase: MeridianTimingPhase) {
	return phase === 'windowOpen' || phase === 'pastDeadline'
}

// Forecast of the passage of a right ascension of date at an instant, for a sample whose target is settled or settling.
// lst is the local apparent sidereal time in radians; now is Unix milliseconds.
function forecast(settings: MeridianFlipSettings, rightAscension: Angle, lst: Angle, trackMode: TrackMode, now: number) {
	const decision = evaluateMeridianFlip(meridianPolicy(settings), { localSiderealTime: lst, target: { rightAscension } }, createMeridianFlipState())
	const secondsToTransit = -decision.hourAngle / SIDEREAL_DRIFT_RATE
	const transitAt = now + secondsToTransit * 1000
	const windowClosesAt = transitAt + settings.maximumSeconds * 1000

	const timing: MeridianTiming = {
		phase: timingPhase(decision.phase, decision.isOverdue),
		quality: trackMode === 'SIDEREAL' ? 'valid' : 'approximate',
		hourAngle: decision.hourAngle,
		secondsToTransit,
		warningAt: transitAt - settings.earlyWarningSeconds * 1000,
		transitAt,
		windowOpensAt: transitAt + settings.minimumSeconds * 1000,
		deadlineWarningAt: windowClosesAt - settings.deadlineWarningSeconds * 1000,
		windowClosesAt,
	}

	// Wall-clock seconds until the window closes, negative once it closed.
	const secondsToDeadline = decision.untilLatest / SIDEREAL_DRIFT_RATE
	return { timing, secondsToDeadline }
}

// Assesses the reported pier side against the side expected for the position, for a sample in the given availability
// and timing phase. Returns the assessment and, when it is unknown or unsupported, why.
function mechanicalOf(sample: MeridianMountSample, availability: MeridianAvailability, phase: MeridianTimingPhase, expected: PierSide | undefined): readonly [MeridianMechanicalAssessment, MeridianMonitorReason?] {
	if (sample.mountType === 'ALTAZ') return ['unsupportedMountType', 'altazimuthMount']
	if (sample.mountType === 'EQ_FORK') return ['unsupportedMountType', 'forkMount']
	if (availability === 'repositioning' || availability === 'settling') return ['verificationPending']
	if (availability !== 'monitoring') return ['unknown']
	if (sample.mountType === 'UNKNOWN') return ['unknown', 'unknownMountType']
	if (!sample.hasPierSide || sample.pierSide === 'NEITHER') return ['unknown', 'noPierSide']
	if (expected === undefined || expected === 'NEITHER') return ['unknown', 'nearPole']
	if (!windowReached(phase)) return ['notDue']
	return sample.pierSide === expected ? ['alreadyOnExpectedSide'] : ['flipCandidate']
}

// Evaluates a monitor at an instant: infers or keeps the observation context, forecasts the passage, assesses the pier
// side, and reports the transitions since the previous evaluation. Pure: memory is never mutated, now is Unix
// milliseconds (UTC) read from the host clock, settings are in force, and newId creates the ids of new contexts and
// episodes. Transitions are only observed while monitoring, besides monitorUnavailable.
export function evaluateMeridianFlipMonitor(memory: MeridianFlipMemory, sample: MeridianMountSample, settings: MeridianFlipSettings, now: number, newId: () => string = () => Bun.randomUUIDv7()): MeridianFlipEvaluation {
	let { context, episodeId, emitted, settling, interrupted, lost, last } = memory
	let availability: MeridianAvailability
	let reason: MeridianMonitorReason | undefined
	// Whether the context was resumed by this evaluation after an interruption.
	let resumed = false
	// Whether this evaluation replaced a context with a new one.
	let replaced = false

	const near = (target: { readonly rightAscension: Angle; readonly declination: Angle }) => angularDistance(target.rightAscension, target.declination, sample.rightAscension, sample.declination) <= CONTEXT_TOLERANCE

	if (!sample.connected) {
		availability = 'waitingForMount'
		reason = 'disconnected'
	} else if (!sample.hasEquatorialCoordinate) {
		availability = 'waitingForCoordinates'
		reason = 'noCoordinates'
	} else if (!sample.hasGeographicCoordinate) {
		availability = 'waitingForCoordinates'
		reason = 'noSite'
	} else if (sample.moving) {
		availability = 'repositioning'
		reason = 'moving'
	} else if (sample.parked) {
		availability = 'idle'
		reason = 'parked'
	} else if (!sample.tracking) {
		availability = 'idle'
		reason = 'notTracking'
	} else if (context && !interrupted && near(context)) {
		availability = 'monitoring'
		settling = undefined
	} else {
		if (context) interrupted = true
		if (!settling || !near(settling)) settling = { since: now, rightAscension: sample.rightAscension, declination: sample.declination }

		if (now - settling.since >= settings.settleSeconds * 1000) {
			if (context && near(context)) {
				resumed = true
			} else {
				replaced = context !== undefined
				context = { id: newId(), rightAscension: sample.rightAscension, declination: sample.declination, establishedAt: now }
				episodeId = newId()
				emitted = []
				last = undefined
			}

			interrupted = false
			settling = undefined
			availability = 'monitoring'
		} else {
			availability = 'settling'
			reason = 'settling'
		}
	}

	if (availability === 'waitingForMount') {
		context = undefined
		episodeId = undefined
		emitted = []
		last = undefined
		interrupted = false
	} else if (availability !== 'monitoring' && availability !== 'settling' && context) {
		interrupted = true
	}

	if (availability !== 'settling') settling = undefined

	let timing: MeridianTiming = { phase: 'unavailable', quality: 'unavailable' }
	let expected: PierSide | undefined
	let secondsToDeadline = Infinity

	if (sample.connected && sample.hasEquatorialCoordinate && sample.hasGeographicCoordinate) {
		const lst = localSiderealTime(timeUnix(now / 1000, true), sample.longitude)
		expected = expectedPierSide(sample.rightAscension, sample.declination, lst)

		if (availability === 'monitoring' || availability === 'settling') {
			const result = forecast(settings, sample.rightAscension, lst, sample.trackMode, now)
			timing = result.timing
			secondsToDeadline = result.secondsToDeadline
		} else {
			timing = { phase: 'unavailable', quality: 'unavailable', hourAngle: hourAngle(lst, sample.rightAscension) }
		}
	}

	const [mechanical, mechanicalReason] = mechanicalOf(sample, availability, timing.phase, expected)
	reason ??= mechanicalReason ?? (timing.quality === 'approximate' ? 'nonSiderealTracking' : undefined)

	const transitions: MeridianTransitionDraft[] = []
	const emit = (kind: MeridianTransitionKind, previousPierSide?: PierSide, phase: MeridianTimingPhase = timing.phase) => {
		if (ONCE_PER_EPISODE.has(kind)) {
			if (emitted.includes(kind)) return
			emitted = [...emitted, kind]
		}

		transitions.push({ kind, phase, mechanical, pierSide: sample.pierSide, previousPierSide })
	}

	if (availability === 'monitoring' && context && timing.hourAngle !== undefined) {
		const ha = timing.hourAngle

		if (replaced) emit('targetChanged')

		if (last && last.contextId === context.id) {
			if (!resumed && last.hourAngle > PIOVERTWO && ha < -PIOVERTWO) {
				// The target passed the lower meridian: its next upper passage is another episode.
				episodeId = newId()
				emitted = []
			} else if (!resumed && last.hourAngle < 0 && ha >= 0 && last.hourAngle > -PIOVERTWO) {
				emit('upperMeridianCrossed')
			}

			if (last.pierSide !== sample.pierSide && last.pierSide !== 'NEITHER' && sample.pierSide !== 'NEITHER') {
				emit('pierSideChanged', last.pierSide)
				if (resumed && windowReached(timing.phase)) emit('externalFlipSuspected', last.pierSide)
			}
		}

		if (timing.phase === 'approaching') emit('approaching')
		if (timing.phase === 'windowOpen') emit('windowOpened')

		if (mechanical === 'flipCandidate') {
			emit('flipCandidate')
			if (timing.phase === 'windowOpen' && secondsToDeadline <= settings.deadlineWarningSeconds) emit('deadlineApproaching')
			if (timing.phase === 'pastDeadline') emit('deadlinePassed')
		}

		if (lost) {
			emit('monitorRecovered')
			lost = false
		}

		last = { contextId: context.id, hourAngle: ha, pierSide: sample.pierSide }
	} else if (memory.view.availability === 'monitoring' && (availability === 'waitingForMount' || availability === 'waitingForCoordinates')) {
		emit('monitorUnavailable', undefined, memory.view.timing.phase)
		lost = true
	}

	const view: MeridianView = { availability, timing, mechanical, reason, expectedPierSide: expected }
	return { memory: { context, episodeId, emitted, settling, interrupted, lost, last, view }, transitions }
}

// Answers whether a hypothetical exposure starting now ends within the preferred window of a monitor; pure and without
// side effects. now is Unix milliseconds (UTC).
export function assessMeridianExposure(monitor: MeridianFlipMonitor, { exposureSeconds, overheadSeconds, expectedContextId }: MeridianExposureRequest, now: number): MeridianExposureAssessment {
	const { contextId, timing, mechanical } = monitor

	if (expectedContextId !== undefined && expectedContextId !== contextId) return { decision: 'unknown', reason: 'The observed target changed since the decision was made' }
	if (monitor.availability !== 'monitoring' || contextId === undefined) return { decision: 'unknown', reason: 'The mount is not tracking a settled target' }

	if (mechanical === 'unsupportedMountType') return { decision: 'allowed', validForContextId: contextId, reason: 'This mount type needs no meridian flip' }
	if (mechanical === 'alreadyOnExpectedSide') return { decision: 'allowed', validForContextId: contextId, reason: 'The mount already reports the pier side expected past the meridian' }
	if (mechanical === 'unknown' || mechanical === 'verificationPending' || timing.windowClosesAt === undefined) return { decision: 'unknown', reason: 'The pier side or the forecast is not known well enough' }

	const duration = (exposureSeconds + overheadSeconds) * 1000
	const latestSafeStartAt = timing.windowClosesAt - duration

	if (now <= latestSafeStartAt) return { decision: 'allowed', validForContextId: contextId, latestSafeStartAt, reason: 'It ends before the preferred flip window closes; this is a timing preference, not a tracking limit of the mount' }
	if (!windowReached(timing.phase)) return { decision: 'defer', validForContextId: contextId, reevaluateAt: timing.windowOpensAt, reason: 'It would end after the preferred flip window closes' }
	return { decision: 'blocked', validForContextId: contextId, reason: 'The preferred flip window is open or past with a flip candidate pending' }
}

// Timing of the service, in milliseconds, and its clock.
export interface MeridianFlipOptions {
	// Host clock, Unix milliseconds (UTC).
	readonly now: () => number
	// Interval between evaluations of every monitor, so the passage of sidereal time is observed without new telemetry.
	readonly tickInterval: number
	// Longest interval between two publications of an unchanged monitor, so tabs reconcile their countdowns.
	readonly refreshInterval: number
}

// Default timing: an evaluation per second, a publication at least every 30 seconds.
export const DEFAULT_MERIDIAN_FLIP_OPTIONS: MeridianFlipOptions = { now: () => Date.now(), tickInterval: 1000, refreshInterval: 30000 }

// Enabled monitor.
interface MonitorEntry extends MeridianFlipKey {
	// Id of this enablement.
	readonly monitorId: string
	// Physical identity of the mount.
	readonly key: string
	// Mount it observes.
	readonly mount: Mount
	// Settings in force and their revision.
	settings: MeridianFlipSettings
	settingsRevision: number
	// What the evaluator remembers.
	memory: MeridianFlipMemory
	// Instant of the last evaluation, Unix milliseconds.
	sampledAt: number
	// Revision of the last publication.
	revision: number
	// Material state of the last publication, and its instant in Unix milliseconds.
	published: string
	publishedAt: number
	// Running operations moving the mount, by id.
	readonly operations: Set<string>
	// Recent transitions, oldest first.
	readonly transitions: MeridianFlipTransition[]
}

// Responds with a refused monitor request.
function monitorError(message: string, status: number, code: MeridianFlipErrorCode, details?: object): Response {
	return errorResponse(message, status, code, details)
}

// Monitors of the mounts of the open connections; reads them and commands nothing.
export class MeridianFlipService implements Disposable {
	// Enabled monitors by resourceKey of their mount.
	readonly #monitors = new Map<string, MonitorEntry>()
	// Id of this process run.
	readonly #epoch = Bun.randomUUIDv7()
	// Revision of the last publication.
	#revision = 0
	// Evaluates every monitor while any is enabled.
	#timer?: ReturnType<typeof setInterval>

	// Creates the service over the devices of every open connection; operations only resolves devices and is never
	// asked for one, publish receives every event synchronously, and options sets the clock and the timing.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly publish: (event: MeridianFlipEvent) => void,
		readonly options: MeridianFlipOptions = DEFAULT_MERIDIAN_FLIP_OPTIONS,
	) {}

	// Returns every enabled monitor.
	snapshot(): MeridianFlipSnapshot {
		return { epoch: this.#epoch, revision: this.#revision, monitors: Array.from(this.#monitors.values(), (entry) => this.#monitor(entry)) }
	}

	// Returns the monitor of a mount, or undefined when none is enabled for it.
	monitor(connectionId: string, deviceId: string): MeridianFlipMonitor | undefined {
		const entry = this.#find(connectionId, deviceId)
		return entry && this.#monitor(entry)
	}

	// Enables the monitor of a connected mount with settings and responds 200 with MeridianFlipMonitor. A monitor already
	// enabled for the mount answers itself unchanged. Responds 404 for an unknown mount, 409 disconnected, and 409
	// conflict when the same physical mount is monitored through another connection or id.
	enable(connectionId: string, deviceId: string, settings: MeridianFlipSettings): Response {
		const mount = connectedDevice(this, connectionId, 'mount', deviceId, 'Mount')
		if (mount instanceof Response) return mount

		const key = resourceKey(mount)
		const running = this.#monitors.get(key)

		if (running) {
			if (running.connectionId === connectionId && running.deviceId === deviceId) return Response.json(this.#monitor(running))
			return monitorError('This mount is already monitored through another connection', 409, 'conflict')
		}

		const entry: MonitorEntry = { connectionId, deviceId, monitorId: Bun.randomUUIDv7(), key, mount, settings, settingsRevision: 1, memory: INITIAL_MERIDIAN_FLIP_MEMORY, sampledAt: 0, revision: 0, published: '', publishedAt: 0, operations: new Set(), transitions: [] }

		for (const operation of this.operations.running()) this.#track(entry, operation)

		this.#monitors.set(key, entry)
		this.#evaluate(entry, true)
		this.#timer ??= setInterval(() => this.#tick(), this.options.tickInterval)
		return Response.json(this.#monitor(entry))
	}

	// Disables the monitor of a mount, forgetting its context and transitions. Responds 204, also when none was enabled.
	disable(connectionId: string, deviceId: string): Response {
		const entry = this.#find(connectionId, deviceId)
		if (entry) this.#remove(entry)
		return new Response(null, { status: 204 })
	}

	// Replaces the settings of an enabled monitor and evaluates it at once; responds 200 with MeridianFlipMonitor, 404
	// when no monitor is enabled, and 409 conflict with the current monitor when expectedRevision is outdated.
	updateSettings(connectionId: string, deviceId: string, { settings, expectedRevision }: MeridianFlipSettingsRequest): Response {
		const entry = this.#find(connectionId, deviceId)
		if (!entry) return monitorError('The meridian flip monitor of this mount is not enabled', 404, 'notFound')
		if (entry.settingsRevision !== expectedRevision) return monitorError('The settings were changed by another tab', 409, 'conflict', { monitor: this.#monitor(entry) })

		entry.settings = settings
		entry.settingsRevision++
		this.#evaluate(entry, true)
		return Response.json(this.#monitor(entry))
	}

	// Responds with the recent transitions of an enabled monitor, oldest first, or 404.
	transitions(connectionId: string, deviceId: string): Response {
		const entry = this.#find(connectionId, deviceId)
		if (!entry) return monitorError('The meridian flip monitor of this mount is not enabled', 404, 'notFound')
		return Response.json({ transitions: entry.transitions })
	}

	// Answers whether a hypothetical next exposure ends within the preferred window, evaluating the monitor now; starts,
	// stops, and changes nothing. Responds 200 with MeridianExposureAssessment, or 404.
	assessExposure(connectionId: string, deviceId: string, request: MeridianExposureRequest): Response {
		const entry = this.#find(connectionId, deviceId)
		if (!entry) return monitorError('The meridian flip monitor of this mount is not enabled', 404, 'notFound')
		this.#evaluate(entry)
		return Response.json(assessMeridianExposure(this.#monitor(entry), request, entry.sampledAt))
	}

	// Observes the events of the process: mount telemetry and motion operations evaluate the monitor of their mount, a
	// removed mount or a closed connection removes its monitors. Its own events are ignored.
	consume(event: ServerEvent) {
		switch (event.type) {
			case 'mount:updated': {
				const entry = this.#find(event.state.connectionId, event.state.id)
				if (entry) this.#evaluate(entry)
				break
			}
			case 'device:updated': {
				const entry = this.#find(event.connectionId, event.id)
				if (entry) this.#evaluate(entry)
				break
			}
			case 'operation:updated':
				for (const entry of this.#monitors.values()) if (this.#track(entry, event.operation)) this.#evaluate(entry)
				break
			case 'device:removed':
				for (const entry of Array.from(this.#monitors.values())) if (entry.connectionId === event.connectionId && entry.deviceId === event.id) this.#remove(entry)
				break
			case 'connection:close':
				for (const entry of Array.from(this.#monitors.values())) if (entry.connectionId === event.id) this.#remove(entry)
				break
		}
	}

	// Stops the evaluations and forgets every monitor; nothing is published and nothing was commanded.
	[Symbol.dispose]() {
		clearInterval(this.#timer)
		this.#timer = undefined
		this.#monitors.clear()
	}

	// Returns the monitor of exactly this mount.
	#find(connectionId: string, deviceId: string) {
		for (const entry of this.#monitors.values()) if (entry.connectionId === connectionId && entry.deviceId === deviceId) return entry
		return undefined
	}

	// Records whether a motion operation moves the mount of a monitor. Returns whether it concerns the mount.
	#track(entry: MonitorEntry, operation: OperationRecord) {
		if (!MOTION_KINDS.has(operation.kind) || !operation.devices.some((device) => device.connectionId === entry.connectionId && device.deviceId === entry.deviceId)) return false
		if (operation.state === 'running') entry.operations.add(operation.operationId)
		else entry.operations.delete(operation.operationId)
		return true
	}

	// Evaluates every monitor; a failure of one is logged and the others still are.
	#tick() {
		for (const entry of Array.from(this.#monitors.values())) {
			try {
				this.#evaluate(entry)
			} catch (error) {
				console.error('meridian flip monitor: the evaluation failed', error)
			}
		}
	}

	// Evaluates a monitor now and publishes it when it changed materially, when the refresh interval elapsed, or when
	// forced, then its transitions.
	#evaluate(entry: MonitorEntry, force = false) {
		const now = this.options.now()
		const { memory, transitions } = evaluateMeridianFlipMonitor(entry.memory, mountSample(entry.mount, entry.operations.size > 0), entry.settings, now)
		entry.memory = memory
		entry.sampledAt = now

		const { view, context, episodeId } = memory
		const published = JSON.stringify([view.availability, view.timing.phase, view.timing.quality, view.mechanical, view.reason, view.expectedPierSide, entry.mount.pierSide, entry.mount.mountType, entry.mount.tracking, entry.mount.trackMode, context?.id, episodeId, entry.settingsRevision])

		if (!force && transitions.length === 0 && published === entry.published && now - entry.publishedAt < this.options.refreshInterval) return

		entry.published = published
		entry.publishedAt = now
		this.#publishMonitor(entry)

		for (const draft of transitions) {
			const transition: MeridianFlipTransition = { transitionId: Bun.randomUUIDv7(), monitorId: entry.monitorId, connectionId: entry.connectionId, deviceId: entry.deviceId, contextId: context?.id, episodeId, revision: entry.revision, at: now, ...draft }
			entry.transitions.push(transition)
			if (entry.transitions.length > TRANSITION_HISTORY) entry.transitions.shift()
			this.publish({ type: 'meridianFlip:transition', epoch: this.#epoch, transition })
		}
	}

	// Removes a monitor and publishes its removal; its timer stops with the last one.
	#remove(entry: MonitorEntry) {
		if (this.#monitors.get(entry.key) !== entry) return
		this.#monitors.delete(entry.key)

		if (this.#monitors.size === 0) {
			clearInterval(this.#timer)
			this.#timer = undefined
		}

		this.publish({ type: 'meridianFlip:updated', epoch: this.#epoch, revision: ++this.#revision, key: { connectionId: entry.connectionId, deviceId: entry.deviceId } })
	}

	// Publishes the state of a monitor under a new revision.
	#publishMonitor(entry: MonitorEntry) {
		entry.revision = ++this.#revision
		this.publish({ type: 'meridianFlip:updated', epoch: this.#epoch, revision: entry.revision, key: { connectionId: entry.connectionId, deviceId: entry.deviceId }, monitor: this.#monitor(entry) })
	}

	// Returns a monitor as published.
	#monitor(entry: MonitorEntry): MeridianFlipMonitor {
		const { monitorId, connectionId, deviceId, revision, settings, settingsRevision, sampledAt, mount, memory } = entry
		const { availability, timing, mechanical, reason, expectedPierSide } = memory.view
		return {
			monitorId,
			connectionId,
			deviceId,
			revision,
			settings,
			settingsRevision,
			sampledAt,
			contextId: memory.context?.id,
			episodeId: memory.episodeId,
			mount: { mountType: mount.mountType, pierSide: mount.pierSide, expectedPierSide, tracking: mount.tracking, trackMode: mount.trackMode },
			availability,
			timing,
			mechanical,
			reason,
		}
	}
}

// Routes of the Meridian Flip Monitor.
export function createMeridianFlipRoutes(service: MeridianFlipService) {
	return {
		'/api/meridian-flip': {
			// Every enabled monitor; their changes arrive as meridianFlip:updated events.
			GET: () => Response.json(service.snapshot()),
		},
		'/api/connections/:id/mounts/:deviceId/meridian-flip/enable': {
			// Enables the monitor of a mount with MeridianFlipSettings; idempotent.
			POST: async (req) => service.enable(req.params.id, req.params.deviceId, (await req.json()) as MeridianFlipSettings),
		},
		'/api/connections/:id/mounts/:deviceId/meridian-flip/disable': {
			// Disables the monitor of a mount; idempotent, commands nothing.
			POST: (req) => service.disable(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/mounts/:deviceId/meridian-flip/settings': {
			// Replaces the settings of an enabled monitor, 409 conflict when they changed meanwhile.
			PATCH: async (req) => service.updateSettings(req.params.id, req.params.deviceId, (await req.json()) as MeridianFlipSettingsRequest),
		},
		'/api/connections/:id/mounts/:deviceId/meridian-flip/transitions': {
			// Recent transitions of an enabled monitor, oldest first, kept in memory only.
			GET: (req) => service.transitions(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/mounts/:deviceId/meridian-flip/assess-exposure': {
			// Read-only assessment of a hypothetical next exposure; starts nothing.
			POST: async (req) => service.assessExposure(req.params.id, req.params.deviceId, (await req.json()) as MeridianExposureRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
