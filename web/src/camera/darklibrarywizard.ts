import type { CameraCapabilities, CaptureSnoop, DarkGroup, DarkLibraryWizardCaptureSettings, DarkLibraryWizardRequest, DarkLibraryWizardSession, DarkLibraryWizardSessionSummary, DarkLibraryWizardSnapshot, DarkLibraryWizardState, DarkLightSuspicion, OperationDevice, ServerEvent, WheelState } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { deviceUrl, jsonInit, responseError } from '../http'
import { type CameraExposureSettings, DARK_LIBRARY_WIZARD_MAXIMUM_COUNT, DARK_LIBRARY_WIZARD_MAXIMUM_FRAMES, DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS, type DarkLibraryWizardSettings } from '../profile/schema'
import { cameraKey, fitExposure } from './capture'

// Dark Library Wizard sessions as this tab knows them. The server owns every session, whichever tab started it, so this
// store only mirrors them: the summary of the latest session of each camera arrives with every darkLibraryWizard:updated
// event and, on every socket (re)open, with the snapshot. Plans are the server's record of what was acquired, which the
// Calibration Library reads; a tab neither lists nor reuses them. Summaries are ordered by their revision, so a
// late event never replaces a newer state. Devices are addressed by their exact ids, never by role. A start carries a
// token, so a retried request answers the session of the first one; a step is confirmed with the step id the server
// published, so a stale or repeated confirmation never skips a later step. Durations are seconds, temperatures degrees
// Celsius, sizes bytes.

// Dark Library Wizard state of the tab.
export interface DarkLibraryWizardRuntime {
	// Latest session of each camera, by camera key (cameraKey).
	sessions: Record<string, DarkLibraryWizardSessionSummary>
	// Complete record of each session fetched so far, by session id.
	details: Record<string, DarkLibraryWizardSession>
	// Cameras with a command of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
}

// Dark Library Wizard state of the tab.
export const darkLibraryWizardRuntime = proxy<DarkLibraryWizardRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })

// Counter of snapshot refreshes; a response is applied only if no later refresh started.
let generation = 0

// Size of a FITS block, in bytes: the header and the data of a file are each padded to a whole number of blocks.
const FITS_BLOCK_SIZE = 2880

// Blocks of the header of a frame: the most drivers usually need, and one more than the simulator writes.
const FITS_HEADER_BLOCKS = 2

// Bytes per sample of the estimate: the 16-bit integers drivers write for the sensors this estimates.
const BYTES_PER_SAMPLE = 2

// Label of each session state.
export const DARK_LIBRARY_WIZARD_STATE_LABELS: Readonly<Record<DarkLibraryWizardState, string>> = {
	preparing: 'Preparing',
	disablingPanel: 'Switching the flat panel off',
	movingDarkFilter: 'Moving to the dark filter',
	closingCover: 'Closing the cover',
	waitingForProtection: 'Waiting for the light protection',
	cooling: 'Cooling',
	stabilizing: 'Stabilizing the temperature',
	exposing: 'Exposing',
	measuring: 'Measuring',
	publishing: 'Saving',
	waitingForDecision: 'Waiting for a decision',
	paused: 'Paused, devices held',
	stopping: 'Stopping',
	restoring: 'Restoring the equipment',
	completed: 'Completed',
	cancelled: 'Stopped',
	failed: 'Failed',
}

// Explanation of each suspicion of light. None of them proves it.
export const DARK_SUSPICION_LABELS: Readonly<Record<DarkLightSuspicion, string>> = {
	saturation: 'Too much of the frame is at the clipping level for hot pixels.',
	levelExcursion: 'The level is above the frames accepted for this group.',
	structureChange: 'The spatial pattern differs from the frames accepted for this group.',
	exposureBound: 'The level is higher than a shorter exposure of this plan allows.',
}

