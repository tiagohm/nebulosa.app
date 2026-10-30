import type { PointingFitModelRequest, PointingFitState, PointingModelDetail, PointingModelEvent, PointingModelExport, PointingModelPatch, PointingModelsSnapshot, PointingModelSummary, ServerEvent, UnavailablePointingModel } from 'api'
import { proxy } from 'valtio'
import { jsonInit, responseError } from '../http'
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
	// Model the Tools page shows, which Images can hand over.
	selectedModelId?: string
	// Sequence of the latest event applied.
	sequence: number
	// Models with a command of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command on a model failed, by model id; cleared by its next command.
	errors: Record<string, string>
}

// Mount pointing state of the tab.
export const mountPointingRuntime = proxy<MountPointingRuntime>({ models: {}, unavailable: [], fits: {}, details: {}, sequence: 0, pending: {}, errors: {} })

// Refreshes of the models, ordered against the events applied meanwhile.
const refreshes = new SnapshotRefreshes()

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

// Applies a mount pointing event; any other event is ignored.
export function handleMountPointingEvent(state: MountPointingRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	if (event.type === 'mountPointing:modelUpdated' || event.type === 'mountPointing:modelRemoved') applyModelEvent(state, event, request)
}

// Replaces the models with the server's snapshot, which may have changed while the socket was closed, and fetches the
// complete records already open. A model an event changed during the request is left as the event set it, and a response
// is dropped when another refresh started meanwhile.
export async function refreshMountPointing(state: MountPointingRuntime, request: typeof fetch = fetch) {
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
