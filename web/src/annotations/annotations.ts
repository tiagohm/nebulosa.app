import type { AnnotationBodies, AnnotationImageContext, AnnotationJob, AnnotationKind, AnnotationObject, AnnotationRequest, AnnotationResult, AnnotationSnapshot, MinorBody, MinorBodySearchResponse, ServerEvent } from 'api'
import { proxy, ref } from 'valtio'
import { latestOf, trackJob } from '../analysis'
import { jsonInit, responseError } from '../http'

// Annotation jobs of the server as this tab knows them, for the Annotation tool of the Images workspace. The server
// runs every job and keeps every result: this store mirrors the compact jobs of its snapshot and annotations:updated
// events, remembers the latest job of each kind (the local annotation, the solar-system search) of each image id, and
// fetches the full result of a completed job (the objects, the constellation figures, and the WCS they were selected
// with) only when a view needs it. A result is always matched to the image id it annotated, so a late result never
// lands on another image.

// Mirror of the server's annotation jobs.
export interface AnnotationsState {
	// Known jobs, by job id.
	jobs: Record<string, AnnotationJob>
	// Latest job of each kind of each image, by annotationKey.
	latest: Record<string, string>
	// Fetched results of completed jobs, by job id; kept out of the proxy.
	results: Record<string, AnnotationResult>
	// Why the result of a completed job could not be fetched, by job id.
	resultErrors: Record<string, string>
	// Why the latest submission of each kind of an image failed, by annotationKey.
	submitErrors: Record<string, string>
	// Observation date and site of each image as its header gives them, by image id; kept out of the proxy.
	contexts: Record<string, AnnotationImageContext>
}

// Mirror of the server's annotation jobs, shared by every component of the tab.
export const annotationsState = proxy<AnnotationsState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {}, contexts: {} })

// Jobs whose result is being fetched.
const fetching = new Set<string>()

// Images whose context was fetched, or is being fetched, by this tab.
const fetchedContexts = new Set<string>()

// Images whose kept jobs were fetched, or are being fetched, by this tab.
const fetchedImages = new Set<string>()

// Returns the key of the latest job of a kind of an image.
export function annotationKey(imageId: string, kind: AnnotationKind): string {
	return `${imageId}:${kind}`
}

// Groups a solar-system search lists when its request names none, as the server does.
const ALL_BODIES: AnnotationBodies = { solarSystem: true, satellite: true, minorBody: true }

// Whether two requests annotate the same way, as the server matches them: the same kind and WCS, and the same
// magnitude limit of a local run or groups of a solar-system search.
export function sameAnnotationRequest(a: AnnotationRequest, b: AnnotationRequest): boolean {
	if (a.kind !== b.kind || a.plateSolveJobId !== b.plateSolveJobId) return false
	if (a.kind === 'local') return a.magnitudeLimit === b.magnitudeLimit
	const x = a.bodies ?? ALL_BODIES
	const y = b.bodies ?? ALL_BODIES
	return x.solarSystem === y.solarSystem && x.satellite === y.satellite && x.minorBody === y.minorBody
}

// Returns the latest job of a kind of an image.
export function latestAnnotationJob(state: Pick<AnnotationsState, 'jobs' | 'latest'>, imageId: string, kind: AnnotationKind = 'local'): AnnotationJob | undefined {
	return latestOf(state, annotationKey(imageId, kind))
}

// Returns the fetched result of the latest job of a kind of an image, when it completed.
export function latestAnnotationResult(state: Pick<AnnotationsState, 'jobs' | 'latest' | 'results'>, imageId: string, kind: AnnotationKind = 'local'): AnnotationResult | undefined {
	const job = latestAnnotationJob(state, imageId, kind)
	return job?.state === 'completed' ? state.results[job.jobId] : undefined
}

// Records a job as a job of its kind of its image (trackJob); submitted makes it the latest of its kind of its image, as
// the answer to a submission of this tab, which may be an equivalent earlier job.
function track(state: AnnotationsState, job: AnnotationJob, submitted = false) {
	trackJob(state, job, annotationKey(job.imageId, job.request.kind), submitted)
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

// Submits an annotation of an image. The job, or the equivalent job the server answers, becomes the latest of its kind
// of the image; a refusal is kept in submitErrors.
export async function runAnnotation(state: AnnotationsState, imageId: string, annotation: AnnotationRequest, request: typeof fetch = fetch) {
	const key = annotationKey(imageId, annotation.kind)
	delete state.submitErrors[key]

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/annotations`, jsonInit('POST', annotation))

		if (!response.ok) {
			state.submitErrors[key] = await responseError(response)
			return
		}

		track(state, (await response.json()) as AnnotationJob, true)
	} catch {
		state.submitErrors[key] = 'Unable to reach the server'
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

// What the next run of a document annotates with; the server takes the observation date and site from the image.
export interface AnnotationRequestInput {
	// What is annotated; the local catalog by default.
	readonly kind?: AnnotationKind
	// Faintest magnitude kept.
	readonly magnitudeLimit: number
	// Plate solving job whose solution is used; absent uses the header's WCS.
	readonly plateSolveJobId?: string
	// Groups a solar-system search lists; a local run sends none.
	readonly bodies?: AnnotationBodies
}

// Returns the request of a run: the groups of the bodies only for a solar-system search.
export function annotationRequest({ kind = 'local', magnitudeLimit, plateSolveJobId, bodies }: AnnotationRequestInput): AnnotationRequest {
	return {
		kind,
		magnitudeLimit,
		...(plateSolveJobId !== undefined && { plateSolveJobId }),
		...(kind === 'solarSystemBodies' && bodies && { bodies: { solarSystem: bodies.solarSystem, satellite: bodies.satellite, minorBody: bodies.minorBody } }),
	}
}

// Designation SBDB is searched with for a minor body SkyBoT listed: its number, or its name or provisional designation.
export function minorBodyQuery(object: Pick<AnnotationObject, 'id'>): string {
	return object.id.replace(/^skybot:/, '')
}

// Looks a minor body SkyBoT listed up in SBDB through the sky API, so it can open in the Sky workspace with its SPK-ID:
// the body when SBDB knows exactly one, or why it cannot be resolved. A match is never guessed from a position.
export async function resolveMinorBody(object: Pick<AnnotationObject, 'id'>, request: typeof fetch = fetch): Promise<MinorBody | string> {
	try {
		const response = await request(`/api/sky/minorbodies/search?q=${encodeURIComponent(minorBodyQuery(object))}`)
		if (!response.ok) return await responseError(response)
		const found = (await response.json()) as MinorBodySearchResponse
		if (found.kind === 'found') return found.body
		return found.kind === 'ambiguous' ? 'SBDB knows several bodies by this designation.' : found.message
	} catch {
		return 'Unable to reach the server'
	}
}

// Fetches once the observation date and site an image header gives, which its annotations use. An image's
// header never changes, so the context is never fetched again; a failed fetch is retried by the next call.
export async function loadAnnotationContext(state: AnnotationsState, imageId: string, request: typeof fetch = fetch) {
	if (fetchedContexts.has(imageId)) return
	fetchedContexts.add(imageId)

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/annotations/context`)
		if (response.ok) state.contexts[imageId] = ref((await response.json()) as AnnotationImageContext)
		else fetchedContexts.delete(imageId)
	} catch {
		fetchedContexts.delete(imageId)
	}
}
