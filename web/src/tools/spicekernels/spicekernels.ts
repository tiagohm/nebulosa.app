import type {
	ServerEvent,
	SpiceBodiesResponse,
	SpiceBodySegment,
	SpiceCatalogItem,
	SpiceElementList,
	SpiceElementsIntegrateRequest,
	SpiceElementsPreview,
	SpiceEvaluation,
	SpiceEvaluationRequest,
	SpiceEvaluationResult,
	SpiceKernelDetails,
	SpiceKernelGenerateRequest,
	SpiceKernelJob,
	SpiceKernelLibrarySnapshot,
	SpiceKernelSummary,
	SpiceKernelUpdateRequest,
} from 'api'
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

// Starts, or joins, the download of a curated kernel. Returns its job, or undefined when it could not be started.
export function downloadSpiceKernel(state: SpiceKernelsState, sourceId: string, request: ApiFetch = browserFetch) {
	return submit(state, `download:${sourceId}`, () => request('/api/spice-kernels/download', jsonInit('POST', { sourceId })), 'The download could not be started.')
}

// Outcome of reading elements: the numbered asteroids they hold, or why they could not be read.
export type SpiceElementsAnswer = { readonly ok: true; readonly preview: SpiceElementsPreview } | { readonly ok: false; readonly error: string }

// The MPC lists of elements the server may download; empty when it cannot be reached.
export async function fetchElementLists(request: ApiFetch = browserFetch): Promise<readonly SpiceElementList[]> {
	try {
		const response = await request('/api/spice-kernels/elements/lists')
		return response.ok ? ((await response.json()) as SpiceElementList[]) : []
	} catch {
		return []
	}
}

// Has the server download an MPC list of elements and answers its numbered asteroids.
export function downloadElements(id: string, request: ApiFetch = browserFetch) {
	return readElements(() => request(`/api/spice-kernels/elements/lists/${encodeURIComponent(id)}`, { method: 'POST' }), 'The list could not be downloaded.')
}

// Sends a file of MPC 1-line elements to the server and answers its numbered asteroids.
export function parseElementsFile(file: File, request: ApiFetch = browserFetch) {
	return readElements(() => request('/api/spice-kernels/elements/parse', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: file }), 'The file could not be read.')
}

// Starts, or joins, the integration of imported elements into one kernel. Returns its job, or undefined when it could not
// be started.
export function integrateElements(state: SpiceKernelsState, body: SpiceElementsIntegrateRequest, request: ApiFetch = browserFetch) {
	return submit(state, 'integrate', () => request('/api/spice-kernels/elements/integrate', jsonInit('POST', body)), 'The integration could not be started.')
}

// Runs a request answering a preview of elements.
async function readElements(run: () => Promise<Response>, fallback: string): Promise<SpiceElementsAnswer> {
	try {
		const response = await run()
		if (response.ok) return { ok: true, preview: (await response.json()) as SpiceElementsPreview }
		return { ok: false, error: await responseError(response, fallback) }
	} catch {
		return { ok: false, error: 'The server is unreachable.' }
	}
}

