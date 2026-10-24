import type { CameraCapabilities, CaptureSnoop, FlatWizardCaptureSettings, FlatWizardFilterState, FlatWizardRequest, FlatWizardSession, FlatWizardSessionSummary, FlatWizardSnapshot, FlatWizardState, FlatWizardVerdict, OperationDevice, ServerEvent, WheelState } from 'api'
import type { FlatDiagnosticCode } from 'nebulosa/src/imaging/analysis/flat/types'
import type { CameraCaptureTime } from 'nebulosa/src/observation/capture/types'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { deviceUrl, jsonInit, responseError } from '../http'
import type { CameraExposureSettings, FlatWizardSettings } from '../profile/schema'
import { cameraKey, fitExposure } from './capture'

// Flat Wizard sessions as this tab knows them. The server owns every session, whichever tab started it, and every
// filter change, exposure, measurement, and saved file of it, so this store only mirrors it: the summary of the latest
// session of each camera arrives with every flatWizard:updated event and, on every socket (re)open, with the snapshot;
// the complete record (the latest exposures) is fetched when a summary reports a new exposure or an end. Summaries are
// ordered by their revision, so a late event never replaces a newer state. Cameras, wheels, and panels are addressed
// by their exact connection and device ids, never by role. A start carries a token, so a retried request answers the
// session of the first one; a manual step is confirmed with the step id the server published, so a stale or repeated
// confirmation never skips a later step.

// Flat Wizard state of the tab.
export interface FlatWizardRuntime {
	// Latest session of each camera, by camera key (cameraKey).
	sessions: Record<string, FlatWizardSessionSummary>
	// Complete record of each session fetched so far, by session id.
	details: Record<string, FlatWizardSession>
	// Cameras with a command of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
}

// Flat Wizard state of the tab.
export const flatWizardRuntime = proxy<FlatWizardRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })

// Counter of snapshot refreshes; a response is applied only if no later refresh started.
let generation = 0

// Label of each session state.
export const FLAT_WIZARD_STATE_LABELS: Readonly<Record<FlatWizardState, string>> = {
	preparing: 'Preparing',
	closingCover: 'Closing the cover',
	waitingForFilter: 'Waiting for the filter',
	movingFilter: 'Moving the filter wheel',
	waitingForIllumination: 'Waiting for the light',
	settingLight: 'Setting the flat panel',
	settling: 'Letting the light settle',
	exposing: 'Exposing',
	measuring: 'Measuring',
	saving: 'Saving',
	assessingSequence: 'Assessing the sequence',
	stopping: 'Stopping',
	completed: 'Completed',
	cancelled: 'Stopped',
	failed: 'Failed',
}

// Label of each filter group state.
export const FLAT_WIZARD_FILTER_STATE_LABELS: Readonly<Record<FlatWizardFilterState, string>> = { pending: 'Pending', calibrating: 'Searching the exposure', acquiring: 'Acquiring', completed: 'Completed', failed: 'Failed', cancelled: 'Stopped' }

// Label of each frame verdict.
export const FLAT_WIZARD_VERDICT_LABELS: Readonly<Record<FlatWizardVerdict, string>> = { usable: 'Trial', clipped: 'Trial, clipped', noSignal: 'Trial, no signal', accepted: 'Accepted', rejected: 'Rejected', inconclusive: 'Inconclusive' }

// Explanation of the diagnostics the operator can act on; the others need no explanation.
export const FLAT_WIZARD_DIAGNOSTIC_LABELS: Readonly<Partial<Record<FlatDiagnosticCode, string>>> = {
	effectiveClipUnknown: 'Saturation is not proven absent: set the effective clipping level of the camera.',
	storageClipping: 'Some samples reach the limit of the file format.',
	effectiveClipping: 'Some samples reach the effective clipping level.',
	targetBelowRange: 'The level is below the target.',
	targetAboveRange: 'The level is above the target.',
	nonFiniteSamples: 'Some samples are not finite.',
	sequenceDrift: 'The light drifted across the frames.',
	sequenceVariation: 'The frames vary more than expected.',
	sequenceOutlier: 'A frame stands apart from the others.',
	sequenceMetadataUnknown: 'Missing metadata prevents proving the frames homogeneous.',
}

