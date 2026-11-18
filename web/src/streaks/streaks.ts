import type { ServerEvent, StreakDetectionJob, StreakDetectionRequest, StreakDetectionResult, StreakDetectionSnapshot, StreakDetectorSettings } from 'api'
import type { StreakClass } from 'nebulosa/src/imaging/analysis/streak/classification.types'
import { DEFAULT_STREAK_DETECTION_OPTIONS } from 'nebulosa/src/imaging/analysis/streak/types'
import { proxy, ref } from 'valtio'
import { latestOf, trackJob } from '../analysis'
import { type ApiFetch, browserFetch, jsonInit, responseError } from '../http'
import type { Point, Rect } from '../viewer/transform'

// Streak detection jobs of the server as this tab knows them, for the Streak Detection tool of the Images workspace. The
// server runs every job and keeps every result: this store mirrors the compact jobs of its snapshot and streaks:updated
// events, remembers the latest job of each image id, and fetches the full result of a completed job (the streaks and
// their classifications) only when a view needs it. A result is always matched to the image id it measured, so a late
// result never lands on another image. Also holds the bounds the form keeps the minimum length within, and the pure
// geometry of the streak overlay: the segments in view and the streak under a point.

// Mirror of the server's streak detection jobs.
export interface StreaksState {
	// Known jobs, by job id.
	jobs: Record<string, StreakDetectionJob>
	// Latest job of each image, by image id.
	latest: Record<string, string>
	// Fetched results of completed jobs, by job id; kept out of the proxy.
	results: Record<string, StreakDetectionResult>
	// Why the result of a completed job could not be fetched, by job id.
	resultErrors: Record<string, string>
	// Why the latest submission of an image failed, by image id.
	submitErrors: Record<string, string>
}

// Settings of a first run: the toolkit's defaults.
export const DEFAULT_STREAK_SETTINGS: StreakDetectorSettings = { ...DEFAULT_STREAK_DETECTION_OPTIONS }

// Bounds of the minimum length the form accepts, in image pixels: the toolkit raises shorter values to 8 pixels of its
// analysis plane anyway.
export const MIN_LENGTH_LIMITS = { min: 8, max: 100000 } as const

// Display names of the classes.
export const CLASS_LABELS: Readonly<Record<StreakClass, string>> = {
	meteor: 'Meteor',
	satellite: 'Satellite',
	airplane: 'Airplane',
	movingObject: 'Moving object',
	trackingFailure: 'Tracking failure',
	opticalArtifact: 'Optical artifact',
	sensorArtifact: 'Sensor artifact',
	unknown: 'Unknown',
}

// Mirror of the server's streak detection jobs, shared by every component of the tab.
export const streaksState = proxy<StreaksState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {} })

// Jobs whose result is being fetched.
const fetching = new Set<string>()

// Returns settings with the minimum length within MIN_LENGTH_LIMITS; a non-finite one becomes the default.
export function clampStreakSettings({ minLength }: StreakDetectorSettings): StreakDetectorSettings {
	return { minLength: Number.isFinite(minLength) ? Math.min(MIN_LENGTH_LIMITS.max, Math.max(MIN_LENGTH_LIMITS.min, minLength)) : DEFAULT_STREAK_SETTINGS.minLength }
}

// Whether two requests measure the same way, with the same context jobs.
export function sameStreakRequest(a: StreakDetectionRequest, b: StreakDetectionRequest): boolean {
	if (a.plateSolveJobId !== b.plateSolveJobId || a.starDetectionJobId !== b.starDetectionJobId) return false
	for (const key of Object.keys(DEFAULT_STREAK_SETTINGS) as (keyof StreakDetectorSettings)[]) if (a.settings[key] !== b.settings[key]) return false
	return true
}

// Returns the latest job of an image.
export function latestStreakJob(state: Pick<StreaksState, 'jobs' | 'latest'>, imageId: string): StreakDetectionJob | undefined {
	return latestOf(state, imageId)
}

// Returns the fetched result of the latest job of an image, when it completed.
export function latestStreakResult(state: Pick<StreaksState, 'jobs' | 'latest' | 'results'>, imageId: string): StreakDetectionResult | undefined {
	const job = latestStreakJob(state, imageId)
	return job?.state === 'completed' ? state.results[job.jobId] : undefined
}

// Records a job as a job of its image (trackJob); submitted makes it the latest of its image, as the answer to a
// submission of this tab, which may be an equivalent earlier job.
function track(state: StreaksState, job: StreakDetectionJob, submitted = false) {
	trackJob(state, job, job.imageId, submitted)
}

// Applies a server event to the store; other events are ignored.
export function handleStreaksEvent(state: StreaksState, event: ServerEvent) {
	if (event.type === 'streaks:updated') track(state, event.job)
}

// Images whose kept jobs were fetched, or are being fetched, by this tab.
const fetchedImages = new Set<string>()

