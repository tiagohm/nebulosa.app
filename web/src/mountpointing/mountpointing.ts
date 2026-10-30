// oxfmt-ignore
import type { CameraCapabilities, MountPointingVerifyRequest, PointingActivateRequest, PointingActivation, PointingActivationsSnapshot, MountPointingRequest, MountPointingSessionSummary, MountPointingSnapshot, MountPointingState, MountPointingStep, MountState, PointingFitModelRequest, PointingFitState, PointingModelDetail, PointingModelEvent, PointingModelExport, PointingModelPatch, PointingModelsSnapshot, PointingModelSummary, ServerEvent, UnavailablePointingModel } from 'api'
import { nanoid } from 'nanoid'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import type { PointingPlan } from 'nebulosa/src/observation/mount/pointing.plan'
import { proxy } from 'valtio'
import { cameraKey, fitExposure } from '../camera/capture'
import type { RoleAvailability } from '../equipment/availability'
import type { CameraRole } from '../equipment/roles'
import { deviceUrl, jsonInit, responseError } from '../http'
import type { CameraExposureSettings, CameraPlateSolvingSettings, PointingModelSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'

// Mount pointing models as this tab knows them. The server owns every model, fit, and activation, so this store only
// mirrors them: the summary of every model arrives with the mountPointing events and, on every socket (re)open, with the
// snapshot; the samples and revisions of a model are fetched when it is opened, and again when its file changes. Events
// carry a sequence and a refresh leaves what an event changed meanwhile, so a late snapshot never takes a model back, and
// nothing here decides whether a model is valid or active. The revision of the file goes with every edit, so the server
// refuses an edit made from an outdated model instead of losing another tab's.

// Mount pointing state of the tab.
export interface MountPointingRuntime {
	// Summary of every usable model, by model id.
	models: Record<string, PointingModelSummary>
	// Files that cannot be used.
	unavailable: readonly UnavailablePointingModel[]
	// Fits running or failed, by model id.
	fits: Record<string, PointingFitState>
	// Complete record of the models opened, by model id.
	details: Record<string, PointingModelDetail>
	// Model in force on each mount, by hardware id.
	activations: Record<string, PointingActivation>
	// Sequence of the latest activation event applied.
	activationSequence: number
	// Latest session of each camera, by camera key (cameraKey).
	sessions: Record<string, MountPointingSessionSummary>
	// Plan a camera previewed last, by camera key.
	plans: Record<string, PointingPlan>
	// Model the Tools page shows, which Images can hand over.
	selectedModelId?: string
	// Sequence of the latest event applied.
	sequence: number
	// Models and cameras with a command of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command on a model or camera failed, by its key; cleared by its next command.
	errors: Record<string, string>
}

// Mount pointing state of the tab.
export const mountPointingRuntime = proxy<MountPointingRuntime>({ models: {}, unavailable: [], fits: {}, details: {}, activations: {}, activationSequence: 0, sessions: {}, plans: {}, sequence: 0, pending: {}, errors: {} })

// Refreshes of the models, ordered against the events applied meanwhile.
const refreshes = new SnapshotRefreshes()

// Refreshes of the sessions, ordered against the events applied meanwhile.
const sessionRefreshes = new SnapshotRefreshes()

// Label of each session state.
export const MOUNT_POINTING_STATE_LABELS: Readonly<Record<MountPointingState, string>> = {
	preparing: 'Preparing',
	running: 'Running',
	pausing: 'Pausing…',
	paused: 'Paused',
	stopping: 'Stopping…',
	blocked: 'Mount Not Confirmed Stopped',
	completed: 'Completed',
	stopped: 'Stopped',
}

// Label of each step of a waypoint.
export const MOUNT_POINTING_STEP_LABELS: Readonly<Record<MountPointingStep, string>> = { checking: 'Checking', slewing: 'Slewing', settling: 'Settling', exposing: 'Exposing', solving: 'Solving' }

// Returns why the mount can never be sampled, from the state the server reports, or undefined when it can (or its state
// is not known yet): an alt-az mount, no GoTo, or no abort. A mount that does not report its type asks the operator.
export function mountPointingMountSupport(state: Pick<MountState, 'mountType' | 'canGoTo' | 'canAbort'> | undefined): string | undefined {
	if (!state) return undefined
	if (state.mountType === 'ALTAZ') return 'The mount is not equatorial; alt-az mounts are not supported.'
	if (!state.canGoTo) return 'The mount cannot go to a target.'
	if (!state.canAbort) return 'The mount cannot abort a motion, which a session needs to stop safely.'
	return undefined
}

// Returns why no session can start now, or undefined when one can, from the availability of the camera and of the setup's
// mount (unsupported per mountPointingMountSupport), the role of the camera, the mount's reported state (undefined while
// unknown), whether the plate solver is configured, and whether the geometry of the mount is known or confirmed. A mount
// that is not tracking is accepted when it can switch tracking, which the server starts. The server checks again.
export function mountPointingBlocker(camera: RoleAvailability, mount: RoleAvailability, role: CameraRole | undefined, state: MountState | undefined, solverConfigured: boolean, equatorial: boolean): string | undefined {
	if (role !== 'MAIN_CAMERA') return 'Assign this camera as the Main Camera, so the model belongs to one optical train.'
	if (camera.status !== 'ready') return camera.message
	if (mount.status !== 'ready') return mount.message
	if (!state) return 'The mount state is not known yet.'
	if (state.site.latitude === 0 && state.site.longitude === 0) return 'The mount reports no site; send it from Equipment Control.'
	if (state.parked || state.parking) return 'The mount is parked.'
	if (!state.tracking && !state.canTracking) return 'The mount is not tracking and cannot start tracking.'
	if (!solverConfigured) return 'The plate solver is not configured.'
	if (!equatorial) return 'The mount does not report its type; confirm that it is equatorial.'
	return undefined
}

// Returns the sky of a form, with angles in radians.
function planRequest({ pattern, count, minimumAltitude, meridianAvoidance }: Readonly<PointingModelSettings>): MountPointingRequest['plan'] {
	return { pattern, count, minimumAltitude: minimumAltitude * DEG2RAD, meridianAvoidance: meridianAvoidance * DEG2RAD }
}

// Builds the start request of the Pointing Model Builder form of a camera. The frames take the exposure time of the form
// and the camera settings of exposure, whose own exposure time is never sent, fitted to the camera's capabilities, and
// are solved with the plate solving settings of the camera.
export function mountPointingRequest(
	settings: Readonly<PointingModelSettings>,
	exposure: Readonly<CameraExposureSettings>,
	solving: Readonly<CameraPlateSolvingSettings>,
	mount: { readonly connectionId: string; readonly deviceId: string },
	equatorialConfirmed: boolean,
	capabilities?: CameraCapabilities,
): Omit<MountPointingRequest, 'token'> {
	return {
		mount,
		capture: fitExposure({ ...exposure, exposureTime: settings.exposureTime }, capabilities),
		solving: { ...solving },
		plan: planRequest(settings),
		settleDelay: settings.settleDelay,
		stopTracking: settings.stopTracking,
		equatorialConfirmed,
	}
}

// Targets a verification tests.
const VERIFICATION_TARGETS = 6

// Builds the request of a verification of a revision with the Pointing Model Builder form of a camera.
export function mountPointingVerifyRequest(
	revisionId: string,
	camera: { readonly connectionId: string; readonly deviceId: string },
	settings: Readonly<PointingModelSettings>,
	exposure: Readonly<CameraExposureSettings>,
	solving: Readonly<CameraPlateSolvingSettings>,
	mount: { readonly connectionId: string; readonly deviceId: string },
	capabilities?: CameraCapabilities,
): Omit<MountPointingVerifyRequest, 'token'> {
	return { revisionId, camera, mount, capture: fitExposure({ ...exposure, exposureTime: settings.exposureTime }, capabilities), solving: { ...solving }, settleDelay: settings.settleDelay, count: VERIFICATION_TARGETS }
}

// Returns whether a session has not ended, so its camera cannot start another.
export function mountPointingRunning(session: Pick<MountPointingSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// URL of a model, or of one of its routes when action names it.
function modelUrl(modelId: string, action?: string) {
	const url = `/api/mount-pointing/models/${encodeURIComponent(modelId)}`
	return action ? `${url}/${action}` : url
}

// Fetches the samples and revisions of a model; a record older than the one known (a late response) never replaces it,
// and a model the server no longer keeps is forgotten.
export async function loadPointingModel(state: MountPointingRuntime, modelId: string, request: typeof fetch = fetch) {
	try {
		const response = await request(modelUrl(modelId))

		if (response.status === 404) {
			delete state.details[modelId]
			return
		}

		if (!response.ok) return
		const model = (await response.json()) as PointingModelDetail
		const known = state.details[modelId]
		if (!known || model.revision >= known.revision) state.details[modelId] = model
	} catch {
		// The server is unreachable; the next socket open refreshes the models.
	}
}

// Applies a model event.
function applyModelEvent(state: MountPointingRuntime, event: PointingModelEvent, request: typeof fetch) {
	if (event.sequence <= state.sequence) return
	state.sequence = event.sequence

	if (event.type === 'mountPointing:modelRemoved') {
		refreshes.updated(event.modelId)
		delete state.models[event.modelId]
		delete state.fits[event.modelId]
		delete state.details[event.modelId]
		if (state.selectedModelId === event.modelId) state.selectedModelId = undefined
		return
	}

	const { model, fit } = event
	refreshes.updated(model.modelId)
	state.models[model.modelId] = model

	if (fit.running || fit.error !== undefined) state.fits[model.modelId] = fit
	else delete state.fits[model.modelId]

	const known = state.details[model.modelId]
	if (known && known.revision !== model.revision) void loadPointingModel(state, model.modelId, request)
}

// Applies a session event. A session older than the one known for its camera, or an earlier revision of the same one,
// never replaces it.
function applySessionEvent(state: MountPointingRuntime, session: MountPointingSessionSummary) {
	const key = cameraKey(session.camera.connectionId, session.camera.deviceId)
	const known = state.sessions[key]
	if (known && known.sessionId !== session.sessionId && known.startedAt > session.startedAt) return
	if (known?.sessionId === session.sessionId && known.revision >= session.revision) return
	sessionRefreshes.updated(key)
	state.sessions[key] = session
}

// Applies an activation event; an older one is dropped. The sequence is the server's, so a restart that starts it over is
// followed by the snapshot of the reconnection, which replaces everything.
function applyActivationEvent(state: MountPointingRuntime, { hardwareId, activation, sequence }: Extract<ServerEvent, { readonly type: 'mountPointing:activation' }>) {
	if (sequence <= state.activationSequence) return
	state.activationSequence = sequence
	if (activation) state.activations[hardwareId] = activation
	else delete state.activations[hardwareId]
}

// Applies a mount pointing event; any other event is ignored.
export function handleMountPointingEvent(state: MountPointingRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	if (event.type === 'mountPointing:updated') applySessionEvent(state, event.session)
	else if (event.type === 'mountPointing:activation') applyActivationEvent(state, event)
	else if (event.type === 'mountPointing:modelUpdated' || event.type === 'mountPointing:modelRemoved') applyModelEvent(state, event, request)
}

// Replaces the models with the server's snapshot, which may have changed while the socket was closed, and fetches the
// complete records already open. A model an event changed during the request is left as the event set it, and a response
// is dropped when another refresh started meanwhile.
export async function refreshMountPointing(state: MountPointingRuntime, request: typeof fetch = fetch) {
	await Promise.all([refreshModels(state, request), refreshSessions(state, request), refreshActivations(state, request)])
}

// Replaces the models in force with the server's, which holds none after a restart. A snapshot older than an event applied
// meanwhile is dropped.
async function refreshActivations(state: MountPointingRuntime, request: typeof fetch) {
	const started = state.activationSequence

	try {
		const response = await request('/api/mount-pointing/activations')
		if (!response.ok) return
		const { activations, sequence } = (await response.json()) as PointingActivationsSnapshot
		if (state.activationSequence !== started) return
		state.activations = Object.fromEntries(activations.map((activation) => [activation.hardwareId, activation]))
		state.activationSequence = sequence
	} catch {
		// The server is unreachable; the next socket open refreshes the models in force.
	}
}

// Replaces the sessions with the server's snapshot, leaving what an event changed during the request.
async function refreshSessions(state: MountPointingRuntime, request: typeof fetch) {
	const token = sessionRefreshes.start()

	try {
		const response = await request('/api/mount-pointing/sessions')
		if (!response.ok || !sessionRefreshes.current(token)) return
		const { sessions } = (await response.json()) as MountPointingSnapshot
		if (!sessionRefreshes.current(token)) return

		for (const key of Object.keys(state.sessions)) if (!sessionRefreshes.changed(key)) delete state.sessions[key]

		for (const session of sessions) {
			const key = cameraKey(session.camera.connectionId, session.camera.deviceId)
			if (!sessionRefreshes.changed(key)) state.sessions[key] = session
		}
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	} finally {
		sessionRefreshes.end(token)
	}
}

// Replaces the models with the server's snapshot.
async function refreshModels(state: MountPointingRuntime, request: typeof fetch) {
	const token = refreshes.start()

	try {
		const response = await request('/api/mount-pointing/models')
		if (!response.ok || !refreshes.current(token)) return
		const snapshot = (await response.json()) as PointingModelsSnapshot
		if (!refreshes.current(token)) return

		for (const modelId of Object.keys(state.models)) {
			if (refreshes.changed(modelId)) continue
			delete state.models[modelId]
			delete state.fits[modelId]
		}

		for (const model of snapshot.models) if (!refreshes.changed(model.modelId)) state.models[model.modelId] = model
		for (const [modelId, fit] of Object.entries(snapshot.fits)) if (!refreshes.changed(modelId)) state.fits[modelId] = fit

		state.unavailable = snapshot.unavailable
		state.sequence = Math.max(state.sequence, snapshot.sequence)
		for (const modelId of Object.keys(state.details)) void loadPointingModel(state, modelId, request)
	} catch {
		// The server is unreachable; the next socket open refreshes the models.
	} finally {
		refreshes.end(token)
	}
}

// Sends a command on a model and records its failure. When the server cannot be reached, the command may still have been
// applied, so the snapshot is fetched again instead of assuming nothing happened.
async function command(state: MountPointingRuntime, modelId: string, url: string, init: RequestInit, request: typeof fetch) {
	if (state.pending[modelId]) return
	state.pending[modelId] = true
	delete state.errors[modelId]

	try {
		const response = await request(url, init)
		if (!response.ok) state.errors[modelId] = await responseError(response)
	} catch {
		state.errors[modelId] = 'Unable to reach the server.'
		await refreshMountPointing(state, request)
	} finally {
		delete state.pending[modelId]
	}
}

// Starts a pointing session with a camera; its progress arrives as events.
export function startMountPointing(state: MountPointingRuntime, connectionId: string, deviceId: string, body: Omit<MountPointingRequest, 'token'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(connectionId, deviceId), deviceUrl(connectionId, 'camera', deviceId, 'mount-pointing'), jsonInit('POST', { ...body, token: nanoid() } satisfies MountPointingRequest), request)
}

// URL of a route of a session.
function sessionUrl(sessionId: string, action: string) {
	return `/api/mount-pointing/sessions/${encodeURIComponent(sessionId)}/${action}`
}

// Pauses a session, releasing its devices.
export function pauseMountPointing(state: MountPointingRuntime, { sessionId, camera }: Pick<MountPointingSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(camera.connectionId, camera.deviceId), sessionUrl(sessionId, 'pause'), jsonInit('POST'), request)
}

