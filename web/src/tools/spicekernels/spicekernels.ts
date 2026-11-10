import type { ServerEvent, SpiceCatalogItem, SpiceEphemerisPolicy, SpiceKernelDetails, SpiceKernelGenerateRequest, SpiceKernelJob, SpiceKernelLibrarySnapshot, SpiceKernelUpdateRequest } from 'api'
import { proxy } from 'valtio'
import { type ApiFetch, browserFetch, jsonInit, responseError } from '../../http'

// Mirror of the SPICE Kernel Library of the server and the requests this tab sends to it. The library is server-global:
// this mirror is fed by GET /api/spice-kernels, the spiceKernels:changed events (which make it read the snapshot again)
// and the spiceKernels:jobUpdated events (which carry a job), and no tab, profile, or route change starts, stops, or
// changes anything in it. Revisions order the snapshot and the events within one server process (epoch), so a snapshot
// older than an event already applied never brings back a stale state.

// Library known to the tab and the requests in flight.
export interface SpiceKernelsState {
	// Server process the library belongs to; absent before the first snapshot.
	epoch?: string
	// Latest revision applied from the server.
	revision: number
	// Latest snapshot; absent before the first one.
	snapshot?: SpiceKernelLibrarySnapshot
	// Requests in flight, by action key (such as import, settings, or kernel:<id>).
	pending: Record<string, true>
	// Why the last request of an action failed, by action key.
	errors: Record<string, string>
}

// Library of the server, shared by every view of the tab.
export const spiceKernelsState = proxy<SpiceKernelsState>({ revision: 0, pending: {}, errors: {} })

// Generation of the latest snapshot request; an older response is dropped.
let generation = 0

// Display name of each ephemeris policy.
export const SPICE_POLICY_LABELS: Readonly<Record<SpiceEphemerisPolicy, string>> = { automatic: 'Automatic', offline: 'Offline', spkOnly: 'SPK only' }

// Replaces the library with a snapshot of the server, unless it is older than the events already applied.
export function applySpiceKernelSnapshot(state: SpiceKernelsState, snapshot: SpiceKernelLibrarySnapshot) {
	if (snapshot.epoch === state.epoch && snapshot.revision < state.revision) return
	state.epoch = snapshot.epoch
	state.revision = snapshot.revision
	state.snapshot = snapshot
}

// Fetches the library again; called on every socket (re)open and after every change event.
export async function refreshSpiceKernels(state: SpiceKernelsState, request: ApiFetch = browserFetch) {
	const current = ++generation

	try {
		const response = await request('/api/spice-kernels')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as SpiceKernelLibrarySnapshot
		if (current === generation) applySpiceKernelSnapshot(state, snapshot)
	} catch {
		// The server is unreachable; the next socket open refreshes the library.
	}
}

// Applies a library event; any other event is ignored. A change reads the snapshot again; a job update replaces that job.
// An event of another server process starts over from it, and an event already contained in what the tab knows is dropped.
export function handleSpiceKernelEvent(state: SpiceKernelsState, event: ServerEvent, request: ApiFetch = browserFetch) {
	if (event.type !== 'spiceKernels:changed' && event.type !== 'spiceKernels:jobUpdated') return
	if (event.epoch === state.epoch && event.revision <= state.revision) return

	if (event.type === 'spiceKernels:jobUpdated' && event.epoch === state.epoch && state.snapshot) {
		state.revision = event.revision
		state.snapshot = withJob(state.snapshot, event.job)
		return
	}

	void refreshSpiceKernels(state, request)
}

