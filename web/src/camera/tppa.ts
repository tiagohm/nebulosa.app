import type { CameraCapabilities, MountState, ServerEvent, TppaAlignment, TppaAltitudeCorrection, TppaAttempt, TppaAzimuthCorrection, TppaOverlay, TppaRequest, TppaSession, TppaSessionSummary, TppaState } from 'api'
import { nanoid } from 'nanoid'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { arcmin } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { formatArcmin } from '../format'
import { type ApiFetch, browserFetch, deviceUrl, jsonInit } from '../http'
import type { CameraExposureSettings, CameraPlateSolvingSettings, TppaSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'
import { cameraKey, fitExposure } from './capture'
import { applySession, type CameraSessionKind, type CameraSessionRecords, refreshSessionRecords, sendSessionCommand } from './sessions'

// TPPA sessions as this tab knows them. The server owns every session, whichever tab started it, and every motion,
// exposure, and solve of it, so this store only mirrors it: the compact summary of the latest session of each camera
// arrives with every tppa:updated event and, on every socket (re)open, with the snapshot; the complete record (poses,
// attempts, the initial estimate, and the overlay of the latest frame) is fetched when a summary reports a new frame,
// pose, estimate, or an end. Summaries are ordered by their revision, so a late event never replaces a newer state.
// Cameras and mounts are addressed by their exact connection and device ids, never by role. A start carries a token,
// so a retried request answers the session of the first one instead of starting another.

// TPPA state of the tab.
export type TppaRuntime = CameraSessionRecords<TppaSessionSummary, TppaSession>

// TPPA state of the tab.
export const tppaRuntime = proxy<TppaRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })

// How the sessions are mirrored (sessions.ts): the complete record is fetched again when the summary reports
// a new frame, pose, or estimate, or an end.
const TPPA_SESSIONS: CameraSessionKind<TppaSessionSummary, TppaSession> = {
	url: '/api/tppa',
	refreshes: new SnapshotRefreshes(),
	stale: (session, _, details) => !details || details.frameCount !== session.frameCount || details.pointCount !== session.pointCount || details.alignment?.frame !== session.alignment?.frame || details.refinementCount !== session.refinementCount || (session.endedAt !== undefined && details.endedAt === undefined),
}

// Label of each session state.
export const TPPA_STATE_LABELS: Readonly<Record<TppaState, string>> = {
	preparing: 'Preparing',
	moving: 'Rotating in RA',
	capturing: 'Exposing',
	solving: 'Solving',
	readyToRefine: 'Ready to Refine',
	refining: 'Refining',
	refinementPaused: 'Refinement Paused',
	stopping: 'Stopping…',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Stopped',
}

// Polar error at or below which the panel and the correction guide say the mount is aligned, in radians (1
// arcminute): the error that keeps field rotation and declination drift negligible over a long exposure at the focal
// lengths of most imaging rigs. It names a result; the session keeps refining below it.
export const TPPA_ALIGNED_ERROR = arcmin(1)

// Angular distance from the celestial pole under which the toolkit refuses the first point, in radians: 10°, the
// minimumPolarDistance of its DEFAULT_POLAR_ALIGNMENT_GEOMETRY_LIMITS.
export const TPPA_MINIMUM_POLAR_DISTANCE = 10 * DEG2RAD

// Verb of each way the mount pole moves in azimuth, said before the amount.
export const TPPA_AZIMUTH_CORRECTION_LABELS: Readonly<Record<TppaAzimuthCorrection, string>> = { east: 'Move east', west: 'Move west' }

// Verb of each way the mount pole moves in altitude, said before the amount.
export const TPPA_ALTITUDE_CORRECTION_LABELS: Readonly<Record<TppaAltitudeCorrection, string>> = { raise: 'Raise', lower: 'Lower' }

// What happened to a candidate of the second or third point that was not accepted, said after its rotation.
export const TPPA_REJECTION_LABELS: Readonly<Record<NonNullable<TppaAttempt['reason']>, string>> = {
	nearPole: 'too close to the celestial pole',
	insufficientRotation: 'not far enough, moving further',
	insufficientSeparation: 'too close to the previous point, moving further',
	reversedRotation: 'moved against the RA direction',
	excessiveRotation: 'rotated too far',
	declinationChanged: 'the declination changed',
	collinear: 'the points lie on a line',
}

// Why the correction guide could not be drawn over a frame, with what to do when the operator can act.
export const TPPA_OVERLAY_FAILURE_LABELS: Readonly<Record<NonNullable<TppaOverlay['failure']>, string>> = {
	invalidOptions: 'its options are invalid',
	invalidFrame: 'the frame has no usable size',
	invalidWcs: 'the plate solution of the frame cannot be used',
	missingLocation: 'the mount reports no site; send it from Equipment Control',
	invalidPole: 'the mount pole could not be placed on the sky',
	invalidReference: 'the reference star could not be placed on the sky',
	unprojectableReference: 'the reference star cannot be placed on the frame',
	unprojectableTarget: 'the target cannot be placed on the frame',
	degenerateCorrection: 'the correction is undefined for this field',
}

