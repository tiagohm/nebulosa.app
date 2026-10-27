import type { MountCoordinate, MountState, PlateSolutions, PlateSolveJob, PlateSolveRequest, PlateSolveResult, PlateSolverProvider, PlateSolveSnapshot, PlateSolveStage, ResolvedPlateSolveHints, ServerEvent } from 'api'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { normalizeAngle, toDeg, toHour } from 'nebulosa/src/math/units/angle'
import { proxy, ref } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { jsonInit, responseError } from '../http'

// Plate solving jobs of the server as this tab knows them, used by the Images workspace (manual solves). The server
// runs every job and keeps every result: this store mirrors the compact jobs of its snapshot and plateSolving:updated
// events, remembers the latest job of each image id, and fetches the full result of a completed job (the WCS) only
// when a view needs it. A result is always matched to the image id it solved, so a late result never lands on another
// image. The solution a header already had is fetched apart, per image, and never replaced by a job. It also gives the
// coordinate a mount is synced on for a solution and why a sync cannot be sent.

// Mirror of the server's plate solving jobs.
export interface PlateSolvingState {
	// Known jobs, by job id.
	jobs: Record<string, PlateSolveJob>
	// Latest job of each image, by image id.
	latest: Record<string, string>
	// Fetched results of completed jobs, by job id; kept out of the proxy.
	results: Record<string, PlateSolveResult>
	// Why the result of a completed job could not be fetched, by job id.
	resultErrors: Record<string, string>
	// Why the latest submission of an image failed, by image id.
	submitErrors: Record<string, string>
	// Solution of the header of each image whose solutions were fetched; null when it has none.
	headers: Record<string, PlateSolution | null>
	// Hints each image offers an assisted solve, by image id; kept out of the proxy.
	hints: Record<string, ResolvedPlateSolveHints>
}

// Display names of the solvers.
export const PROVIDER_LABELS: Readonly<Record<PlateSolverProvider, string>> = { astap: 'ASTAP', astrometryLocal: 'Astrometry.net Local', nova: 'Astrometry.net Online' }

// Solvers, in selector order.
export const PROVIDERS: readonly PlateSolverProvider[] = ['astap', 'astrometryLocal', 'nova']

// External Tools entry of each solver, for its availability and its settings link.
export const PROVIDER_TOOLS: Readonly<Record<PlateSolverProvider, string>> = { astap: 'astap', astrometryLocal: 'astrometryLocal', nova: 'nova' }

// Display names of the steps of a running job.
export const STAGE_LABELS: Readonly<Record<PlateSolveStage, string>> = { preparing: 'Preparing the image', solving: 'Solving', uploading: 'Uploading to the service', submitted: 'Waiting for the remote job', retrieving: 'Retrieving the solution' }

// Request of a first solve: ASTAP around the pointing of the header.
export const DEFAULT_PLATE_SOLVE_REQUEST: PlateSolveRequest = { provider: 'astap', strategy: 'assisted' }

// Jobs kept at most; the oldest ended ones beyond it that are not the latest of an image are forgotten.
const MAX_JOBS = 256

// Fetched results kept at most beyond those of the latest job of an image.
const MAX_RESULTS = 8

// Mirror of the server's plate solving jobs, shared by every component of the tab.
export const plateSolvingState = proxy<PlateSolvingState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {}, headers: {}, hints: {} })

// Jobs whose result is being fetched, and images whose solutions or hints are.
const fetching = new Set<string>()

// Whether a job is waiting or running.
export function isActive(job: Pick<PlateSolveJob, 'state'> | undefined): boolean {
	return job?.state === 'queued' || job?.state === 'running'
}

// Returns the latest job of an image.
export function latestJob(state: Pick<PlateSolvingState, 'jobs' | 'latest'>, imageId: string): PlateSolveJob | undefined {
	const jobId = state.latest[imageId]
	return jobId === undefined ? undefined : state.jobs[jobId]
}

