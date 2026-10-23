import type { AstapStarDetectionSettings, BuiltinStarDetectionSettings, ServerEvent, StarAcceptance, StarDetectionJob, StarDetectionRequest, StarDetectionResult, StarDetectionSettings, StarDetectionSnapshot, StarDetectorProvider } from 'api'
import { proxy, ref } from 'valtio'
import { responseError } from '../http'
import type { Point, Rect } from '../viewer/transform'

// Star detection jobs of the server as this tab knows them, shared by the Images workspace (manual runs and
// the Auto Focus measurements of its frames). The server runs every job and keeps every result: this store
// mirrors the compact jobs of its snapshot and stars:updated events, remembers the latest job of each image
// id, and fetches the full result of a completed job (the stars) only when a view needs it, so the frames of
// a loop nobody looks at are never downloaded. A result is always matched to the image id it measured, so
// a late result never lands on another image. Also holds the pure geometry of the star overlay: picking the
// star under a point and the outline paths of the markers.

// Mirror of the server's star detection jobs.
export interface StarsState {
	// Known jobs, by job id.
	jobs: Record<string, StarDetectionJob>
	// Latest job of each image, by image id.
	latest: Record<string, string>
	// Fetched results of completed jobs, by job id; kept out of the proxy, since they hold thousands of stars.
	results: Record<string, StarDetectionResult>
	// Why the result of a completed job could not be fetched, by job id.
	resultErrors: Record<string, string>
	// Why the latest submission of an image failed, by image id.
	submitErrors: Record<string, string>
}

// Display names of the detectors.
export const PROVIDER_LABELS: Readonly<Record<StarDetectorProvider, string>> = { builtin: 'Built-in', astap: 'ASTAP' }

// Detectors, in selector order.
export const PROVIDERS: readonly StarDetectorProvider[] = ['builtin', 'astap']

// Defaults of the built-in detector, as the server's: the 500 brightest stars, any SNR, no uniqueness filter.
export const DEFAULT_BUILTIN_SETTINGS: BuiltinStarDetectionSettings = { provider: 'builtin', maxStars: 500, minSNR: 0, searchRegion: 0 }

// Defaults of ASTAP, as the server's: every star of SNR 10 or more.
export const DEFAULT_ASTAP_SETTINGS: AstapStarDetectionSettings = { provider: 'astap', maxStars: 0, minSNR: 10 }

// Acceptance of every star with finite, positive measurements inside the image.
export const DEFAULT_STAR_ACCEPTANCE: StarAcceptance = { minSNR: 0, minHfd: 0, maxHfd: 0, edgeMargin: 0 }

// Request of a first run: the built-in detector with its defaults.
export const DEFAULT_STAR_REQUEST: StarDetectionRequest = { detector: DEFAULT_BUILTIN_SETTINGS, acceptance: DEFAULT_STAR_ACCEPTANCE }

// Most stars the built-in detector returns (BUILTIN_STAR_LIMIT of the API).
export const BUILTIN_STAR_LIMIT = 2000

// Jobs kept at most; the oldest ended ones beyond it that are not the latest of an image are forgotten.
const MAX_JOBS = 256

// Fetched results kept at most beyond those of the latest job of an image.
const MAX_RESULTS = 8

// Mirror of the server's star detection jobs, shared by every component of the tab.
export const starsState = proxy<StarsState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {} })

// Jobs whose result is being fetched.
const fetching = new Set<string>()

// Returns the default settings of a detector.
export function defaultSettings(provider: StarDetectorProvider): StarDetectionSettings {
	return provider === 'builtin' ? DEFAULT_BUILTIN_SETTINGS : DEFAULT_ASTAP_SETTINGS
}

// Returns a request switched to a detector with its default settings; the request itself when it uses it.
export function withProvider(request: StarDetectionRequest, provider: StarDetectorProvider): StarDetectionRequest {
	return request.detector.provider === provider ? request : { ...request, detector: { ...defaultSettings(provider) } }
}

// Settings of a detector a control edits; searchRegion applies to the built-in detector only.
export interface StarDetectorPatch {
	// Maximum number of stars kept.
	readonly maxStars?: number
	// Minimum SNR of a detection.
	readonly minSNR?: number
	// Uniqueness box of the built-in detector, in pixels.
	readonly searchRegion?: number
}

