import type { CameraCapabilities, MountState, OperationDevice, ServerEvent, TargetCenteringGuidingRestoration, TargetCenteringMode, TargetCenteringRequest, TargetCenteringSession, TargetCenteringSessionSummary, TargetCenteringState, TargetCenteringStep } from 'api'
import { nanoid } from 'nanoid'
import { ASEC2RAD, DEG2RAD } from 'nebulosa/src/core/constants'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { type ApiFetch, browserFetch, deviceUrl, jsonInit } from '../http'
import type { CameraExposureSettings, CameraPlateSolvingSettings, TargetCenteringSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'
import { cameraKey, fitExposure } from './capture'
import { applySession, type CameraSessionKind, type CameraSessionRecords, refreshSessionRecords, sendSessionCommand } from './sessions'

// Target Centering sessions as this tab knows them. The server owns every session, whichever tab started it, and every
// motion, exposure, and solve of it, so this store only mirrors it: the summary of the latest session of each camera arrives
// with every targetCentering:updated event and, on every socket (re)open, with the snapshot; the complete record, which adds
// the solution of each attempt, is fetched when a summary reports a new solution or an end. Summaries are ordered by their
// revision, and a snapshot leaves what an event changed during its fetch. Cameras and mounts are addressed by their exact
// connection and device ids, never by role. A start carries a token, so a retried request answers the session of the first
// one instead of starting another. The target being edited is kept for the tab across its reloads (centeringTargetsEntry of
// profile/view.ts); a saved framing is what lasts, in the profile.

// J2000 target being edited for a camera, in radians.
export interface TargetCenteringDraft {
	// Right ascension; absent until entered.
	readonly rightAscension?: number
	// Declination; absent until entered.
	readonly declination?: number
	// Name of the object or framing it came from.
	readonly label?: string
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
export const TARGET_CENTERING_STEP_LABELS: Readonly<Record<TargetCenteringStep, string>> = { stoppingGuiding: 'Stopping guiding', slewing: 'Slewing', settling: 'Settling', exposing: 'Exposing', solving: 'Solving', correcting: 'Correcting', restoringGuiding: 'Restoring guiding' }

// Returns why a mount can never move for a centering, from the state the server reports, or undefined when it can (or its
// state is not known yet). Verify Only commands nothing, so this does not concern it.
export function targetCenteringMountSupport(state: Pick<MountState, 'canGoTo' | 'canAbort'> | undefined): string | undefined {
	if (!state) return undefined
	if (!state.canGoTo) return 'The mount cannot go to a target.'
	if (!state.canAbort) return 'The mount cannot abort a motion, which a centering needs to stop safely.'
	return undefined
}

// Returns why a mode cannot start now, or undefined when it can, from the availability of the camera and of the setup's
// mount, the mount's reported state (undefined while unknown), the target, and whether the plate solver is configured. A
// mount that is not tracking is accepted when it can switch tracking, which the server starts for the session. Recenter needs
// a saved framing, which names the reference it recovers. The server checks again.
export function targetCenteringBlocker(mode: TargetCenteringMode, camera: RoleAvailability, mount: RoleAvailability, state: MountState | undefined, draft: TargetCenteringDraft | undefined, framingId: string | undefined, solverConfigured: boolean): string | undefined {
	if (camera.status !== 'ready') return camera.message
	if (mount.status !== 'ready') return mount.message
	if (!state) return 'The mount state is not known yet.'

	if (mode !== 'verifyOnly') {
		const unsupported = targetCenteringMountSupport(state)
		if (unsupported) return unsupported
		if (state.site.latitude === 0 && state.site.longitude === 0) return 'The mount reports no site; send it from Equipment Control.'
		if (state.parked || state.parking) return 'The mount is parked.'
		if (!state.tracking && !state.canTracking) return 'The mount is not tracking and cannot start tracking.'
	}

	if (mode === 'recenter' && framingId === undefined) return 'Recenter needs a saved framing: load or save one first.'
	if (draft?.rightAscension === undefined || draft.declination === undefined) return 'Enter the coordinates of the target.'
	if (!solverConfigured) return 'The plate solver is not configured.'
	return undefined
}

// Builds the start request of a mode from the form of a camera, for the mount of the Equipment Setup and the guide output
// that drives it (its GUIDE_OUTPUT, absent when it has none), whose guiding the session coordinates. The frames take the exposure time of the form
// and the camera settings of exposure, whose own exposure time is never sent, fitted to the camera's capabilities as a
// capture is, and are solved with the plate solving settings of the camera; the angles are sent in radians. Everything is
// copied, so the session never depends on the profile.
export function targetCenteringRequest(
	mode: TargetCenteringMode,
	target: { readonly rightAscension: number; readonly declination: number; readonly label?: string },
	settings: Readonly<TargetCenteringSettings>,
	exposure: Readonly<CameraExposureSettings>,
	solving: Readonly<CameraPlateSolvingSettings>,
	{ mount, guideOutput }: { readonly mount: OperationDevice; readonly guideOutput?: OperationDevice },
	capabilities?: CameraCapabilities,
): Omit<TargetCenteringRequest, 'token'> {
	const { rightAscension, declination, label } = target
	const { framingId, exposureTime, tolerance, maximumCorrections, noSolutionRetries, maximumFrames, settleDelay, maximumCorrection, blindRetry, coordinateGuiding } = settings

	return {
		mount,
		...(guideOutput && { guideOutput }),
		mode,
		target: { frame: 'J2000', rightAscension, declination, ...(label !== undefined && { label }), ...(framingId !== undefined && { framingId }) },
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

// Returns what a session measured at its latest solution against its tolerance: within, outside, or undefined before one.
export function targetCenteringVerdict({ finalSeparation, request: { tolerance } }: Pick<TargetCenteringSessionSummary, 'finalSeparation' | 'request'>): 'within' | 'outside' | undefined {
	if (finalSeparation === undefined) return undefined
	return finalSeparation <= tolerance ? 'within' : 'outside'
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
