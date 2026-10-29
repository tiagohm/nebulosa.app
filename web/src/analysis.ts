import type { AnalysisJob, AnalysisJobState } from 'api'

// Bookkeeping shared by the mirrors of the image analyses of the server (star detection, streak detection, plate
// solving, annotation): the jobs the tab knows, the latest job of each image (or of each kind of an image, as its
// store keys it), and the fetched results of completed jobs, bounded so a long session keeps a constant footprint. The
// state of a known job only moves forward, so a snapshot fetched before an event, or the answer to a submission
// arriving after the events of a fast job, never takes an ended job back to waiting or running.

// Jobs kept at most; the oldest ended ones beyond it that are not the latest of an image are forgotten.
const MAX_JOBS = 256

// Fetched results kept at most beyond those of the latest jobs.
const MAX_RESULTS = 8

// Order of the states of a job: waiting, running, then ended.
const STATE_ORDER: Readonly<Record<AnalysisJobState, number>> = { queued: 0, running: 1, completed: 2, failed: 2, cancelled: 2 }

// Jobs of one analysis as the tab mirrors them; J is the published job, R its full result.
export interface AnalysisJobs<J extends AnalysisJob, R> {
	// Known jobs, by job id.
	jobs: Record<string, J>
	// Latest job of each image, or of each kind of an image, by the key its store gives it.
	latest: Record<string, string>
	// Fetched results of completed jobs, by job id; kept out of the proxy by the stores.
	results: Record<string, R>
	// Why the result of a completed job could not be fetched, by job id.
	resultErrors: Record<string, string>
}

// Whether a job is waiting or running.
export function isActive(job: Pick<AnalysisJob, 'state'> | undefined): boolean {
	return job?.state === 'queued' || job?.state === 'running'
}

// Returns the job recorded as the latest under key, if any.
export function latestOf<J extends AnalysisJob, R>(state: Pick<AnalysisJobs<J, R>, 'jobs' | 'latest'>, key: string): J | undefined {
	const jobId = state.latest[key]
	return jobId === undefined ? undefined : state.jobs[jobId]
}

// Records a job, then forgets what exceeds the bounds. A known job is replaced only by a state at least as far along,
// so the latest values of a running job are kept and an ended job stays ended. A job seen for the first time becomes
// the latest under key unless a newer one is known; a job already known never takes it back, so an update or a
// snapshot cannot undo a submission. submitted makes the job the latest whatever its age, as the answer to a submission
// of this tab, which may be an equivalent earlier job.
export function trackJob<J extends AnalysisJob, R>(state: AnalysisJobs<J, R>, job: J, key: string, submitted = false) {
	const known = state.jobs[job.jobId]
	if (!known || STATE_ORDER[job.state] >= STATE_ORDER[known.state]) state.jobs[job.jobId] = job
	const latest = latestOf(state, key)
	if (submitted || !latest || (!known && latest.queuedAt <= job.queuedAt)) state.latest[key] = job.jobId
	pruneJobs(state)
}

// Forgets the oldest ended jobs beyond MAX_JOBS and the oldest results beyond MAX_RESULTS, never those of a latest
// job, and the latest entries of forgotten jobs.
function pruneJobs<J extends AnalysisJob, R>(state: AnalysisJobs<J, R>) {
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

	for (const [key, jobId] of Object.entries(state.latest)) if (!state.jobs[jobId]) delete state.latest[key]
}
