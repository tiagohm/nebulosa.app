import type { CameraCapabilities, MountState, OperationDevice, ServerEvent, TargetCenteringGuidingRestoration, TargetCenteringMode, TargetCenteringOutcome, TargetCenteringRequest, TargetCenteringSenseSource, TargetCenteringSession, TargetCenteringSessionSummary, TargetCenteringState, TargetCenteringStep } from 'api'
import { nanoid } from 'nanoid'
import { equatorialFromJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { ASEC2RAD, DEG2RAD } from 'nebulosa/src/core/constants'
import { sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { formatAngularSize, formatFixed } from '../format'
import { type ApiFetch, browserFetch, deviceUrl, jsonInit } from '../http'
import type { CameraExposureSettings, CameraPlateSolvingSettings, TargetCenteringSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'
import { horizontalOf } from '../sky/mount'
import { cameraKey, fitExposure } from './capture'
import { applySession, type CameraSessionKind, type CameraSessionRecords, refreshSessionRecords, sendSessionCommand } from './sessions'

// Target Centering sessions as this tab knows them. The server owns every session, whichever tab started it, and every
// motion, exposure, and solve of it, so this store only mirrors it: the summary of the latest session of each camera arrives
// with every targetCentering:updated event and, on every socket (re)open, with the snapshot; the complete record, which adds
// the solution of each attempt, is fetched when a summary reports a new solution or an end. Summaries are ordered by their
// revision, and a snapshot leaves what an event changed during its fetch. Cameras and mounts are addressed by their exact
// connection and device ids, never by role. A start carries a token, so a retried request answers the session of the first
// one instead of starting another. The target being edited is kept for the tab across its reloads (centeringTargetsEntry of
// profile/view.ts). Where that target stands for the mount, its altitude and its distance, is computed here from what the
// mount reports, so a Center is refused below the horizon and its confirmation says whether it slews, before the server
// judges again; a session's state reads as a verdict once it ended. A target may also ask for an orientation, the position
// angle of the image top: Verify Only measures it with any camera, and Center turns the rotator of the Equipment Setup,
// whose rotation sense the server keeps.

// J2000 target being edited for a camera, in radians.
export interface TargetCenteringDraft {
	// Right ascension; absent until entered.
	readonly rightAscension?: number
	// Declination; absent until entered.
	readonly declination?: number
	// Name of the object it came from.
	readonly label?: string
	// Whether the session also asks for an orientation.
	readonly oriented?: boolean
	// Position angle of the image top, ICRS, from north through east, in radians, [0, 2π); absent until entered.
	readonly positionAngle?: number
	// What the position angle was taken from, meant for people (a framing, an image); absent when typed.
	readonly orientationSource?: string
}

// Target Centering state of the tab.
export interface TargetCenteringRuntime extends CameraSessionRecords<TargetCenteringSessionSummary, TargetCenteringSession> {
	// Target being edited for each camera, by camera key.
	drafts: Record<string, TargetCenteringDraft>
}

// Target Centering state of the tab.
export const targetCenteringRuntime = proxy<TargetCenteringRuntime>({ sessions: {}, details: {}, drafts: {}, pending: {}, errors: {} })

// How the sessions are mirrored (sessions.ts): the complete record is fetched again when the summary reports a new
// solution or an end.
const TARGET_CENTERING_SESSIONS: CameraSessionKind<TargetCenteringSessionSummary, TargetCenteringSession> = {
	url: '/api/target-centering',
	refreshes: new SnapshotRefreshes(),
	stale: (session, _, details) => !details || solvedCount(details) !== solvedCount(session) || (session.endedAt !== undefined && details.endedAt === undefined),
}

// Label of each session state.
export const TARGET_CENTERING_STATE_LABELS: Readonly<Record<TargetCenteringState, string>> = {
	preparing: 'Preparing',
	running: 'Running',
	stopping: 'Stopping…',
	blocked: 'Mount not confirmed stopped',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Stopped',
}

// Label of each step of a running session.
export const TARGET_CENTERING_STEP_LABELS: Readonly<Record<TargetCenteringStep, string>> = { stoppingGuiding: 'Stopping guiding', slewing: 'Slewing', settling: 'Settling', exposing: 'Exposing', solving: 'Solving', rotating: 'Rotating', correcting: 'Correcting', restoringGuiding: 'Restoring guiding' }

// What an orientation needs from the Equipment Setup: its rotator and whether it can turn now, and whether the setup still
// has to answer whether its guide camera turns with that rotator.
export interface TargetCenteringRotation {
	// Rotator of the setup that turns the camera; absent when it has none.
	readonly rotator?: RoleAvailability
	// Whether the setup has a Guide Camera and a Rotator and no answer yet whether the guide camera turns with it.
	readonly guideRotationUnanswered: boolean
}

// Returns why a mount can never move for a centering, from the state the server reports, or undefined when it can (or its
// state is not known yet). Verify Only commands nothing, so this does not concern it.
export function targetCenteringMountSupport(state: Pick<MountState, 'canGoTo' | 'canAbort'> | undefined): string | undefined {
	if (!state) return undefined
	if (!state.canGoTo) return 'The mount cannot go to a target.'
	if (!state.canAbort) return 'The mount cannot abort a motion, which a centering needs to stop safely.'
	return undefined
}

// Returns why the setup's mount keeps a mode from starting now, or undefined when it does not, from its availability and
// its reported state (undefined while unknown). A mount that is not tracking is accepted when it can switch tracking,
// which the server starts for the session.
export function targetCenteringMountBlocker(mode: TargetCenteringMode, mount: RoleAvailability, state: MountState | undefined): string | undefined {
	if (mount.status !== 'ready') return mount.message
	if (!state) return 'The mount state is not known yet.'
	if (mode === 'verifyOnly') return undefined

	const unsupported = targetCenteringMountSupport(state)
	if (unsupported) return unsupported
	if (state.site.latitude === 0 && state.site.longitude === 0) return 'The mount reports no site; send it from Equipment Control.'
	if (state.parked || state.parking) return 'The mount is parked.'
	if (!state.tracking && !state.canTracking) return 'The mount is not tracking and cannot start tracking.'
	return undefined
}

// Returns why a mode cannot start now, or undefined when it can, from the availability of the camera and of the setup's
// mount, the mount's reported state (undefined while unknown), the target, and where the target stands for the mount
// (targetCenteringPosition; absent while unknown). A Center refuses a target below the horizon of the mount's site, as
// the server does. The server checks again.
// An orientation also needs its position angle; a Center of one needs the setup's rotator ready, a mount that is not
// alt-az, and the answer whether the guide camera turns with the rotator (rotation); Verify Only measures it with none.
export function targetCenteringBlocker(mode: TargetCenteringMode, camera: RoleAvailability, mount: RoleAvailability, state: MountState | undefined, draft: TargetCenteringDraft | undefined, position?: TargetCenteringPosition, rotation?: TargetCenteringRotation): string | undefined {
	if (camera.status !== 'ready') return camera.message
	const mounted = targetCenteringMountBlocker(mode, mount, state)
	if (mounted) return mounted
	if (draft?.rightAscension === undefined || draft.declination === undefined) return 'Enter the coordinates of the target.'
	if (mode === 'center' && position && position.altitude < 0) return `${draft.label ?? 'The target'} is ${formatFixed(toDeg(-position.altitude), 1)}° below the horizon of the mount's site.`
	if (!draft.oriented) return undefined
	if (draft.positionAngle === undefined) return 'Enter the position angle of the image top.'
	if (mode === 'verifyOnly') return undefined
	if (!rotation?.rotator) return 'Centering an orientation needs a Rotator in the Equipment Setup.'
	if (rotation.rotator.status !== 'ready') return rotation.rotator.message
	if (state?.mountType === 'ALTAZ') return 'The field of an alt-az mount turns all the time; a rotator cannot hold an orientation on it.'
	if (rotation.guideRotationUnanswered) return 'Answer in the Equipment Setup whether the guide camera turns with the rotator.'
	return undefined
}

// Where a target stands for a mount now.
export interface TargetCenteringPosition {
	// Geometric altitude of the target at the mount's site, in radians; negative below the horizon.
	readonly altitude: number
	// Great-circle distance from where the mount reports it points to the target, in radians, [0, π].
	readonly distance: number
}

// Returns where a J2000 target stands for a mount at a Unix time in milliseconds: its geometric altitude at the site the
// mount reports and its distance from the position of date the mount reports. Undefined without a target, without a
// state, or while the mount reports no site; the server judges again with its own clock.
export function targetCenteringPosition(state: Pick<MountState, 'rightAscension' | 'declination' | 'site'> | undefined, draft: TargetCenteringDraft | undefined, time: number): TargetCenteringPosition | undefined {
	if (!state || draft?.rightAscension === undefined || draft.declination === undefined) return undefined
	if (state.site.latitude === 0 && state.site.longitude === 0) return undefined

	const [rightAscension, declination] = equatorialFromJ2000(draft.rightAscension, draft.declination, timeUnix(time / 1000, true))
	const { altitude } = horizontalOf({ rightAscension, declination }, time, { latitude: toDeg(state.site.latitude), longitude: toDeg(state.site.longitude) })
	return { altitude, distance: sphericalSeparation(state.rightAscension, state.declination, rightAscension, declination) }
}

// Returns whether a Center starting at a position slews first: when the mount stands farther from the target than the
// largest correction, in radians, or when where it stands is not known. Otherwise it is corrected from plate solved frames
// only, as the server decides with what the mount reports then.
export function targetCenteringSlews(position: TargetCenteringPosition | undefined, maximumCorrection: number): boolean {
	return position === undefined || position.distance > maximumCorrection
}

// Returns the one-line state of a session for its heading and its collapsed section: what it is doing while it runs, and
// how it ended, which a completed one states as a verdict with the distance it measured.
export function targetCenteringStateText(session: Pick<TargetCenteringSessionSummary, 'state' | 'step' | 'request' | 'finalSeparation' | 'finalPositionAngleError' | 'positionVerified' | 'orientationVerified' | 'readyForImaging'>): string {
	const { state, step, request, finalSeparation, finalPositionAngleError, positionVerified, orientationVerified, readyForImaging } = session
	const off = finalSeparation === undefined ? undefined : formatAngularSize(finalSeparation)
	// The PA error rides along the distance whenever an orientation was asked.
	const distance = request.orientation && finalPositionAngleError !== undefined ? [off, `PA ${formatSignedDegrees(finalPositionAngleError)}`].filter(Boolean).join(' · ') : off
	const label = request.target.label

	switch (state) {
		case 'preparing':
		case 'running':
			return `${request.mode === 'verifyOnly' ? 'Verifying' : 'Centering'} · ${step ? TARGET_CENTERING_STEP_LABELS[step] : 'Preparing'}`
		case 'completed':
			if (!positionVerified) return distance ? `Off target · ${distance}` : 'Off target'
			if (request.orientation && !orientationVerified) return distance ? `Off orientation · ${distance}` : 'Off orientation'
			return [`${request.mode === 'verifyOnly' ? 'On target' : 'Centered'}${label ? ` on ${label}` : ''}`, distance, !readyForImaging && 'guiding not restored'].filter(Boolean).join(' · ')
		case 'failed':
			return distance ? `Failed · ${distance} off` : 'Failed'
		default:
			return TARGET_CENTERING_STATE_LABELS[state]
	}
}

// Returns whether a session that ended measured another target than the one being edited, so its result no longer speaks
// for the form.
export function targetCenteringStale(session: Pick<TargetCenteringSessionSummary, 'endedAt' | 'request'>, draft: TargetCenteringDraft | undefined): boolean {
	if (targetCenteringRunning(session) || draft?.rightAscension === undefined || draft.declination === undefined) return false
	const { rightAscension, declination } = session.request.target
	return Math.abs(rightAscension - draft.rightAscension) > TARGET_EPSILON || Math.abs(declination - draft.declination) > TARGET_EPSILON
}

// Largest difference of right ascension or declination, in radians, between two targets taken as the same: far below a
// milliarcsecond, so only an unchanged target matches.
const TARGET_EPSILON = 1e-12

// Returns the frames of a session: the one exposing counts while it runs; once it ended, only those whose solve ended.
export function targetCenteringFrameCount({ attempts, endedAt }: Pick<TargetCenteringSessionSummary, 'attempts' | 'endedAt'>): number {
	return endedAt === undefined ? attempts.length : attempts.filter(({ outcome }) => outcome !== undefined).length
}

// Formats an angle in radians as signed degrees to a hundredth.
export function formatSignedDegrees(angle: number) {
	const degrees = toDeg(angle)
	return `${degrees > 0 ? '+' : ''}${formatFixed(degrees, 2)}°`
}

// Label of where the rotation sense of a session came from.
export const TARGET_CENTERING_SENSE_SOURCE_LABELS: Readonly<Record<TargetCenteringSenseSource, string>> = { stored: 'Known from an earlier session', learned: 'Learned in this session and kept for the next one', relearned: 'Learned again in this session, the known one being reversed, and kept for the next one' }

// Label of what became of a frame.
export const TARGET_CENTERING_OUTCOME_LABELS: Readonly<Record<TargetCenteringOutcome, string>> = { solved: 'Solved', noSolution: 'No solution', invalid: 'Rejected', timeout: 'Timed out', failed: 'Solver failed' }

// Builds the start request of a mode from the form of a camera, for the mount of the Equipment Setup and the guide output
// that drives it (its GUIDE_OUTPUT, absent when it has none), whose guiding the session coordinates. The frames take the exposure time of the form
// and the camera settings of exposure, whose own exposure time is never sent, fitted to the camera's capabilities as a
// capture is, and are solved with the plate solving settings of the camera; the angles are sent in radians. A target with
// a position angle asks for that orientation too, with the tolerance and the half-turn equivalence of the form, and a
// Center of it turns the rotator given. Everything is copied, so the session never depends on the profile.
export function targetCenteringRequest(
	mode: TargetCenteringMode,
	target: { readonly rightAscension: number; readonly declination: number; readonly label?: string; readonly positionAngle?: number },
	settings: Readonly<TargetCenteringSettings>,
	exposure: Readonly<CameraExposureSettings>,
	solving: Readonly<CameraPlateSolvingSettings>,
	{ mount, guideOutput, rotator }: { readonly mount: OperationDevice; readonly guideOutput?: OperationDevice; readonly rotator?: OperationDevice },
	capabilities?: CameraCapabilities,
): Omit<TargetCenteringRequest, 'token'> {
	const { rightAscension, declination, label, positionAngle } = target
	const { exposureTime, tolerance, maximumCorrections, noSolutionRetries, maximumFrames, settleDelay, maximumCorrection, blindRetry, coordinateGuiding, orientationTolerance, halfTurn } = settings
	const orientation = positionAngle === undefined ? undefined : { positionAngle, tolerance: orientationTolerance * DEG2RAD, halfTurn }

	return {
		mount,
		...(guideOutput && { guideOutput }),
		...(orientation && { orientation }),
		// Verify Only turns nothing, so it never holds the rotator.
		...(orientation && mode === 'center' && rotator && { rotator }),
		mode,
		target: { frame: 'J2000', rightAscension, declination, ...(label !== undefined && { label }) },
		capture: fitExposure({ ...exposure, exposureTime }, capabilities),
		solving: { ...solving },
		tolerance: tolerance * ASEC2RAD,
		maximumCorrections,
		noSolutionRetries,
		maximumFrames,
		settleDelay,
		maximumCorrection: maximumCorrection * DEG2RAD,
		blindRetry,
		guiding: coordinateGuiding ? 'coordinate' : 'requireIdle',
	}
}

// Label of what became of guiding, when something did.
export const TARGET_CENTERING_GUIDING_LABELS: Readonly<Record<Exclude<TargetCenteringGuidingRestoration, 'notNeeded'>, string>> = { restored: 'Restored', failed: 'Not restored', externallyChanged: 'Changed by someone else' }

// Returns whether a session has not ended; a blocked one has not, until it is dismissed.
export function targetCenteringRunning(session: Pick<TargetCenteringSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// Steps of the radial scale of the bullseye, in arcseconds: each ring is one step, and the largest step that keeps every
// point inside RINGS rings is used.
const BULLSEYE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200, 18000, 36000] as const

// Rings of the bullseye.
export const BULLSEYE_RINGS = 3

// Returns the arcseconds of one ring of a bullseye holding a distance in arcseconds: the smallest step of the scale whose
// rings hold it, or the largest step.
export function bullseyeRing(distance: number): number {
	return BULLSEYE_STEPS.find((step) => step * BULLSEYE_RINGS >= distance) ?? BULLSEYE_STEPS.at(-1)!
}

// Returns the number of attempts of a session that were solved.
function solvedCount({ attempts }: Pick<TargetCenteringSessionSummary, 'attempts'>) {
	return attempts.filter(({ outcome }) => outcome === 'solved').length
}

// Applies a Target Centering event (applySession); any other event is ignored.
export function handleTargetCenteringEvent(state: TargetCenteringRuntime, event: ServerEvent, request: ApiFetch = browserFetch) {
	if (event.type === 'targetCentering:updated') applySession(state, TARGET_CENTERING_SESSIONS, event.session, request)
}

// Replaces the sessions with the server's snapshot and fetches their complete records (refreshSessionRecords).
export function refreshTargetCentering(state: TargetCenteringRuntime, request: ApiFetch = browserFetch) {
	return refreshSessionRecords(state, TARGET_CENTERING_SESSIONS, request)
}

// Sends a command of a camera (sendSessionCommand).
function command(state: TargetCenteringRuntime, key: string, url: string, body: unknown, request: ApiFetch) {
	return sendSessionCommand(state, key, url, jsonInit('POST', body), () => refreshTargetCentering(state, request), request)
}

// Starts a session with a camera; its progress arrives as events.
export function startTargetCentering(state: TargetCenteringRuntime, connectionId: string, deviceId: string, body: Omit<TargetCenteringRequest, 'token'>, request: ApiFetch = browserFetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'target-centering')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: nanoid() } satisfies TargetCenteringRequest, request)
}

// Stops the session of a camera, or dismisses a blocked one.
export function stopTargetCentering(state: TargetCenteringRuntime, session: Pick<TargetCenteringSessionSummary, 'sessionId' | 'camera'>, request: ApiFetch = browserFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/target-centering/${encodeURIComponent(session.sessionId)}/stop`, undefined, request)
}