// What each warning of the correction guide means for the operator.
export const TPPA_OVERLAY_WARNING_LABELS: Readonly<Record<NonNullable<TppaOverlay['geometry']>['diagnostics']['warnings'][number], string>> = {
	correctionNotConverged: 'the correction is approximate; follow the numbers of the panel',
	correctionIllConditioned: 'the correction is poorly defined in this field; follow the numbers of the panel',
	referenceOutsideFrame: 'the star is outside the frame; follow its arrow',
	contourOmitted: 'some error rings fall outside the frame',
	contourIllConditioned: 'some error rings are approximate',
}

// Returns the moves that remove the polar error of an estimate, in words with their size: "Move west 1.0′", "Lower
// 0.4′", or "No move" when the error rounds to 0.0′. The way is the server's (TppaAlignment), never derived here from
// the signs.
export function tppaCorrectionText(alignment: Pick<TppaAlignment, 'azimuthError' | 'altitudeError' | 'azimuthCorrection' | 'altitudeCorrection'>): { readonly azimuth: string; readonly altitude: string } {
	return { azimuth: moveText(TPPA_AZIMUTH_CORRECTION_LABELS[alignment.azimuthCorrection], alignment.azimuthError), altitude: moveText(TPPA_ALTITUDE_CORRECTION_LABELS[alignment.altitudeCorrection], alignment.altitudeError) }
}

// Returns a move of the pole by the size of an error (radians) after its verb, or "No move" when it rounds to 0.0′.
function moveText(verb: string, error: number) {
	const size = formatArcmin(Math.abs(error))
	return size === formatArcmin(0) ? 'No move' : `${verb} ${size}`
}

// Returns whether a polar error, in radians, is within TPPA_ALIGNED_ERROR.
export function tppaAligned(totalError: number): boolean {
	return totalError <= TPPA_ALIGNED_ERROR
}

// Returns whether the mount reports pointing nearer the celestial pole than the toolkit accepts for the first point,
// from its declination of date (radians); false while its state is unknown.
export function tppaNearPole(state: Pick<MountState, 'declination'> | undefined): boolean {
	return state !== undefined && Math.PI / 2 - Math.abs(state.declination) < TPPA_MINIMUM_POLAR_DISTANCE
}

// Returns the one-line summary of a session beside its collapsed section: its state, and the polar error once
// estimated or the point being acquired.
export function tppaSummaryText(session: Pick<TppaSessionSummary, 'state' | 'alignment' | 'point' | 'endedAt'>): string {
	const state = TPPA_STATE_LABELS[session.state]
	if (session.alignment) return `${state} · ${formatArcmin(session.alignment.totalError)}`
	return session.point && tppaRunning(session) ? `${state} · point ${session.point}/3` : state
}

// Label of each RA direction.
export const TPPA_DIRECTION_LABELS: Readonly<Record<TppaSettings['direction'], string>> = { WEST: 'West', EAST: 'East' }

// RA directions, in selector order.
export const TPPA_DIRECTIONS = Object.keys(TPPA_DIRECTION_LABELS) as TppaSettings['direction'][]

// Returns why the mount can never run a TPPA, from the state the server reports, or undefined when it can (or its
// state is not known yet): an alt-az mount, no west-east motion, no abort, or no slew-rate preset to choose.
export function tppaMountSupport(state: Pick<MountState, 'mountType' | 'canMove' | 'canMoveWE' | 'canAbort' | 'slewRates'> | undefined): string | undefined {
	if (!state) return undefined
	if (state.mountType === 'ALTAZ') return 'The mount is not equatorial; TPPA aligns the polar axis of an equatorial mount.'
	if (!state.canMove || !state.canMoveWE) return 'The mount cannot move west-east, which the TPPA needs.'
	if (!state.canAbort) return 'The mount cannot abort a motion, which the TPPA needs to stop safely.'
	if (state.slewRates.length === 0) return 'The mount offers no slew rate to choose.'
	return undefined
}

// Returns why no session can start now, or undefined when one can, from the availability of the camera and of the
// setup's mount (unsupported per tppaMountSupport), the mount's reported state (undefined while unknown), the slew
// rate a start would send (tppaSlewRate). A mount that is not tracking is accepted when it can switch tracking, which the server starts for the session. The server checks again.
export function tppaBlocker(camera: RoleAvailability, mount: RoleAvailability, state: MountState | undefined, slewRate: string | undefined): string | undefined {
	if (camera.status !== 'ready') return camera.message
	if (mount.status !== 'ready') return mount.message
	if (!state) return 'The mount state is not known yet.'
	if (slewRate === undefined || !state.slewRates.some((rate) => rate.name === slewRate)) return 'Choose a slew rate.'
	if (state.site.latitude === 0 && state.site.longitude === 0) return 'The mount reports no site; send it from Equipment Control.'
	if (state.parked || state.parking) return 'The mount is parked.'
	if (!state.tracking && !state.canTracking) return 'The mount is not tracking and cannot start tracking.'
	return undefined
}