// Returns the completed jobs of an image this tab knows, newest first.
export function completedJobs(state: Pick<PlateSolvingState, 'jobs'>, imageId: string): PlateSolveJob[] {
	return Object.values(state.jobs)
		.filter((job) => job.imageId === imageId && job.state === 'completed')
		.sort((a, b) => b.queuedAt - a.queuedAt)
}

// Returns the job a selection names for an image: the job selected, when it is a known job of that image, otherwise the
// latest job of the image. 'header' names the solution of the header and gives no job.
export function selectedJob(state: Pick<PlateSolvingState, 'jobs' | 'latest'>, imageId: string, selected: string | undefined): PlateSolveJob | undefined {
	if (selected === 'header') return undefined
	const job = selected === undefined ? undefined : state.jobs[selected]
	return job?.imageId === imageId ? job : latestJob(state, imageId)
}

// Returns the solution a selection names for an image: the header's for 'header', otherwise the WCS of the selected
// (or latest) job once its result was fetched and it solved.
export function selectedSolution(state: Pick<PlateSolvingState, 'jobs' | 'latest' | 'results' | 'headers'>, imageId: string, selected: string | undefined): PlateSolution | undefined {
	if (selected === 'header') return state.headers[imageId] ?? undefined
	const job = selectedJob(state, imageId, selected)
	return job?.state === 'completed' ? state.results[job.jobId]?.solution : undefined
}

// Returns the coordinate a mount is synced on for a solution: its ICRS centre sent as J2000, which differs from the
// ICRS by tens of milliarcseconds, as decimal hours of right ascension and decimal degrees of declination.
export function mountSyncTarget(solution: Pick<PlateSolution, 'rightAscension' | 'declination'>): MountCoordinate {
	return { frame: 'J2000', x: toHour(normalizeAngle(solution.rightAscension)).toFixed(6), y: toDeg(solution.declination).toFixed(6) }
}

// Returns why a mount cannot sync at all, judged from its reported state (undefined while unknown), for
// roleAvailability; undefined when it can.
export function mountSyncSupport(state: Pick<MountState, 'canSync'> | undefined): string | undefined {
	return state && !state.canSync ? 'The mount cannot sync.' : undefined
}

// Returns why the mount cannot be synced on a solution now, or undefined when it can, from the availability of the
// setup's mount (unsupported per mountSyncSupport), its reported state (undefined while unknown), and whether a
// command of it is in flight. The server checks again.
export function mountSyncBlocker(mount: RoleAvailability, state: Pick<MountState, 'parked' | 'parking'> | undefined, pending: boolean): string | undefined {
	if (mount.status !== 'ready') return mount.message
	if (!state) return 'The mount state is not known yet.'
	if (state.parked || state.parking) return 'The mount is parked.'
	if (pending) return 'A command of the mount is in flight.'
	return undefined
}

// Records a job. A job seen for the first time becomes the latest of its image unless a newer one is known; a job
// already known never takes it back, so an update or a snapshot cannot undo a submission. submitted makes the job the
// latest whatever its age, as the answer to a submission of this tab, which may be an equivalent earlier job.
function track(state: PlateSolvingState, job: PlateSolveJob, submitted = false) {
	const known = job.jobId in state.jobs
	state.jobs[job.jobId] = job
	const latest = latestJob(state, job.imageId)
	if (submitted || !latest || (!known && latest.queuedAt <= job.queuedAt)) state.latest[job.imageId] = job.jobId
	prune(state)
}

// Forgets the oldest ended jobs beyond MAX_JOBS and the oldest results beyond MAX_RESULTS, never those of the latest
// job of an image.
function prune(state: PlateSolvingState) {
	const latest = new Set(Object.values(state.latest))
	const ids = Object.keys(state.jobs)

	if (ids.length > MAX_JOBS) {
		const forgettable = ids.filter((id) => !latest.has(id) && !isActive(state.jobs[id])).sort((a, b) => state.jobs[a].queuedAt - state.jobs[b].queuedAt)

		for (const id of forgettable.slice(0, ids.length - MAX_JOBS)) {
			delete state.jobs[id]
			delete state.results[id]
			delete state.resultErrors[id]
		}
	}

	const extra = Object.keys(state.results).filter((id) => !latest.has(id))
	for (const id of extra.slice(0, Math.max(0, extra.length - MAX_RESULTS))) delete state.results[id]

	for (const [imageId, jobId] of Object.entries(state.latest)) if (!state.jobs[jobId]) delete state.latest[imageId]
}