// Returns a request with settings of its detector replaced; a field its detector does not have is ignored.
export function withDetectorSettings(request: StarDetectionRequest, { maxStars, minSNR, searchRegion }: StarDetectorPatch): StarDetectionRequest {
	const { detector } = request
	const common = { maxStars: maxStars ?? detector.maxStars, minSNR: minSNR ?? detector.minSNR }
	return { ...request, detector: detector.provider === 'builtin' ? { ...detector, ...common, searchRegion: searchRegion ?? detector.searchRegion } : { ...detector, ...common } }
}

// Returns a request with acceptance criteria replaced.
export function withAcceptance(request: StarDetectionRequest, patch: Partial<StarAcceptance>): StarDetectionRequest {
	return { ...request, acceptance: { ...request.acceptance, ...patch } }
}

// Whether a job is waiting or running.
export function isActive(job: Pick<StarDetectionJob, 'state'> | undefined): boolean {
	return job?.state === 'queued' || job?.state === 'running'
}

// Whether two requests measure the same way.
export function sameRequest(a: StarDetectionRequest, b: StarDetectionRequest): boolean {
	return sameFields(a.detector, b.detector) && sameFields(a.acceptance, b.acceptance)
}

// Whether two flat records hold the same fields with the same values, whatever their order.
function sameFields<T extends object>(a: T, b: T): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof T>
	for (const key of keys) if (a[key] !== b[key]) return false
	return true
}

// Returns the latest job of an image.
export function latestJob(state: Pick<StarsState, 'jobs' | 'latest'>, imageId: string): StarDetectionJob | undefined {
	const jobId = state.latest[imageId]
	return jobId === undefined ? undefined : state.jobs[jobId]
}

// Returns the fetched result of the latest job of an image, when it completed.
export function latestResult(state: Pick<StarsState, 'jobs' | 'latest' | 'results'>, imageId: string): StarDetectionResult | undefined {
	const job = latestJob(state, imageId)
	return job?.state === 'completed' ? state.results[job.jobId] : undefined
}

// Records a job. A job seen for the first time becomes the latest of its image unless a newer one is known;
// a job already known never takes it back, so an update or a snapshot cannot undo a submission. submitted
// makes the job the latest whatever its age, as the answer to a submission of this tab, which may be the
// earlier completed job of an equivalent request.
function track(state: StarsState, job: StarDetectionJob, submitted = false) {
	const known = job.jobId in state.jobs
	state.jobs[job.jobId] = job
	const latest = latestJob(state, job.imageId)
	if (submitted || !latest || (!known && latest.queuedAt <= job.queuedAt)) state.latest[job.imageId] = job.jobId
	prune(state)
}

// Forgets the oldest ended jobs beyond MAX_JOBS and the oldest results beyond MAX_RESULTS, never those of the
// latest job of an image.
function prune(state: StarsState) {
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
export function handleStarsEvent(state: StarsState, event: ServerEvent) {
	if (event.type === 'stars:updated') track(state, event.job)
}

// Images whose kept jobs were fetched, or are being fetched, by this tab.
const fetchedImages = new Set<string>()

// Fetches once the completed jobs the server keeps for an image, such as the Auto Focus measurement of a frame
// shown later, which may be older than the jobs of the snapshot.
export async function loadImageJobs(state: StarsState, imageId: string, request: typeof fetch = fetch) {
	if (fetchedImages.has(imageId)) return
	fetchedImages.add(imageId)

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/stars`)
		if (!response.ok) return
		for (const job of (await response.json()) as StarDetectionJob[]) if (!(job.jobId in state.jobs)) track(state, job)
	} catch {
		fetchedImages.delete(imageId)
	}
}

// Fetches the snapshot of the server's jobs, after the socket (re)opened.
export async function refreshStars(state: StarsState, request: typeof fetch = fetch) {
	try {
		const response = await request('/api/stars')
		if (!response.ok) return
		const snapshot = (await response.json()) as StarDetectionSnapshot
		for (const job of snapshot.jobs) track(state, job)
	} catch {
		// The next reconnection retries.
	}
}

// Submits a detection of an image. The job, or the completed job of an equivalent earlier detection,
// becomes the latest of the image; a refusal is kept in submitErrors.
export async function runDetection(state: StarsState, imageId: string, detection: StarDetectionRequest, request: typeof fetch = fetch) {
	delete state.submitErrors[imageId]

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/stars`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(detection) })

		if (!response.ok) {
			state.submitErrors[imageId] = await responseError(response)
			return
		}

		track(state, (await response.json()) as StarDetectionJob, true)
	} catch {
		state.submitErrors[imageId] = 'Unable to reach the server'
	}
}