// Returns the slew rate a start sends: the form's when the mount still announces it, else the preset the mount uses
// now, else undefined, so a preset of another mount or one the driver dropped is never sent.
export function tppaSlewRate(settings: Pick<TppaSettings, 'slewRate'>, state: Pick<MountState, 'slewRates' | 'slewRate'> | undefined): string | undefined {
	const announced = (name: string | undefined) => name !== undefined && state?.slewRates.some((rate) => rate.name === name) === true
	return announced(settings.slewRate) ? settings.slewRate : announced(state?.slewRate) ? state?.slewRate : undefined
}

// Builds the start request of the TPPA form of a camera for a mount and slew rate. The frames take the exposure time
// of the form and the camera settings of exposure, whose own exposure time is never sent, fitted to the camera's
// capabilities as a capture is, and are solved with the plate solving settings of the camera; the rotation is sent in
// radians.
export function tppaRequest(settings: Readonly<TppaSettings>, exposure: Readonly<CameraExposureSettings>, solving: Readonly<CameraPlateSolvingSettings>, mount: { readonly connectionId: string; readonly deviceId: string }, slewRate: string, capabilities?: CameraCapabilities): Omit<TppaRequest, 'token'> {
	return {
		mount,
		capture: fitExposure({ ...exposure, exposureTime: settings.exposureTime }, capabilities),
		solving: { ...solving },
		direction: settings.direction,
		slewRate,
		rotation: settings.rotation * DEG2RAD,
		settleDelay: settings.settleDelay,
		refinementDelay: settings.refinementDelay,
		stopTracking: settings.stopTracking,
	}
}

// Returns whether a session is still running.
export function tppaRunning(session: Pick<TppaSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// Role of a TPPA frame in its session.
export interface TppaFrameRole {
	// Pose the frame became, when accepted.
	readonly point?: 1 | 2 | 3
	// Whether the frame was a candidate of a pose that was not accepted.
	readonly rejected: boolean
	// Whether the frame belongs to the refinement.
	readonly refinement: boolean
}

// Returns what a frame of a session (by its session id and frame number) was in the session's record: a pose, a
// rejected candidate, or a refinement frame; undefined for a frame of another session or one not recorded yet.
export function tppaFrameRole(session: Pick<TppaSession, 'sessionId' | 'points' | 'attempts' | 'initialAlignment'> | undefined, frame: { readonly sessionId: string; readonly generation: number }): TppaFrameRole | undefined {
	if (!session || session.sessionId !== frame.sessionId) return undefined
	const pose = session.points.find((p) => p.frame === frame.generation)
	if (pose) return { point: pose.point, rejected: false, refinement: false }
	if (session.attempts.some((a) => a.frame === frame.generation)) return { rejected: true, refinement: false }
	if (session.initialAlignment && frame.generation > session.initialAlignment.frame) return { rejected: false, refinement: true }
	return undefined
}

// Applies a TPPA event (applySession); any other event is ignored.
export function handleTppaEvent(state: TppaRuntime, event: ServerEvent, request: ApiFetch = browserFetch) {
	if (event.type === 'tppa:updated') applySession(state, TPPA_SESSIONS, event.session, request)
}

// Replaces the sessions with the server's snapshot and fetches their complete records (refreshSessionRecords).
export function refreshTppa(state: TppaRuntime, request: ApiFetch = browserFetch) {
	return refreshSessionRecords(state, TPPA_SESSIONS, request)
}

// Sends a command of a camera (sendSessionCommand).
function command(state: TppaRuntime, key: string, url: string, body: unknown, request: ApiFetch) {
	return sendSessionCommand(state, key, url, jsonInit('POST', body), () => refreshTppa(state, request), request)
}

// Starts a TPPA with a camera; its progress arrives as events.
export function startTppa(state: TppaRuntime, connectionId: string, deviceId: string, body: Omit<TppaRequest, 'token'>, request: ApiFetch = browserFetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'tppa')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: nanoid() } satisfies TppaRequest, request)
}

// Stops the session of a camera; the server stops the mount and restores its slew rate when it can.
export function stopTppa(state: TppaRuntime, session: Pick<TppaSessionSummary, 'sessionId' | 'camera'>, request: ApiFetch = browserFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/tppa/${encodeURIComponent(session.sessionId)}/stop`, undefined, request)
}

// Starts or resumes the refinement of a session that has an estimate.
export function startTppaRefinement(state: TppaRuntime, session: Pick<TppaSessionSummary, 'sessionId' | 'camera'>, request: ApiFetch = browserFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/tppa/${encodeURIComponent(session.sessionId)}/refinement/start`, undefined, request)
}

// Pauses the refinement of a session; its devices stay held.
export function stopTppaRefinement(state: TppaRuntime, session: Pick<TppaSessionSummary, 'sessionId' | 'camera'>, request: ApiFetch = browserFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/tppa/${encodeURIComponent(session.sessionId)}/refinement/stop`, undefined, request)
}
