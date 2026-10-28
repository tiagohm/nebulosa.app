import type { AnnotationJob, AnnotationRequest, AnnotationResult, AnnotationSnapshot, ServerEvent } from 'api'
import { proxy, ref } from 'valtio'
import { jsonInit, responseError } from '../http'

// Annotation jobs of the server as this tab knows them, for the Annotation tool of the Images workspace. The server runs
// every job and keeps every result: this store mirrors the compact jobs of its snapshot and annotations:updated events,
// remembers the latest job of each image id, and fetches the full result of a completed job (the objects, the
// constellation figures, and the WCS they were selected with) only when a view needs it. A result is always matched to
// the image id it annotated, so a late result never lands on another image.

// Mirror of the server's annotation jobs.
export interface AnnotationsState {
	// Known jobs, by job id.
	jobs: Record<string, AnnotationJob>
	// Latest job of each image, by image id.
	latest: Record<string, string>
	// Fetched results of completed jobs, by job id; kept out of the proxy.
	results: Record<string, AnnotationResult>
	// Why the result of a completed job could not be fetched, by job id.
	resultErrors: Record<string, string>
	// Why the latest submission of an image failed, by image id.
	submitErrors: Record<string, string>
}

// Jobs kept at most; the oldest ended ones beyond it that are not the latest of an image are forgotten.
const MAX_JOBS = 256

// Fetched results kept at most beyond those of the latest job of an image.
const MAX_RESULTS = 8

// Mirror of the server's annotation jobs, shared by every component of the tab.
export const annotationsState = proxy<AnnotationsState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {} })

// Jobs whose result is being fetched.
const fetching = new Set<string>()

// Images whose kept jobs were fetched, or are being fetched, by this tab.
const fetchedImages = new Set<string>()

// Whether a job is waiting or running.
export function isActive(job: Pick<AnnotationJob, 'state'> | undefined): boolean {
	return job?.state === 'queued' || job?.state === 'running'
}

// Whether two requests annotate the same way: the same WCS, magnitude limit, instant, and observer.
export function sameAnnotationRequest(a: AnnotationRequest, b: AnnotationRequest): boolean {
	const observer = a.observer === b.observer || (a.observer !== undefined && b.observer !== undefined && a.observer.latitude === b.observer.latitude && a.observer.longitude === b.observer.longitude && a.observer.elevation === b.observer.elevation)
	return a.kind === b.kind && a.plateSolveJobId === b.plateSolveJobId && a.magnitudeLimit === b.magnitudeLimit && a.time === b.time && observer
}

// Returns the latest job of an image.
export function latestAnnotationJob(state: Pick<AnnotationsState, 'jobs' | 'latest'>, imageId: string): AnnotationJob | undefined {
	const jobId = state.latest[imageId]
	return jobId === undefined ? undefined : state.jobs[jobId]
}

// Returns the fetched result of the latest job of an image, when it completed.
export function latestAnnotationResult(state: Pick<AnnotationsState, 'jobs' | 'latest' | 'results'>, imageId: string): AnnotationResult | undefined {
	const job = latestAnnotationJob(state, imageId)
	return job?.state === 'completed' ? state.results[job.jobId] : undefined
}

// Records a job. A job seen for the first time becomes the latest of its image unless a newer one is known; a job
// already known never takes it back, so an update or a snapshot cannot undo a submission. submitted makes the job the
// latest whatever its age, as the answer to a submission of this tab, which may be an equivalent earlier job.
function track(state: AnnotationsState, job: AnnotationJob, submitted = false) {
	const known = job.jobId in state.jobs
	state.jobs[job.jobId] = job
	const latest = latestAnnotationJob(state, job.imageId)
	if (submitted || !latest || (!known && latest.queuedAt <= job.queuedAt)) state.latest[job.imageId] = job.jobId
	prune(state)
}

// Forgets the oldest ended jobs beyond MAX_JOBS and the oldest results beyond MAX_RESULTS, never those of the latest
// job of an image.
function prune(state: AnnotationsState) {
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

	// An image no longer known keeps no latest entry of a forgotten job.
	for (const [imageId, jobId] of Object.entries(state.latest)) if (!state.jobs[jobId]) delete state.latest[imageId]
}

// Applies a server event to the store; other events are ignored.
export function handleAnnotationsEvent(state: AnnotationsState, event: ServerEvent) {
	if (event.type === 'annotations:updated') track(state, event.job)
}