// Resumes a paused session in a new operation; the token keeps a retried request from resuming it twice.
export function resumeMountPointing(state: MountPointingRuntime, { sessionId, camera }: Pick<MountPointingSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(camera.connectionId, camera.deviceId), sessionUrl(sessionId, 'resume'), jsonInit('POST', { token: nanoid() }), request)
}

// Ends a session, keeping its samples.
export function stopMountPointing(state: MountPointingRuntime, { sessionId, camera }: Pick<MountPointingSessionSummary, 'sessionId' | 'camera'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(camera.connectionId, camera.deviceId), sessionUrl(sessionId, 'stop'), jsonInit('POST'), request)
}

// Tests the latest revision of a model on the sky with a camera, without activating it; its progress arrives as events.
export function verifyMountPointing(state: MountPointingRuntime, modelId: string, body: Omit<MountPointingVerifyRequest, 'token'>, request: typeof fetch = fetch) {
	return command(state, cameraKey(body.camera.connectionId, body.camera.deviceId), modelUrl(modelId, 'verify'), jsonInit('POST', { ...body, token: nanoid() } satisfies MountPointingVerifyRequest), request)
}

// Asks the server for the plan a form would sample, which commands nothing, and keeps it for its camera.
export async function previewMountPointingPlan(state: MountPointingRuntime, key: string, mount: { readonly connectionId: string; readonly deviceId: string }, settings: Readonly<PointingModelSettings>, request: typeof fetch = fetch) {
	delete state.errors[key]

	try {
		const response = await request('/api/mount-pointing/plan', jsonInit('POST', { mount, plan: planRequest(settings) }))
		if (response.ok) state.plans[key] = (await response.json()) as PointingPlan
		else state.errors[key] = await responseError(response)
	} catch {
		state.errors[key] = 'Unable to reach the server.'
	}
}