// Returns whether a session is running: it has not ended.
export function darkLibraryWizardRunning(session: Pick<DarkLibraryWizardSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// Equipment a start can use besides the camera, by exact ids.
export interface DarkLibraryWizardEquipment {
	// Filter wheel holding the dark slot.
	readonly wheel?: OperationDevice
	// Flat panel switched off.
	readonly panel?: OperationDevice
	// Dust cover closed.
	readonly cover?: OperationDevice
}

// Availability of the assigned devices; each is absent when the setup assigns none.
export interface DarkLibraryWizardAvailability {
	// Availability of the camera.
	readonly camera: RoleAvailability
	readonly wheel?: RoleAvailability
	readonly panel?: RoleAvailability
	readonly cover?: RoleAvailability
}

// Size of the plan a form describes.
export interface DarkLibraryWizardEstimate {
	// Accepted frames of every group.
	readonly frames: number
	// Time exposing those frames, in seconds; downloads, cooling, and retries come on top.
	readonly exposure: number
	// Min/max raw size of those files, in bytes; absent while the sensor is unknown.
	readonly bytes?: readonly [min: number, max: number]
}

// Returns whether two groups would take the same frames.
function sameGroup(a: DarkGroup, b: DarkGroup) {
	return a.exposure === b.exposure && a.temperature === b.temperature
}

// Returns the groups with a copy of one of them right below it. A copy repeats its original, which blocks the start until
// one of its settings changes.
export function duplicateDarkGroup(groups: readonly DarkGroup[], index: number): DarkGroup[] {
	return groups.toSpliced(index + 1, 0, groups[index])
}

// Returns the size of a plan: the frames of every group, their exposure, and the size of their files, which ignores
// downloads, cooling, and rejected frames. A frame has the size a capture of these settings gets: the subframe when
// there is one, else the whole sensor, in unbinned pixels, each side divided by its binning and rounded up, since drivers
// round either way and an estimate of disk space must not fall short. Each file holds the padded header and data of a
// FITS image; a readout mode named RGB stores three channels.
export function darkLibraryWizardEstimate(groups: readonly DarkGroup[], capture: Readonly<DarkLibraryWizardCaptureSettings>, capabilities?: CameraCapabilities): DarkLibraryWizardEstimate {
	const frames = groups.reduce((total, group) => total + group.count, 0)
	const seconds = groups.reduce((total, group) => total + group.count * group.exposure, 0)
	const width = capture.subframe ? capture.width : capabilities?.sensor?.width
	const height = capture.subframe ? capture.height : capabilities?.sensor?.height
	if (!width || !height) return { frames, exposure: seconds }

	const data = Math.ceil(width / capture.binX) * Math.ceil(height / capture.binY) * BYTES_PER_SAMPLE
	const minBytes = frames * (FITS_HEADER_BLOCKS + Math.ceil(data / FITS_BLOCK_SIZE)) * FITS_BLOCK_SIZE
	const maxBytes = frames * (FITS_HEADER_BLOCKS + Math.ceil((data * 3) / FITS_BLOCK_SIZE)) * FITS_BLOCK_SIZE

	return { frames, exposure: seconds, bytes: [minBytes, maxBytes] }
}

// Returns the camera settings a plan takes from Camera Acquisition, fitted to the camera's capabilities as a capture is:
// everything but its exposure time, which each group sets.
export function darkLibraryWizardCapture(exposure: Readonly<CameraExposureSettings>, capabilities?: CameraCapabilities): DarkLibraryWizardCaptureSettings {
	const { exposureTime: _, ...capture } = fitExposure(exposure, capabilities)
	return capture
}

// Builds the start request of the form of a camera, with the camera settings of Camera Acquisition. Only the devices the
// protection selected are sent.
export function darkLibraryWizardRequest(settings: Readonly<DarkLibraryWizardSettings>, exposure: Readonly<CameraExposureSettings>, { wheel, panel, cover }: DarkLibraryWizardEquipment, snoop: CaptureSnoop, capabilities?: CameraCapabilities): Omit<DarkLibraryWizardRequest, 'token'> {
	return {
		capture: darkLibraryWizardCapture(exposure, capabilities),
		groups: settings.groups,
		protection: { ...(settings.useDarkFilter && { darkFilter: { slot: settings.darkSlot } }), closeCover: settings.closeCover, panelOff: settings.panelOff, manualCap: settings.manualCap, verifyFirstFrame: settings.verifyFirstFrame },
		thermal: { tolerance: settings.tolerance, hold: settings.hold, timeout: settings.timeout },
		maximumRejections: settings.maximumRejections,
		...(settings.useDarkFilter && wheel && { wheel }),
		...(settings.panelOff && panel && { panel }),
		...(settings.closeCover && cover && { cover }),
		...(settings.directory && { directory: settings.directory }),
		...(settings.purpose && { purpose: settings.purpose }),
		...(settings.generateMasters && { generateMasters: true }),
		snoop,
	}
}

// Returns why no session can start now, or undefined when one can. A selected device that cannot be used blocks the start
// instead of being replaced by a manual step, while a device nothing selected never does. The server checks again.
export function darkLibraryWizardBlocker({ camera, wheel, panel, cover }: DarkLibraryWizardAvailability, settings: Readonly<DarkLibraryWizardSettings>, wheelState?: Pick<WheelState, 'count'>, capabilities?: CameraCapabilities): string | undefined {
	if (camera.status !== 'ready') return camera.message

	const { groups, useDarkFilter, closeCover, panelOff, manualCap, darkSlot } = settings
	if (!useDarkFilter && !closeCover && !panelOff && !manualCap) return 'Select how the light is blocked.'
	if (useDarkFilter && wheel?.status !== 'ready') return wheel?.message ?? 'The setup has no filter wheel.'
	if (closeCover && cover?.status !== 'ready') return cover?.message ?? 'The setup has no cover.'
	if (panelOff && panel?.status !== 'ready') return panel?.message ?? 'The setup has no flat panel.'
	if (useDarkFilter && wheelState && darkSlot >= wheelState.count) return `The wheel has no slot ${darkSlot + 1}.`

	if (groups.length === 0) return 'Add a group of frames.'
	if (groups.length > DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS) return `A plan has at most ${DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS} groups.`
	if (groups.reduce((total, group) => total + group.count, 0) > DARK_LIBRARY_WIZARD_MAXIMUM_FRAMES) return `A plan has at most ${DARK_LIBRARY_WIZARD_MAXIMUM_FRAMES} frames.`

	const range = capabilities?.exposure

	for (let index = 0; index < groups.length; index++) {
		const group = groups[index]
		if (!(group.exposure > 0) || (range && (group.exposure < range.min || group.exposure > range.max))) return `The exposure of group ${index + 1} is outside what the camera accepts.`
		if (!(group.count >= 1 && group.count <= DARK_LIBRARY_WIZARD_MAXIMUM_COUNT)) return `Group ${index + 1} has at most ${DARK_LIBRARY_WIZARD_MAXIMUM_COUNT} frames.`
		if (group.temperature !== undefined && capabilities && !(capabilities.canSetTemperature && capabilities.temperature !== undefined)) return 'The camera cannot set and report a target temperature.'
		if (groups.findIndex((candidate) => sameGroup(candidate, group)) !== index) return `Group ${index + 1} repeats another one.`
	}

	return undefined
}

// Returns the warning shown above Start for what no device can verify, or undefined when the devices verify everything.
// Starting is the operator's assertion of it: a manual cap, the opacity of the filter at the dark slot (a slot's name
// proves nothing), and, when the panel is the only barrier, that an unlit panel really blocks the light.
export function darkLibraryWizardWarning({ manualCap, useDarkFilter, darkSlot, panelOff, closeCover }: Pick<DarkLibraryWizardSettings, 'manualCap' | 'useDarkFilter' | 'darkSlot' | 'panelOff' | 'closeCover'>): string | undefined {
	const asserted = [...(manualCap ? ['an opaque cap covers the optical path'] : []), ...(useDarkFilter ? [`the filter at slot ${darkSlot + 1} is opaque`] : []), ...(panelOff && !closeCover && !manualCap && !useDarkFilter ? ['the unlit flat panel blocks the outside light'] : [])]

	if (asserted.length === 0) return undefined
	return `Before starting, make sure that ${asserted.length === 1 ? asserted[0] : `${asserted.slice(0, -1).join(', ')} and ${asserted.at(-1)}`}.`
}

// Fetches the complete record of a session; a record older than the one known (a late response) never replaces it, and a
// session the server no longer keeps is forgotten.
export async function loadDarkLibraryWizardSession(state: DarkLibraryWizardRuntime, sessionId: string, request: typeof fetch = fetch) {
	try {
		const response = await request(`/api/dark-library-wizard/${encodeURIComponent(sessionId)}`)

		if (response.status === 404) {
			delete state.details[sessionId]
			return
		}

		if (!response.ok) return
		const session = (await response.json()) as DarkLibraryWizardSession
		const known = state.details[sessionId]
		if (!known || session.revision > known.revision) state.details[sessionId] = session
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Applies a Dark Library Wizard event; any other event is ignored. A session older than the one known for its camera, or
// an earlier revision of the same one, never replaces it. The complete record is fetched again when the summary reports
// a new exposure, a new session, or its end.
export function handleDarkLibraryWizardEvent(state: DarkLibraryWizardRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	if (event.type !== 'darkLibraryWizard:updated') return

	const { session } = event
	const { connectionId, deviceId } = session.camera
	const key = cameraKey(connectionId, deviceId)
	const known = state.sessions[key]
	if (known && known.sessionId !== session.sessionId && known.startedAt > session.startedAt) return
	if (known?.sessionId === session.sessionId && known.revision >= session.revision) return

	state.sessions[key] = session
	if (known?.sessionId !== session.sessionId) for (const id of Object.keys(state.details)) if (id !== session.sessionId) delete state.details[id]

	const started = known?.sessionId !== session.sessionId
	const ended = known?.endedAt !== session.endedAt
	if (started || ended || known?.lastAttempt?.index !== session.lastAttempt?.index) void loadDarkLibraryWizardSession(state, session.sessionId, request)
}

// Replaces the sessions with the server's snapshot, which may have changed while the socket was closed, and fetches their
// complete records. A response is dropped when another refresh started meanwhile.
export async function refreshDarkLibraryWizard(state: DarkLibraryWizardRuntime, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/dark-library-wizard')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as DarkLibraryWizardSnapshot
		if (current !== generation) return

		state.sessions = {}
		for (const session of snapshot.sessions) state.sessions[cameraKey(session.camera.connectionId, session.camera.deviceId)] = session
		for (const id of Object.keys(state.details)) if (!snapshot.sessions.some((session) => session.sessionId === id)) delete state.details[id]

		for (const session of snapshot.sessions) void loadDarkLibraryWizardSession(state, session.sessionId, request)
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Sends a command of a camera and records its failure. When the server cannot be reached, the command may still have been
// applied, so the snapshot is fetched again instead of assuming nothing happened.
async function command(state: DarkLibraryWizardRuntime, key: string, url: string, body: unknown, request: typeof fetch) {
	if (state.pending[key]) return
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(url, jsonInit('POST', body))
		if (!response.ok) state.errors[key] = await responseError(response)
	} catch {
		state.errors[key] = 'Unable to reach the server.'
		await refreshDarkLibraryWizard(state, request)
	} finally {
		delete state.pending[key]
	}
}

// Starts a session on a new plan; progress arrives as events.
export function startDarkLibraryWizard(state: DarkLibraryWizardRuntime, connectionId: string, deviceId: string, body: Omit<DarkLibraryWizardRequest, 'token'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(connectionId, deviceId), deviceUrl(connectionId, 'camera', deviceId, 'dark-library-wizard'), { ...body, token: nanoid() } satisfies DarkLibraryWizardRequest, request)
}

// Sends a command of a session.
function sessionCommand(state: DarkLibraryWizardRuntime, session: Pick<DarkLibraryWizardSessionSummary, 'sessionId' | 'camera'>, action: string, body: unknown, request: typeof fetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/dark-library-wizard/${encodeURIComponent(session.sessionId)}/${action}`, body, request)
}

// Confirms the step a session waits for, by the step id the session published.
export function continueDarkLibraryWizard(state: DarkLibraryWizardRuntime, session: Pick<DarkLibraryWizardSessionSummary, 'sessionId' | 'camera'>, stepId: string, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'continue', { stepId }, request)
}

// Pauses a session after the current frame; its devices stay held.
export function pauseDarkLibraryWizard(state: DarkLibraryWizardRuntime, session: Pick<DarkLibraryWizardSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'pause', undefined, request)
}

// Resumes a paused session, after the server checked the protection and the temperature again.
export function resumeDarkLibraryWizard(state: DarkLibraryWizardRuntime, session: Pick<DarkLibraryWizardSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'resume', undefined, request)
}

// Stops a running session; the exposure in flight is lost and the frames already saved stay.
export function stopDarkLibraryWizard(state: DarkLibraryWizardRuntime, session: Pick<DarkLibraryWizardSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return sessionCommand(state, session, 'stop', undefined, request)
}