// Asks the server to cancel a job; its end arrives as an event.
export async function cancelDetection(jobId: string, request: typeof fetch = fetch) {
	try {
		await request(`/api/stars/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
	} catch {
		// The job state stays as the server reports it.
	}
}

// Fetches the result of a completed job once, unless it is fetched or failed already.
export async function loadResult(state: StarsState, jobId: string, request: typeof fetch = fetch) {
	if (state.results[jobId] || state.resultErrors[jobId] !== undefined || fetching.has(jobId)) return
	fetching.add(jobId)

	try {
		const response = await request(`/api/stars/${encodeURIComponent(jobId)}/result`)
		if (response.ok) state.results[jobId] = ref((await response.json()) as StarDetectionResult)
		else state.resultErrors[jobId] = await responseError(response)
	} catch {
		state.resultErrors[jobId] = 'Unable to reach the server'
	} finally {
		fetching.delete(jobId)
	}
}

// Returns the index of the star whose centre is the closest to an image point within radius, in image
// pixels, or undefined when none is. The point is in viewer coordinates, whose origin is the top-left
// corner of the first pixel, while star centres are 0-based pixel indices, so a centre (x, y) sits at
// (x + 0.5, y + 0.5). Rejected stars are skipped when acceptedOnly.
export function pickStar(result: Pick<StarDetectionResult, 'stars' | 'accepted'>, point: Point, radius: number, acceptedOnly: boolean): number | undefined {
	let best: number | undefined
	let bestDistance = radius * radius

	for (let i = 0; i < result.stars.length; i++) {
		if (acceptedOnly && !result.accepted[i]) continue
		const { x, y } = result.stars[i]
		const distance = (x + 0.5 - point.x) ** 2 + (y + 0.5 - point.y) ** 2

		if (distance <= bestDistance) {
			best = i
			bestDistance = distance
		}
	}

	return best
}

// Outline paths of the star markers, one per class, in viewer coordinates.
export interface StarPaths {
	// Circles of the accepted stars.
	readonly accepted: string
	// Circles of the rejected stars; empty when acceptedOnly.
	readonly rejected: string
}

// Returns the radius of the marker of a star, in image pixels: its HFD, so a defocused star gets a larger
// circle, but never under minRadius (a constant size on screen at any zoom).
export function markerRadius(hfd: number, minRadius: number): number {
	return Number.isFinite(hfd) ? Math.max(hfd, minRadius) : minRadius
}

// Returns the circles of the stars whose markers intersect a visible region of the image, as one SVG path
// per class, so thousands of stars draw as two elements and those outside the view cost nothing. minRadius
// is in image pixels; the region is in viewer coordinates.
export function starPaths(result: Pick<StarDetectionResult, 'stars' | 'accepted'>, acceptedOnly: boolean, visible: Rect, minRadius: number): StarPaths {
	const accepted: string[] = []
	const rejected: string[] = []

	for (let i = 0; i < result.stars.length; i++) {
		const isAccepted = result.accepted[i]
		if (acceptedOnly && !isAccepted) continue
		const { x, y, hfd } = result.stars[i]
		const r = markerRadius(hfd, minRadius)
		const cx = x + 0.5
		const cy = y + 0.5
		if (cx + r < visible.x || cx - r > visible.x + visible.width || cy + r < visible.y || cy - r > visible.y + visible.height) continue
		const circle = `M${(cx - r).toFixed(2)} ${cy.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`
		;(isAccepted ? accepted : rejected).push(circle)
	}

	return { accepted: accepted.join(''), rejected: rejected.join('') }
}