// Adds an SPK file chosen by the operator, streamed as the request body. Returns whether it was added or already installed.
export function importSpiceKernel(state: SpiceKernelsState, file: File, request: ApiFetch = browserFetch) {
	return send(state, 'import', () => request(`/api/spice-kernels/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }), 'The file could not be added.')
}

// Starts, or joins, the download of a curated kernel.
export function downloadSpiceKernel(state: SpiceKernelsState, sourceId: string, request: ApiFetch = browserFetch) {
	return send(state, `download:${sourceId}`, () => request('/api/spice-kernels/download', jsonInit('POST', { sourceId })), 'The download could not be started.')
}

// Starts, or joins, the Horizons generation of a small-body kernel.
export function generateSpiceKernel(state: SpiceKernelsState, body: SpiceKernelGenerateRequest, request: ApiFetch = browserFetch) {
	return send(state, 'generate', () => request('/api/spice-kernels/generate', jsonInit('POST', body)), 'The kernel could not be requested from Horizons.')
}

// Cancels an acquisition job.
export function cancelSpiceKernelJob(state: SpiceKernelsState, jobId: string, request: ApiFetch = browserFetch) {
	return send(state, `job:${jobId}`, () => request(`/api/spice-kernels/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }), 'The job could not be cancelled.')
}

// Turns a kernel on or off or moves it in the load order.
export function updateSpiceKernel(state: SpiceKernelsState, id: string, body: SpiceKernelUpdateRequest, request: ApiFetch = browserFetch) {
	return send(state, `kernel:${id}`, () => request(`/api/spice-kernels/${encodeURIComponent(id)}`, jsonInit('PATCH', body)), 'The kernel could not be changed.')
}

// Hashes and inspects the file of a kernel again.
export function verifySpiceKernel(state: SpiceKernelsState, id: string, request: ApiFetch = browserFetch) {
	return send(state, `kernel:${id}`, () => request(`/api/spice-kernels/${encodeURIComponent(id)}/verify`, { method: 'POST' }), 'The kernel could not be verified.')
}

// Deletes a kernel and its file.
export function deleteSpiceKernel(state: SpiceKernelsState, id: string, request: ApiFetch = browserFetch) {
	return send(state, `kernel:${id}`, () => request(`/api/spice-kernels/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'The kernel could not be deleted.')
}

// Changes the ephemeris policy of the server.
export function setSpicePolicy(state: SpiceKernelsState, policy: SpiceEphemerisPolicy, request: ApiFetch = browserFetch) {
	return send(state, 'settings', () => request('/api/spice-kernels/settings', jsonInit('PATCH', { policy })), 'The policy could not be changed.')
}

// A kernel and its segments; undefined when it is unknown or the server is unreachable.
export async function fetchSpiceKernelDetails(id: string, signal?: AbortSignal, request: ApiFetch = browserFetch): Promise<SpiceKernelDetails | undefined> {
	try {
		const response = await request(`/api/spice-kernels/${encodeURIComponent(id)}`, { signal })
		return response.ok ? ((await response.json()) as SpiceKernelDetails) : undefined
	} catch {
		return undefined
	}
}

// Curated downloads; empty when the server is unreachable.
export async function fetchSpiceCatalog(signal?: AbortSignal, request: ApiFetch = browserFetch): Promise<SpiceCatalogItem[]> {
	try {
		const response = await request('/api/spice-kernels/catalog', { signal })
		return response.ok ? ((await response.json()) as SpiceCatalogItem[]) : []
	} catch {
		return []
	}
}

// Active jobs of the library, oldest first.
export function activeJobs(snapshot: SpiceKernelLibrarySnapshot | undefined) {
	return (snapshot?.jobs ?? []).filter((e) => e.state !== 'completed' && e.state !== 'failed' && e.state !== 'cancelled').toSorted((a, b) => a.createdAt - b.createdAt)
}

// Runs a request of an action, keeping its failure in errors. Returns whether it succeeded; the library itself changes
// through its events.
async function send(state: SpiceKernelsState, key: string, run: () => Promise<Response>, fallback: string) {
	if (state.pending[key]) return false
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await run()
		if (response.ok) return true
		state.errors[key] = await responseError(response, fallback)
		return false
	} catch {
		state.errors[key] = 'The server is unreachable.'
		return false
	} finally {
		delete state.pending[key]
	}
}

// A snapshot with a job replaced or added, the latest change first.
function withJob(snapshot: SpiceKernelLibrarySnapshot, job: SpiceKernelJob): SpiceKernelLibrarySnapshot {
	return { ...snapshot, jobs: [job, ...snapshot.jobs.filter((e) => e.jobId !== job.jobId)] }
}
