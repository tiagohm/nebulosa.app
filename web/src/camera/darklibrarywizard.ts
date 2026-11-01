import type {
	CameraCapabilities,
	CaptureSnoop,
	DarkGroup,
	DarkLibraryWizardNewRequest,
	DarkLibraryWizardPlans,
	DarkLibraryWizardRequest,
	DarkLibraryWizardResumeRequest,
	DarkLibraryWizardSession,
	DarkLibraryWizardSessionSummary,
	DarkLibraryWizardSnapshot,
	DarkLibraryWizardState,
	DarkLightSuspicion,
	DarkPlanDetail,
	DarkPlanStatus,
	DarkPlanSummary,
	OperationDevice,
	ServerEvent,
	WheelState,
} from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { deviceUrl, jsonInit, responseError } from '../http'
import { type CameraExposureSettings, DARK_LIBRARY_WIZARD_MAXIMUM_COUNT, DARK_LIBRARY_WIZARD_MAXIMUM_FRAMES, DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS, type DarkLibraryWizardSettings } from '../profile/schema'
import { cameraKey, fitExposure } from './capture'

// Dark Library Wizard sessions and plans as this tab knows them. The server owns every session, whichever tab started
// it, and every plan, so this store only mirrors them: the summary of the latest session of each camera arrives with
// every darkLibraryWizard:updated event and, on every socket (re)open, with the snapshot; the plans of a camera are
// fetched when its panel shows them and when one of its sessions ends. Summaries are ordered by their revision, so a
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
	// Plans of each camera, newest first, by camera key.
	plans: Record<string, readonly DarkPlanSummary[]>
	// Cameras with a command of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
}

// Dark Library Wizard state of the tab.
export const darkLibraryWizardRuntime = proxy<DarkLibraryWizardRuntime>({ sessions: {}, details: {}, plans: {}, pending: {}, errors: {} })

// Counter of snapshot refreshes; a response is applied only if no later refresh started.
let generation = 0

// Bytes of the header of a FITS file, the two blocks a driver usually writes.
const FITS_HEADER_SIZE = 5760

// Bytes per sample of the estimate: drivers write 16-bit integers for the sensors this estimates.
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

// Label of each plan status.
export const DARK_PLAN_STATUS_LABELS: Readonly<Record<DarkPlanStatus, string>> = { running: 'Running', paused: 'Paused', interrupted: 'Interrupted', completed: 'Completed', stopped: 'Stopped', failed: 'Failed' }

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
	// Raw size of those frames, in bytes; absent while the sensor is unknown.
	readonly bytes?: number
}

// Returns whether two groups would take the same frames.
function sameGroup(a: DarkGroup, b: DarkGroup) {
	return a.exposure === b.exposure && a.gain === b.gain && a.temperature === b.temperature
}

// Returns the groups with a copy of one of them right below it. A copy repeats its original, which blocks the start until
// one of its settings changes.
export function duplicateDarkGroup(groups: readonly DarkGroup[], index: number): DarkGroup[] {
	return groups.toSpliced(index + 1, 0, groups[index])
}

// Returns the size of the plan of a form: the frames of every group, and their exposure and raw size, which ignore
// downloads, cooling, and rejected frames. fullSensor ignores the subframe of the camera settings.
export function darkLibraryWizardEstimate({ groups, fullSensor }: Pick<DarkLibraryWizardSettings, 'groups' | 'fullSensor'>, exposure: Readonly<CameraExposureSettings>, capabilities?: CameraCapabilities): DarkLibraryWizardEstimate {
	const frames = groups.reduce((total, group) => total + group.count, 0)
	const seconds = groups.reduce((total, group) => total + group.count * group.exposure, 0)
	const sensor = capabilities?.sensor
	const subframe = !fullSensor && exposure.subframe
	const width = subframe ? exposure.width : sensor?.width
	const height = subframe ? exposure.height : sensor?.height
	if (!width || !height) return { frames, exposure: seconds }
	return { frames, exposure: seconds, bytes: frames * (FITS_HEADER_SIZE + Math.floor(width / exposure.binX) * Math.floor(height / exposure.binY) * BYTES_PER_SAMPLE) }
}