// Fetches once the completed jobs the server keeps for an image, which may be older than the jobs of the snapshot.
export async function loadImageStreakJobs(state: StreaksState, imageId: string, request: ApiFetch = browserFetch) {
	if (fetchedImages.has(imageId)) return
	fetchedImages.add(imageId)

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/streaks`)
		if (!response.ok) return
		for (const job of (await response.json()) as StreakDetectionJob[]) if (!(job.jobId in state.jobs)) track(state, job)
	} catch {
		fetchedImages.delete(imageId)
	}
}

// Fetches the snapshot of the server's jobs, after the socket (re)opened.
export async function refreshStreaks(state: StreaksState, request: ApiFetch = browserFetch) {
	try {
		const response = await request('/api/streaks')
		if (!response.ok) return
		const snapshot = (await response.json()) as StreakDetectionSnapshot
		for (const job of snapshot.jobs) track(state, job)
	} catch {
		// The next reconnection retries.
	}
}

// Submits a detection of an image. The job, or the equivalent job the server answers, becomes the latest of the image;
// a refusal is kept in submitErrors.
export async function runStreakDetection(state: StreaksState, imageId: string, detection: StreakDetectionRequest, request: ApiFetch = browserFetch) {
	delete state.submitErrors[imageId]

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/streaks`, jsonInit('POST', detection))

		if (!response.ok) {
			state.submitErrors[imageId] = await responseError(response)
			return
		}

		track(state, (await response.json()) as StreakDetectionJob, true)
	} catch {
		state.submitErrors[imageId] = 'Unable to reach the server'
	}
}

// Asks the server to cancel a job; its end arrives as an event.
export async function cancelStreakDetection(jobId: string, request: ApiFetch = browserFetch) {
	try {
		await request(`/api/streaks/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
	} catch {
		// The job state stays as the server reports it.
	}
}

// Fetches the result of a completed job once, unless it is fetched or failed already.
export async function loadStreakResult(state: StreaksState, jobId: string, request: ApiFetch = browserFetch) {
	if (state.results[jobId] || state.resultErrors[jobId] !== undefined || fetching.has(jobId)) return
	fetching.add(jobId)

	try {
		const response = await request(`/api/streaks/${encodeURIComponent(jobId)}/result`)
		if (response.ok) state.results[jobId] = ref((await response.json()) as StreakDetectionResult)
		else state.resultErrors[jobId] = await responseError(response)
	} catch {
		state.resultErrors[jobId] = 'Unable to reach the server'
	} finally {
		fetching.delete(jobId)
	}
}

// Segment of a streak in viewer coordinates, whose origin is the top-left corner of the first pixel: a streak endpoint
// (x, y), a 0-based pixel centre, sits at (x + 0.5, y + 0.5).
export interface StreakSegment {
	// Index of the streak in its result.
	readonly index: number
	// First endpoint, in viewer coordinates.
	readonly start: Point
	// Second endpoint, in viewer coordinates.
	readonly end: Point
}

// Returns the segment of a streak in viewer coordinates.
function segmentOf(result: Pick<StreakDetectionResult, 'streaks'>, index: number): StreakSegment {
	const { start, end } = result.streaks[index]
	return { index, start: { x: start.x + 0.5, y: start.y + 0.5 }, end: { x: end.x + 0.5, y: end.y + 0.5 } }
}

// Returns the segments of the streaks whose bounding box, grown by margin (image pixels), meets a visible region in
// viewer coordinates, in the order of the result.
export function streakSegments(result: Pick<StreakDetectionResult, 'streaks'>, visible: Rect, margin = 0): StreakSegment[] {
	const segments: StreakSegment[] = []

	for (let i = 0; i < result.streaks.length; i++) {
		const segment = segmentOf(result, i)
		const { start, end } = segment
		if (Math.max(start.x, end.x) + margin < visible.x || Math.min(start.x, end.x) - margin > visible.x + visible.width) continue
		if (Math.max(start.y, end.y) + margin < visible.y || Math.min(start.y, end.y) - margin > visible.y + visible.height) continue
		segments.push(segment)
	}

	return segments
}

// Returns the distance from a point to a segment, in the unit of both.
export function segmentDistance(point: Point, start: Point, end: Point): number {
	const dx = end.x - start.x
	const dy = end.y - start.y
	const length = dx * dx + dy * dy
	const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length))
	return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy)
}

// Returns the index of the streak whose segment is the closest to a point in viewer coordinates within radius, in image
// pixels, or undefined when none is. The selected streak wins a tie, then the first one of the result.
export function pickStreak(result: Pick<StreakDetectionResult, 'streaks'>, point: Point, radius: number, selected?: number): number | undefined {
	let best: number | undefined
	let bestDistance = radius

	for (let i = 0; i < result.streaks.length; i++) {
		const { start, end } = segmentOf(result, i)
		const distance = segmentDistance(point, start, end)
		if (distance < bestDistance || (distance === bestDistance && (best === undefined || i === selected))) {
			best = i
			bestDistance = distance
		}
	}

	return best
}