// Starts, or joins, the generation of a small-body kernel. Returns its job, or undefined when it could not be started.
export function generateSpiceKernel(state: SpiceKernelsState, body: SpiceKernelGenerateRequest, request: ApiFetch = browserFetch) {
	return submit(state, 'generate', () => request('/api/spice-kernels/generate', jsonInit('POST', body)), 'The kernel could not be requested.')
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

// Turns the offline switch of the ephemeris sources of the server on or off.
export function setEphemerisOffline(state: SpiceKernelsState, offline: boolean, request: ApiFetch = browserFetch) {
	return send(state, 'settings', () => request('/api/spice-kernels/settings', jsonInit('PATCH', { offline })), 'The ephemeris sources could not be changed.')
}

// Prefers a kernel for a NAIF body, or, without kernelId, returns the body to the load order alone.
export function setSpiceBodyPreference(state: SpiceKernelsState, body: number, kernelId: string | undefined, request: ApiFetch = browserFetch) {
	return send(state, `body:${body}`, () => request(`/api/spice-kernels/bodies/${body}/preference`, jsonInit('PUT', { kernelId })), 'The preference could not be changed.')
}

// How the current set of the server selects the segments of each body; undefined when the server is unreachable.
export async function fetchSpiceBodies(signal?: AbortSignal, request: ApiFetch = browserFetch): Promise<SpiceBodiesResponse | undefined> {
	try {
		const response = await request('/api/spice-kernels/bodies', { signal })
		return response.ok ? ((await response.json()) as SpiceBodiesResponse) : undefined
	} catch {
		return undefined
	}
}

// State of a body relative to another at an instant, through the selection of the server or from one segment. Throws
// with the message of the server when the request fails.
export async function evaluateSpice(body: SpiceEvaluationRequest, signal?: AbortSignal, request: ApiFetch = browserFetch): Promise<SpiceEvaluationResult> {
	const response = await request('/api/spice-kernels/evaluate', { ...jsonInit('POST', body), signal })
	if (!response.ok) throw new Error(await responseError(response, 'The state could not be computed.'))
	return (await response.json()) as SpiceEvaluationResult
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

// Time span of a timeline of segments, TDB seconds past J2000: from the earliest start to the latest end; undefined
// without segments. A span of a single instant is widened by one second so positions stay finite.
export function timelineSpan(segments: readonly Pick<SpiceBodySegment, 'start' | 'end'>[]): { readonly start: number; readonly end: number } | undefined {
	if (segments.length === 0) return undefined
	const start = Math.min(...segments.map((e) => e.start))
	const end = Math.max(...segments.map((e) => e.end))
	return end > start ? { start, end } : { start, end: start + 1 }
}

// Position and width, in percent of a timeline span, of an interval from start to end, clamped to the span. A
// non-empty interval keeps a visible width of at least `minimum` percent.
export function timelinePlacement(span: { readonly start: number; readonly end: number }, start: number, end: number, minimum: number = 0.4) {
	const length = span.end - span.start
	const left = Math.max(0, Math.min(100, ((start - span.start) / length) * 100))
	const right = Math.max(0, Math.min(100, ((end - span.start) / length) * 100))
	const width = Math.max(right - left, minimum)
	return { left: Math.min(left, 100 - width), width }
}

// Difference of two evaluations of the same target and center: the distance between the positions (km), between the
// velocities (km/s), and the angle between the directions (radians).
export function evaluationDifference(a: SpiceEvaluation, b: SpiceEvaluation) {
	const position = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2])
	const velocity = Math.hypot(a.velocity[0] - b.velocity[0], a.velocity[1] - b.velocity[1], a.velocity[2] - b.velocity[2])
	const cross = Math.hypot(a.position[1] * b.position[2] - a.position[2] * b.position[1], a.position[2] * b.position[0] - a.position[0] * b.position[2], a.position[0] * b.position[1] - a.position[1] * b.position[0])
	const dot = a.position[0] * b.position[0] + a.position[1] * b.position[1] + a.position[2] * b.position[2]
	return { position, velocity, angle: Math.atan2(cross, dot) }
}

// Whether a job is still queued or running, rather than completed, failed, or cancelled.
export function jobActive(job: Pick<SpiceKernelJob, 'state'>) {
	return job.state !== 'completed' && job.state !== 'failed' && job.state !== 'cancelled'
}

// Active jobs of the library, oldest first.
export function activeJobs(snapshot: SpiceKernelLibrarySnapshot | undefined) {
	return (snapshot?.jobs ?? []).filter(jobActive).toSorted((a, b) => a.createdAt - b.createdAt)
}

// The latest state of a job the library still lists, by its id; undefined without an id or once the library forgot it.
export function findJob(snapshot: SpiceKernelLibrarySnapshot | undefined, jobId: string | undefined) {
	return jobId === undefined ? undefined : snapshot?.jobs.find((e) => e.jobId === jobId)
}

// NAIF code of the Sun, the center of every small-body kernel the library generates or integrates.
const SUN = 10

// Sources of the kernels relative to the Sun alone, which need another kernel to reach the barycenter.
const HELIOCENTRIC_SOURCES: ReadonlySet<SpiceKernelSummary['sourceKind']> = new Set(['horizons', 'mpc', 'elements'])

// The enabled small-body kernels that would need a planetary kernel again once the kernel `id` is gone: those relative to
// the Sun, when `id` is the only enabled kernel with the Sun. Empty when another enabled kernel has the Sun, or when `id`
// is disabled or has no Sun. Satellite kernels that need a planet are not followed.
export function strandedKernels(kernels: readonly SpiceKernelSummary[], id: string): SpiceKernelSummary[] {
	const kernel = kernels.find((e) => e.id === id)
	if (!kernel?.enabled || !kernel.targets.includes(SUN)) return []
	if (kernels.some((e) => e.id !== id && e.enabled && e.targets.includes(SUN))) return []
	return kernels.filter((e) => e.id !== id && e.enabled && HELIOCENTRIC_SOURCES.has(e.sourceKind))
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

// Runs a request of an action that starts a job, keeping its failure in errors. Returns the job the server answered, or
// undefined when it failed.
async function submit(state: SpiceKernelsState, key: string, run: () => Promise<Response>, fallback: string): Promise<SpiceKernelJob | undefined> {
	let job: SpiceKernelJob | undefined

	await send(
		state,
		key,
		async () => {
			const response = await run()
			if (response.ok) job = (await response.json()) as SpiceKernelJob
			return response
		},
		fallback,
	)

	return job
}

// A snapshot with a job replaced or added, the latest change first.
function withJob(snapshot: SpiceKernelLibrarySnapshot, job: SpiceKernelJob): SpiceKernelLibrarySnapshot {
	return { ...snapshot, jobs: [job, ...snapshot.jobs.filter((e) => e.jobId !== job.jobId)] }
}