// Builds the start request of the form of a camera. Offset, binning, and readout mode come from Camera Acquisition, fitted
// to the camera's capabilities as a capture is, and its exposure time never applies. The gain of each group is fitted
// the same way. Only the devices the protection selected are sent.
export function darkLibraryWizardRequest(settings: Readonly<DarkLibraryWizardSettings>, exposure: Readonly<CameraExposureSettings>, { wheel, panel, cover }: DarkLibraryWizardEquipment, snoop: CaptureSnoop, capabilities?: CameraCapabilities): Omit<DarkLibraryWizardNewRequest, 'token'> {
	const { exposureTime: _, gain: _gain, ...fitted } = fitExposure(exposure, capabilities)
	const capture = settings.fullSensor ? { ...fitted, subframe: false, x: 0, y: 0, width: 0, height: 0 } : fitted

	return {
		capture,
		groups: settings.groups.map((group) => ({ ...group, gain: fitExposure({ ...exposure, gain: group.gain }, capabilities).gain })),
		protection: { ...(settings.useDarkFilter && { darkFilter: { slot: settings.darkSlot } }), closeCover: settings.closeCover, panelOff: settings.panelOff, manualCap: settings.manualCap, verifyFirstFrame: settings.verifyFirstFrame },
		thermal: { tolerance: settings.tolerance, hold: settings.hold, timeout: settings.timeout },
		maximumRejections: settings.maximumRejections,
		...(settings.useDarkFilter && wheel && { wheel }),
		...(settings.panelOff && panel && { panel }),
		...(settings.closeCover && cover && { cover }),
		...(settings.directory && { directory: settings.directory }),
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

// Returns the form values a plan was made with, which start a new plan.
export function darkPlanForm({ plan }: Pick<DarkPlanDetail, 'plan'>): Partial<DarkLibraryWizardSettings> {
	const { protection, thermal, groups, maximumRejections, capture, directory } = plan
	const { darkFilter, closeCover, panelOff, manualCap, verifyFirstFrame } = protection

	return {
		groups: groups.map(({ exposure, gain, temperature, count }) => ({ exposure, gain, temperature, count })),
		fullSensor: !capture.subframe,
		useDarkFilter: darkFilter !== undefined,
		...(darkFilter && { darkSlot: darkFilter.slot }),
		closeCover,
		panelOff,
		manualCap,
		verifyFirstFrame,
		tolerance: thermal.tolerance,
		hold: thermal.hold,
		timeout: thermal.timeout,
		directory,
		maximumRejections,
	}
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

// Fetches the plans of a camera. A failure keeps the plans known.
export async function loadDarkPlans(state: DarkLibraryWizardRuntime, connectionId: string, deviceId: string, request: typeof fetch = fetch) {
	try {
		const response = await request(`/api/dark-library-wizard/plans?connectionId=${encodeURIComponent(connectionId)}&deviceId=${encodeURIComponent(deviceId)}`)
		if (response.ok) state.plans[cameraKey(connectionId, deviceId)] = ((await response.json()) as DarkLibraryWizardPlans).plans
	} catch {
		// The server is unreachable; the next socket open refreshes the plans.
	}
}

// Fetches the complete record of a plan, or undefined when it cannot be read.
export async function loadDarkPlan(planId: string, request: typeof fetch = fetch): Promise<DarkPlanDetail | undefined> {
	try {
		const response = await request(`/api/dark-library-wizard/plans/${encodeURIComponent(planId)}`)
		return response.ok ? ((await response.json()) as DarkPlanDetail) : undefined
	} catch {
		return undefined
	}
}

// Applies a Dark Library Wizard event; any other event is ignored. A session older than the one known for its camera, or
// an earlier revision of the same one, never replaces it. The complete record is fetched again when the summary reports
// a new exposure or the end of the session, and the plans of the camera when it starts or ends.
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
	if (started || ended) void loadDarkPlans(state, connectionId, deviceId, request)
	if (started || ended || known?.lastAttempt?.index !== session.lastAttempt?.index) void loadDarkLibraryWizardSession(state, session.sessionId, request)
}

// Replaces the sessions with the server's snapshot, which may have changed while the socket was closed, and fetches their
// complete records and the plans of their cameras. A response is dropped when another refresh started meanwhile.
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

		for (const session of snapshot.sessions) {
			void loadDarkLibraryWizardSession(state, session.sessionId, request)
			void loadDarkPlans(state, session.camera.connectionId, session.camera.deviceId, request)
		}
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

// Sends the start of a session.
function start(state: DarkLibraryWizardRuntime, connectionId: string, deviceId: string, body: DarkLibraryWizardRequest, request: typeof fetch) {
	return command(state, cameraKey(connectionId, deviceId), deviceUrl(connectionId, 'camera', deviceId, 'dark-library-wizard'), body, request)
}

// Starts a session on a new plan; progress arrives as events.
export function startDarkLibraryWizard(state: DarkLibraryWizardRuntime, connectionId: string, deviceId: string, body: Omit<DarkLibraryWizardNewRequest, 'token'>, request: typeof fetch = fetch) {
	return start(state, connectionId, deviceId, { ...body, token: nanoid() }, request)
}

// Starts a session on the missing frames of a plan, which the server checks again before any device moves.
export function completeDarkPlan(state: DarkLibraryWizardRuntime, connectionId: string, deviceId: string, body: Omit<DarkLibraryWizardResumeRequest, 'token'>, request: typeof fetch = fetch) {
	return start(state, connectionId, deviceId, { ...body, token: nanoid() }, request)
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