// Returns the progress of the frame being exposed from what the driver reports (times in microseconds, progress in
// percent), as elapsed and remaining seconds and a completed fraction in [0, 1]; undefined before the driver reported
// any, or when it reports a progress that is not finite.
export function flatWizardFrameProgress(exposure: CameraCaptureTime | undefined): { readonly elapsed: number; readonly remaining: number; readonly fraction: number } | undefined {
	if (!exposure || !Number.isFinite(exposure.progress)) return undefined
	return { elapsed: Math.max(0, exposure.elapsedTime) / 1e6, remaining: Math.max(0, exposure.remainingTime) / 1e6, fraction: Math.min(1, Math.max(0, exposure.progress / 100)) }
}

// Returns whether a session is running: it has not ended.
export function flatWizardRunning(session: Pick<FlatWizardSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// Equipment a start uses besides the camera: the setup's wheel and panel, when assigned.
export interface FlatWizardEquipment {
	// Filter wheel to move, by exact ids; absent makes every filter change manual.
	readonly wheel?: OperationDevice
	// Flat panel to light the frames, by exact ids; absent makes the light manual.
	readonly panel?: OperationDevice
	// Dust cover to close before the frames and open after them, by exact ids; absent leaves the cover as it is.
	readonly cover?: OperationDevice
}

// Returns the name of the filter at a 0-based slot, as the server names it: the name the wheel reports (names in slot
// order), or "Filter <slot + 1>" when the wheel names it not or there is no wheel.
export function flatWizardFilterName(names: readonly string[] | undefined, slot: number) {
	return names?.[slot]?.trim() || `Filter ${slot + 1}`
}

// Builds the start request of the Flat Wizard form of a camera. The frames take the camera settings of Camera
// Acquisition, fitted to the camera's capabilities as a capture is, but never its exposure time, which the wizard
// searches. Brightness is sent only with a panel.
export function flatWizardRequest(settings: Readonly<FlatWizardSettings>, exposure: Readonly<CameraExposureSettings>, { wheel, panel, cover }: FlatWizardEquipment, snoop: CaptureSnoop, capabilities?: CameraCapabilities): Omit<FlatWizardRequest, 'token'> {
	const { exposureTime: _, ...capture } = fitExposure(exposure, capabilities)
	const filters = settings.filters.map(({ brightness, ...filter }) => ({ ...filter, ...(panel && brightness !== undefined && { brightness }) }))

	return {
		capture: capture satisfies FlatWizardCaptureSettings,
		filters,
		...(wheel && { wheel }),
		...(panel && { panel }),
		...(cover && { cover }),
		settleTime: settings.settleTime,
		...(settings.directory && { directory: settings.directory }),
		...(settings.effectiveClip !== undefined && { effectiveClip: settings.effectiveClip }),
		maximumTrials: settings.maximumTrials,
		maximumRejections: settings.maximumRejections,
		snoop,
	}
}

// Returns why no session can start now, or undefined when one can, from the availability of the camera and of the
// assigned wheel, panel, and cover (absent when not assigned, so manual or left as it is), the slots and names that
// wheel reports (absent while unknown), and the form. An assigned device that cannot be used blocks the start
// instead of being replaced by a manual step. The server checks again.
export function flatWizardBlocker(camera: RoleAvailability, wheel: RoleAvailability | undefined, panel: RoleAvailability | undefined, settings: Readonly<FlatWizardSettings>, wheelState?: Pick<WheelState, 'count' | 'names'>, cover?: RoleAvailability): string | undefined {
	if (camera.status !== 'ready') return camera.message
	if (wheel && wheel.status !== 'ready') return wheel.message
	if (panel && panel.status !== 'ready') return panel.message
	if (cover && cover.status !== 'ready') return cover.message
	if (settings.filters.length === 0) return 'Add a filter.'

	for (const filter of settings.filters) {
		const name = flatWizardFilterName(wheel ? wheelState?.names : undefined, filter.slot)
		if (wheel && wheelState && filter.slot >= wheelState.count) return `The wheel has no slot ${filter.slot + 1}.`
		if (!(filter.minimumExposure > 0 && filter.minimumExposure < filter.maximumExposure)) return `The exposure range of ${name} is empty.`
		if (!(filter.targetRange[0] < filter.targetRange[1])) return `The target of ${name} is empty.`
	}

	return undefined
}

// Fetches the complete record of a session; a record older than the one known (a late response) never replaces it,
// and a session the server no longer keeps is forgotten.
export async function loadFlatWizardSession(state: FlatWizardRuntime, sessionId: string, request: typeof fetch = fetch) {
	try {
		const response = await request(`/api/flat-wizard/${encodeURIComponent(sessionId)}`)

		if (response.status === 404) {
			delete state.details[sessionId]
			return
		}

		if (!response.ok) return
		const session = (await response.json()) as FlatWizardSession
		const known = state.details[sessionId]
		if (!known || session.revision > known.revision) state.details[sessionId] = session
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Applies a Flat Wizard event; any other event is ignored. A session older than the one known for its camera, or an
// earlier revision of the same one, never replaces it. The complete record is fetched again when the summary reports
// a new exposure or the end of the session.
export function handleFlatWizardEvent(state: FlatWizardRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	if (event.type !== 'flatWizard:updated') return

	const { session } = event
	const key = cameraKey(session.camera.connectionId, session.camera.deviceId)
	const known = state.sessions[key]
	if (known && known.sessionId !== session.sessionId && known.startedAt > session.startedAt) return
	if (known?.sessionId === session.sessionId && known.revision >= session.revision) return

	state.sessions[key] = session
	if (known?.sessionId !== session.sessionId) for (const id of Object.keys(state.details)) if (id !== session.sessionId) delete state.details[id]

	const changed = known?.sessionId !== session.sessionId || known.lastAttempt?.index !== session.lastAttempt?.index || known.endedAt !== session.endedAt
	if (changed) void loadFlatWizardSession(state, session.sessionId, request)
}

// Replaces the sessions with the server's snapshot, which may have changed while the socket was closed, and fetches
// their complete records. A response is dropped when another refresh started meanwhile.
export async function refreshFlatWizard(state: FlatWizardRuntime, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/flat-wizard')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as FlatWizardSnapshot
		if (current !== generation) return

		state.sessions = {}
		for (const session of snapshot.sessions) state.sessions[cameraKey(session.camera.connectionId, session.camera.deviceId)] = session
		for (const id of Object.keys(state.details)) if (!snapshot.sessions.some((session) => session.sessionId === id)) delete state.details[id]
		for (const session of snapshot.sessions) void loadFlatWizardSession(state, session.sessionId, request)
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Sends a command of a camera and records its failure. When the server cannot be reached, the command may still have
// been applied, so the snapshot is fetched again instead of assuming nothing happened.
async function command(state: FlatWizardRuntime, key: string, url: string, body: unknown, request: typeof fetch) {
	if (state.pending[key]) return
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(url, jsonInit('POST', body))
		if (!response.ok) state.errors[key] = await responseError(response)
	} catch {
		state.errors[key] = 'Unable to reach the server.'
		await refreshFlatWizard(state, request)
	} finally {
		delete state.pending[key]
	}
}

// Starts a Flat Wizard session with a camera; progress arrives as events.
export function startFlatWizard(state: FlatWizardRuntime, connectionId: string, deviceId: string, body: Omit<FlatWizardRequest, 'token'>, request: typeof fetch = fetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'flat-wizard')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: crypto.randomUUID() } satisfies FlatWizardRequest, request)
}

// Confirms the manual step a session waits for, by the step id the session published.
export function continueFlatWizard(state: FlatWizardRuntime, session: Pick<FlatWizardSessionSummary, 'sessionId' | 'camera'>, stepId: string, request: typeof fetch = fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/flat-wizard/${encodeURIComponent(session.sessionId)}/continue`, { stepId }, request)
}

// Stops a running session; the exposure in flight is lost and the frames already saved stay.
export function stopFlatWizard(state: FlatWizardRuntime, session: Pick<FlatWizardSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/flat-wizard/${encodeURIComponent(session.sessionId)}/stop`, undefined, request)
}