// Applies a server event to the store; other events are ignored.
export function handlePlateSolvingEvent(state: PlateSolvingState, event: ServerEvent) {
	if (event.type === 'plateSolving:updated') track(state, event.job)
}

// Fetches the snapshot of the server's jobs, after the socket (re)opened.
export async function refreshPlateSolving(state: PlateSolvingState, request: typeof fetch = fetch) {
	try {
		const response = await request('/api/plate-solving')
		if (!response.ok) return
		const snapshot = (await response.json()) as PlateSolveSnapshot
		for (const job of snapshot.jobs) track(state, job)
	} catch {
		// The next reconnection retries.
	}
}

// Submits a solve of an image. The job, or the job of an equivalent request, becomes the latest of the image and is
// returned; a refusal is kept in submitErrors.
export async function runPlateSolve(state: PlateSolvingState, imageId: string, solve: PlateSolveRequest, request: typeof fetch = fetch): Promise<PlateSolveJob | undefined> {
	delete state.submitErrors[imageId]

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/plate-solving`, jsonInit('POST', solve))

		if (!response.ok) {
			state.submitErrors[imageId] = await responseError(response)
			return undefined
		}

		const job = (await response.json()) as PlateSolveJob
		track(state, job, true)
		return job
	} catch {
		state.submitErrors[imageId] = 'Unable to reach the server'
		return undefined
	}
}

// Asks the server to cancel a job; its end arrives as an event.
export async function cancelPlateSolve(jobId: string, request: typeof fetch = fetch) {
	try {
		await request(`/api/plate-solving/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
	} catch {
		// The job state stays as the server reports it.
	}
}

// Fetches the result of a completed job once, unless it is fetched or failed already.
export async function loadPlateSolveResult(state: PlateSolvingState, jobId: string, request: typeof fetch = fetch) {
	if (state.results[jobId] || state.resultErrors[jobId] !== undefined || fetching.has(jobId)) return
	fetching.add(jobId)

	try {
		const response = await request(`/api/plate-solving/${encodeURIComponent(jobId)}/result`)
		if (response.ok) state.results[jobId] = ref((await response.json()) as PlateSolveResult)
		else state.resultErrors[jobId] = await responseError(response)
	} catch {
		state.resultErrors[jobId] = 'Unable to reach the server'
	} finally {
		fetching.delete(jobId)
	}
}

// Fetches once the solutions of an image: its header solution, and the completed jobs the server kept, which this tab
// may not have seen.
export async function loadSolutions(state: PlateSolvingState, imageId: string, request: typeof fetch = fetch) {
	const key = `solutions:${imageId}`
	if (imageId in state.headers || fetching.has(key)) return
	fetching.add(key)

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/plate-solutions`)
		if (!response.ok) return
		const solutions = (await response.json()) as PlateSolutions
		state.headers[imageId] = solutions.header ? ref(solutions.header) : null
		for (const job of solutions.jobs) if (!(job.jobId in state.jobs)) track(state, job)
	} catch {
		// A later view retries.
	} finally {
		fetching.delete(key)
	}
}

// Fetches once the hints an assisted solve of an image would take from its header.
export async function loadHints(state: PlateSolvingState, imageId: string, request: typeof fetch = fetch) {
	const key = `hints:${imageId}`
	if (imageId in state.hints || fetching.has(key)) return
	fetching.add(key)

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/plate-solving/hints`)
		if (response.ok) state.hints[imageId] = ref((await response.json()) as ResolvedPlateSolveHints)
	} catch {
		// A later view retries.
	} finally {
		fetching.delete(key)
	}
}
