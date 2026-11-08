import type { ImageRect, ImageStatisticsJob, ImageStatisticsReport, ImageStatisticsRequest, ImageStatisticsSnapshot, ServerEvent } from 'api'
import { proxy, ref } from 'valtio'
import { type AnalysisJobs, isActive, latestOf, trackJob } from '../analysis'
import { jsonInit, responseError } from '../http'

// Image statistics jobs of the server as this tab knows them, for the Histogram and Statistics section of the Image
// Inspector. The server runs every scan and keeps every result: this store mirrors the compact jobs of its snapshot and
// statistics:updated events, remembers the latest job of each image and area (statisticsKey), and fetches the full
// result (the planes and their histograms) only when the section shows it. A result is always looked up by the image id
// and area it measured, so a result of an earlier camera frame or another area never lands on the one shown. Each
// document submits at most one scan at a time: a camera tab following its latest frame measures the frame shown once
// its scan ends, skipping the frames that came meanwhile.

// Mirror of the server's image statistics jobs.
export interface StatisticsState extends AnalysisJobs<ImageStatisticsJob, ImageStatisticsReport> {
	// Why the latest submission of an image and area failed, by statisticsKey.
	submitErrors: Record<string, string>
	// Latest job each document submitted, by document key.
	submitted: Record<string, string>
}

// Mirror of the server's image statistics jobs, shared by every component of the tab.
export const statisticsState = proxy<StatisticsState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {}, submitted: {} })

// Keys of the submissions on their way to the server.
const submitting = new Set<string>()

// Jobs whose result is being fetched.
const fetching = new Set<string>()

// Returns the key of the jobs of an image and area: the image id and the rectangle, or the whole image.
export function statisticsKey(imageId: string, area?: ImageRect): string {
	return area ? `${imageId}:${area.left},${area.top},${area.width},${area.height}` : `${imageId}:full`
}

// Returns the latest job of an image and area.
export function latestStatistics(state: Pick<StatisticsState, 'jobs' | 'latest'>, imageId: string, area?: ImageRect): ImageStatisticsJob | undefined {
	return latestOf(state, statisticsKey(imageId, area))
}

// Whether the latest scan a document submitted is still waiting or running.
export function submittedActive(state: Pick<StatisticsState, 'jobs' | 'submitted'>, documentKey: string): boolean {
	const jobId = state.submitted[documentKey]
	return jobId !== undefined && isActive(state.jobs[jobId])
}

// Whether a scan of an image and area is being submitted.
export function isSubmitting(imageId: string, area?: ImageRect): boolean {
	return submitting.has(statisticsKey(imageId, area))
}

// Records a job under its image and area (trackJob); submitted makes it the latest, as the answer to a submission of
// this tab, which may be the completed job of an equivalent earlier scan.
function track(state: StatisticsState, job: ImageStatisticsJob, submitted = false) {
	trackJob(state, job, statisticsKey(job.imageId, job.request.area), submitted)
}

// Applies a server event to the store; other events are ignored.
export function handleStatisticsEvent(state: StatisticsState, event: ServerEvent) {
	if (event.type === 'statistics:updated') track(state, event.job)
}

// Fetches the snapshot of the server's jobs, after the socket (re)opened.
export async function refreshStatistics(state: StatisticsState, request: typeof fetch = fetch) {
	try {
		const response = await request('/api/statistics')
		if (!response.ok) return
		const snapshot = (await response.json()) as ImageStatisticsSnapshot
		for (const job of snapshot.jobs) track(state, job)
	} catch {
		// The next reconnection retries.
	}
}

// Submits a scan of an image, whole or of an area, for a document. The job, or the completed job of an equivalent
// earlier scan, becomes the latest of the image and area and the one the document waits for; a refusal is kept in
// submitErrors. A submission of the same image and area already on its way is not sent again.
export async function runStatistics(state: StatisticsState, documentKey: string, imageId: string, area?: ImageRect, request: typeof fetch = fetch) {
	const key = statisticsKey(imageId, area)
	if (submitting.has(key)) return
	submitting.add(key)
	delete state.submitErrors[key]

	try {
		const response = await request(`/api/images/${encodeURIComponent(imageId)}/statistics`, jsonInit('POST', (area ? { area } : {}) satisfies ImageStatisticsRequest))

		if (!response.ok) {
			state.submitErrors[key] = await responseError(response)
			return
		}

		const job = (await response.json()) as ImageStatisticsJob
		track(state, job, true)
		state.submitted[documentKey] = job.jobId
		// A result fetched earlier that failed, such as one the server no longer kept, is fetched again.
		delete state.resultErrors[job.jobId]
	} catch {
		state.submitErrors[key] = 'Unable to reach the server'
	} finally {
		submitting.delete(key)
	}
}

// Asks the server to cancel a job; its end arrives as an event.
export async function cancelStatistics(jobId: string, request: typeof fetch = fetch) {
	try {
		await request(`/api/statistics/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
	} catch {
		// The job state stays as the server reports it.
	}
}

// Fetches the result of a completed job once, unless it is fetched or failed already.
export async function loadStatisticsResult(state: StatisticsState, jobId: string, request: typeof fetch = fetch) {
	if (state.results[jobId] || state.resultErrors[jobId] !== undefined || fetching.has(jobId)) return
	fetching.add(jobId)

	try {
		const response = await request(`/api/statistics/${encodeURIComponent(jobId)}/result`)
		if (response.ok) state.results[jobId] = ref((await response.json()) as ImageStatisticsReport)
		else state.resultErrors[jobId] = await responseError(response)
	} catch {
		state.resultErrors[jobId] = 'Unable to reach the server'
	} finally {
		fetching.delete(jobId)
	}
}

// What a document shows of the statistics of its image and area, and whether it should submit a scan.
export interface StatisticsView {
	// Latest job of the image and area.
	readonly job?: ImageStatisticsJob
	// Its result, once completed and fetched.
	readonly result?: ImageStatisticsReport
	// Why the submission, the job, or the fetch of its result failed.
	readonly error?: string
	// Whether a scan should be submitted now: the section is open, the image is ready, nothing was measured or failed
	// for this image and area, and the document waits for no other scan.
	readonly due: boolean
}

// Returns what a document shows of the statistics of an image and area. open is whether the section is expanded.
export function statisticsView(state: Pick<StatisticsState, 'jobs' | 'latest' | 'results' | 'resultErrors' | 'submitErrors' | 'submitted'>, documentKey: string, imageId: string | undefined, area: ImageRect | undefined, open: boolean): StatisticsView {
	if (imageId === undefined) return { due: false }
	const key = statisticsKey(imageId, area)
	const job = latestOf(state, key)
	const result = job?.state === 'completed' ? state.results[job.jobId] : undefined
	const error = state.submitErrors[key] ?? (job?.state === 'failed' || job?.state === 'cancelled' ? (job.error ?? 'The scan did not complete') : job && state.resultErrors[job.jobId])
	const due = open && job === undefined && error === undefined && !submittedActive(state, documentKey)
	return { job, result, error, due }
}