// Shows a model in the Tools page and fetches its record; absent shows none.
export function selectPointingModel(state: MountPointingRuntime, modelId: string | undefined, request: typeof fetch = fetch) {
	state.selectedModelId = modelId
	if (modelId !== undefined) void loadPointingModel(state, modelId, request)
}

// Starts a fit of a model; its outcome arrives as events.
export function fitPointingModel(state: MountPointingRuntime, modelId: string, body: PointingFitModelRequest, request: typeof fetch = fetch) {
	return command(state, modelId, modelUrl(modelId, 'fit'), jsonInit('POST', body), request)
}

// Renames a model or changes its notes.
export function patchPointingModel(state: MountPointingRuntime, modelId: string, body: PointingModelPatch, request: typeof fetch = fetch) {
	return command(state, modelId, modelUrl(modelId), jsonInit('PATCH', body), request)
}

// Deletes a model.
export function deletePointingModel(state: MountPointingRuntime, modelId: string, request: typeof fetch = fetch) {
	return command(state, modelId, modelUrl(modelId), { method: 'DELETE' }, request)
}

// Puts a revision of a model in force on a mount.
export function activatePointingModel(state: MountPointingRuntime, modelId: string, body: PointingActivateRequest, request: typeof fetch = fetch) {
	return command(state, modelId, modelUrl(modelId, 'activate'), jsonInit('POST', body), request)
}

// Takes the model of a mount out of force.
export function deactivatePointingModel(state: MountPointingRuntime, modelId: string, mount: { readonly connectionId: string; readonly deviceId: string }, request: typeof fetch = fetch) {
	return command(state, modelId, `/api/mount-pointing/mounts/${encodeURIComponent(mount.connectionId)}/${encodeURIComponent(mount.deviceId)}/deactivate`, jsonInit('POST'), request)
}

// Sends an exchange document to the server, which fits it again from its samples. Resolves why it was refused, if it was.
export async function importPointingModel(document: PointingModelExport, request: typeof fetch = fetch): Promise<string | undefined> {
	try {
		const response = await request('/api/mount-pointing/models', jsonInit('POST', document))
		return response.ok ? undefined : await responseError(response)
	} catch {
		return 'Unable to reach the server.'
	}
}

// Returns the URL that downloads the exchange document of a model.
export function pointingModelExportUrl(modelId: string) {
	return modelUrl(modelId, 'export')
}