// Fetches once the completed jobs the server keeps for an image, which may be older than the jobs of the snapshot.
export async function loadImageAnnotations(state: AnnotationsState, imageId: string, request: typeof fetch = fetch) {
	if (fetchedImages.has(imageId)) return
	fetchedImages.add(imageId)

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/annotations`)
		if (!response.ok) return
		for (const job of (await response.json()) as AnnotationJob[]) if (!(job.jobId in state.jobs)) track(state, job)
	} catch {
		fetchedImages.delete(imageId)
	}
}

// Fetches the snapshot of the server's jobs, after the socket (re)opened.
export async function refreshAnnotations(state: AnnotationsState, request: typeof fetch = fetch) {
	try {
		const response = await request('/api/annotations')
		if (!response.ok) return
		const snapshot = (await response.json()) as AnnotationSnapshot
		for (const job of snapshot.jobs) track(state, job)
	} catch {
		// The next reconnection retries.
	}
}

// Submits an annotation of an image. The job, or the equivalent job the server answers, becomes the latest of the
// image; a refusal is kept in submitErrors.
export async function runAnnotation(state: AnnotationsState, imageId: string, annotation: AnnotationRequest, request: typeof fetch = fetch) {
	delete state.submitErrors[imageId]

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/annotations`, jsonInit('POST', annotation))

		if (!response.ok) {
			state.submitErrors[imageId] = await responseError(response)
			return
		}

		track(state, (await response.json()) as AnnotationJob, true)
	} catch {
		state.submitErrors[imageId] = 'Unable to reach the server'
	}
}

// Asks the server to cancel a job; its end arrives as an event.
export async function cancelAnnotation(jobId: string, request: typeof fetch = fetch) {
	try {
		await request(`/api/annotations/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
	} catch {
		// The job state stays as the server reports it.
	}
}

// Fetches the result of a completed job once, unless it is fetched or failed already.
export async function loadAnnotationResult(state: AnnotationsState, jobId: string, request: typeof fetch = fetch) {
	if (state.results[jobId] || state.resultErrors[jobId] !== undefined || fetching.has(jobId)) return
	fetching.add(jobId)

	try {
		const response = await request(`/api/annotations/${encodeURIComponent(jobId)}/result`)
		if (response.ok) state.results[jobId] = ref((await response.json()) as AnnotationResult)
		else state.resultErrors[jobId] = await responseError(response)
	} catch {
		state.resultErrors[jobId] = 'Unable to reach the server'
	} finally {
		fetching.delete(jobId)
	}
}

// Returns the plate solving job whose solution an annotation of the solution a view shows uses: the job shown, once it
// solved and its result was fetched; undefined for the WCS of the header (selected, or the fallback of an image without
// a solved job shown).
export function annotationPlateSolveJobId(solution: { readonly job?: { readonly jobId: string }; readonly solution?: unknown }): string | undefined {
	return solution.job && solution.solution ? solution.job.jobId : undefined
}

// Whether a result was computed with the WCS a view shows, so its overlay may be drawn over it.
export function annotationMatchesWcs(result: Pick<AnnotationResult, 'request'>, plateSolveJobId: string | undefined): boolean {
	return result.request.plateSolveJobId === plateSolveJobId
}

// Observer of the solar-system bodies of an annotation: geographic position, degrees and meters.
export interface AnnotationObserverSettings {
	// Geodetic latitude in degrees, north positive.
	readonly latitude: number
	// Geodetic longitude in degrees, east positive.
	readonly longitude: number
	// Height above the ellipsoid in meters.
	readonly elevation: number
}

// What the next run of a document annotates with.
export interface AnnotationRequestInput {
	// Faintest magnitude kept.
	readonly magnitudeLimit: number
	// Plate solving job whose solution is used; absent uses the header's WCS.
	readonly plateSolveJobId?: string
	// Observation instant set by hand, Unix milliseconds (UTC); absent uses the header's.
	readonly time?: number
	// Observer of the solar-system bodies; absent sees them from the Earth's center.
	readonly observer?: AnnotationObserverSettings
}

// Returns the request of a run: only the position of an observer is sent, never its name or time zone.
export function annotationRequest({ magnitudeLimit, plateSolveJobId, time, observer }: AnnotationRequestInput): AnnotationRequest {
	return {
		kind: 'local',
		magnitudeLimit,
		...(plateSolveJobId !== undefined && { plateSolveJobId }),
		...(time !== undefined && { time }),
		...(observer && { observer: { latitude: observer.latitude, longitude: observer.longitude, elevation: observer.elevation } }),
	}
}

// Formats an instant (Unix milliseconds) as the UTC value of a datetime-local input, to the second.
export function utcInputValue(time: number): string {
	return new Date(time).toISOString().slice(0, 19)
}

// Parses the value of a datetime-local input as UTC, Unix milliseconds; undefined when blank or not a date-time.
export function parseUtcInput(value: string): number | undefined {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) return undefined
	const time = Date.parse(`${value}Z`)
	return Number.isFinite(time) ? time : undefined
}
