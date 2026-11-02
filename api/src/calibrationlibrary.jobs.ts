import { rm } from 'fs/promises'
import type { ImportCandidate } from './calibrationlibrary'
import { DEFAULT_MEMORY_BUDGET, type IntegrationErrorCode, type IntegrationFrame, type IntegrationProgress, type IntegrationResult, type MasterWorkerRequest } from './calibrationlibrary.analysis'
import type { CalibrationKind, CalibrationMetadata, CalibrationRecipe, CompatibilityFinding, MasterReference } from './calibrationlibrary.compatibility'
import type { CalibrationLibraryStore } from './calibrationlibrary.store'

// Jobs of the Calibration Library: the master builds and the import scans of this process, kept in memory only. A job
// outlives the tab that asked for it, never the server: nothing of it is written but the staging of a running build, which
// the next start removes, and a master a wizard asked for is asked again at that start. One master integrates at a time.
// An automatic job waits while a device operation runs, so a wizard's masters never compete with an acquisition, and it
// holds no device itself. A request that repeats a fingerprint meets the job already doing it.

// State of a job:
// - queued: waiting for the worker.
// - validating: checking its frames.
// - integrating: combining rows.
// - publishing: making its product visible.
// - completed, failed, cancelled: ended.
export type CalibrationJobState = 'queued' | 'validating' | 'integrating' | 'publishing' | 'completed' | 'failed' | 'cancelled'

// States of a job that still has work to do.
export const ACTIVE_JOB_STATES: readonly CalibrationJobState[] = ['queued', 'validating', 'integrating', 'publishing']

// What a job does.
export type CalibrationJobType = 'master' | 'import'

// Stable code of a failed job.
export type CalibrationJobErrorCode = IntegrationErrorCode | 'publicationFailed'

// What a master job must build, frozen when it was requested.
export interface MasterBuild {
	// Master it adds a revision to.
	readonly masterId: string
	// Role.
	readonly kind: CalibrationKind
	// Group, and its compatibility key.
	readonly groupId: string
	readonly key: string
	// What is known about the master.
	readonly metadata: CalibrationMetadata
	// Frames, in integration order, as the request saw them.
	readonly frames: readonly IntegrationFrame[]
	// File names of the frames.
	readonly frameNames: readonly string[]
	// How samples are combined.
	readonly recipe: CalibrationRecipe
	// Master corrected out of a flat.
	readonly correction?: MasterReference & { readonly kind: 'bias' | 'darkFlat' }
	// What the operator accepted.
	readonly acknowledged: readonly CompatibilityFinding[]
	// Whether fewer frames than the plan required were accepted on purpose.
	readonly partial: boolean
	// Plan a wizard asked for this master from.
	readonly planId?: string
}

// What an import job scans.
export interface ImportScan {
	// Directory.
	readonly path: string
	// Whether it enters subdirectories.
	readonly recursive: boolean
	// Deepest directory.
	readonly depth?: number
	// Files found.
	readonly found: number
	// Their total size, in bytes.
	readonly bytes: number
	// Whether the limit on files stopped the scan.
	readonly truncated: boolean
	// Frames added to the library once committed.
	readonly committed?: number
}

// Job of this process, kept in memory.
export interface CalibrationJob {
	// Id of the job.
	readonly jobId: string
	// What it does.
	readonly type: CalibrationJobType
	// State.
	readonly state: CalibrationJobState
	// When it was requested, and last changed.
	readonly createdAt: number
	readonly updatedAt: number
	// Whether a wizard requested it.
	readonly automatic: boolean
	// Token of the request that created it.
	readonly token?: string
	// Fingerprint of the product of a master job.
	readonly fingerprint?: string
	// Build of a master job.
	readonly build?: MasterBuild
	// Scan of an import job.
	readonly scan?: ImportScan
	// Files an import job found, with their paths, until it is committed.
	readonly candidates?: readonly ImportCandidate[]
	// Progress of a master job.
	readonly progress: IntegrationProgress
	// Why it failed, with a stable code.
	readonly error?: string
	readonly code?: CalibrationJobErrorCode
	// Revision it published.
	readonly masterId?: string
	readonly revision?: number
}

// What lists and events show of a job: no paths.
export interface CalibrationJobSummary {
	// Id of the job.
	readonly jobId: string
	// What it does.
	readonly type: CalibrationJobType
	// State.
	readonly state: CalibrationJobState
	// When it was requested, and last changed.
	readonly createdAt: number
	readonly updatedAt: number
	// Whether a wizard requested it.
	readonly automatic: boolean
	// Role of the master, its group, and how many frames go in.
	readonly kind?: CalibrationKind
	readonly groupId?: string
	readonly frames?: number
	// Plan a wizard asked for this master from.
	readonly planId?: string
	// Progress of a master job.
	readonly progress: IntegrationProgress
	// Files found by an import job, and frames committed.
	readonly found?: number
	readonly bytes?: number
	readonly truncated?: boolean
	readonly committed?: number
	// Why it failed, with a stable code.
	readonly error?: string
	readonly code?: CalibrationJobErrorCode
	// Master it adds to, and the revision it published.
	readonly masterId?: string
	readonly revision?: number
}

// Empty progress of a new job.
export const NO_PROGRESS: IntegrationProgress = { framesValidated: 0, rowsCombined: 0, rowsTotal: 0, bytesWritten: 0 }

// Ended jobs kept for the snapshot and the tabs; older ended ones are forgotten.
const MAXIMUM_ENDED_JOBS = 100

// Time between checks whether an automatic job may start, in milliseconds.
const AUTOMATIC_RETRY_DELAY = 15000

// Attempts to remove staging a terminated worker may still hold open, and the wait between them, in milliseconds.
const STAGING_REMOVAL_RETRIES = 5
const STAGING_REMOVAL_DELAY = 200

// Removes the server paths of a job.
export function jobSummary(job: CalibrationJob): CalibrationJobSummary {
	const { jobId, type, state, createdAt, updatedAt, automatic, build, scan, progress, error, code, masterId, revision } = job
	return {
		jobId,
		type,
		state,
		createdAt,
		updatedAt,
		automatic,
		kind: build?.kind,
		groupId: build?.groupId,
		frames: build?.frames.length,
		planId: build?.planId,
		progress,
		found: scan?.found,
		bytes: scan?.bytes,
		truncated: scan?.truncated,
		committed: scan?.committed,
		error,
		code,
		masterId: masterId ?? build?.masterId,
		revision,
	}
}

// Runs an integration; the Master integrator, or a stand-in in tests.
export interface Integrator {
	// Resolves with what it left in the staging directory, or rejects with an IntegrationError or the reason of the signal.
	readonly integrate: (request: MasterWorkerRequest, onProgress: (progress: IntegrationProgress) => void, signal: AbortSignal) => Promise<IntegrationResult>
}

// What the library does for the queue.
export interface JobHost {
	// Builds the header and destination of a job.
	readonly request: (job: CalibrationJob, staging: string) => MasterWorkerRequest
	// Revalidates a job and makes its staged product visible, returning its revision. Throws when it cannot.
	readonly publish: (job: CalibrationJob, result: IntegrationResult, staging: string) => Promise<number>
	// Whether a device operation is running, which holds automatic jobs back.
	readonly busy: () => boolean
	// Publishes a change of a job.
	readonly updated: (job: CalibrationJob) => void
}

// The jobs of this process and the queue of the masters. Every change is published as it is recorded.
export class CalibrationJobs {
	// Every job known, in the order they were created.
	readonly #jobs = new Map<string, CalibrationJob>()
	// Job on the worker, with what stops it.
	#running?: { readonly jobId: string; readonly controller: AbortController }
	// Next check of the automatic jobs.
	#retry?: Timer
	// Whether the queue was stopped, which starts nothing more.
	#stopped = false

	// Creates the queue, which runs nothing until start.
	constructor(
		readonly store: CalibrationLibraryStore,
		readonly integrator: Integrator,
		readonly host: JobHost,
		readonly memoryBudget: number = DEFAULT_MEMORY_BUDGET,
	) {}

	// Returns a job, or undefined when this process does not know it.
	get(jobId: string) {
		return this.#jobs.get(jobId)
	}

	// Returns the job a request token created.
	byToken(token: string) {
		return this.#jobs.values().find((job) => job.token === token)
	}

	// Lists jobs in some states, oldest first.
	inStates(states: readonly CalibrationJobState[]) {
		return this.#jobs
			.values()
			.filter(({ state }) => states.includes(state))
			.toArray()
	}

	// Lists the latest jobs, newest first.
	latest(limit: number) {
		return this.#jobs.values().toArray().toReversed().slice(0, limit)
	}

	// Records a job and publishes it. Ended jobs past MAXIMUM_ENDED_JOBS are forgotten, oldest first.
	save(job: CalibrationJob) {
		this.#jobs.set(job.jobId, job)
		this.host.updated(job)

		const ended = this.#jobs
			.values()
			.filter(({ state }) => !ACTIVE_JOB_STATES.includes(state))
			.toArray()
		for (const { jobId } of ended.slice(0, Math.max(0, ended.length - MAXIMUM_ENDED_JOBS))) this.#jobs.delete(jobId)
	}

	// Applies a change to a job, records it, and publishes it.
	#save(job: CalibrationJob, patch: Partial<CalibrationJob>) {
		const next = { ...job, ...patch, updatedAt: Date.now() }
		this.save(next)
		return next
	}

	// Removes the staging a previous process left, since none of its jobs survived it, and starts the queue.
	async start() {
		await this.store.removeStaging()
		this.pump()
	}

	// Adds a job and starts the queue.
	enqueue(job: CalibrationJob) {
		this.save(job)
		this.pump()
	}

	// Stops the job running and any wait, for a server that ends or a test.
	stop() {
		this.#stopped = true
		clearTimeout(this.#retry)
		this.#retry = undefined
		this.#running?.controller.abort(new DOMException('Stopped', 'AbortError'))
	}

	// Starts the oldest job allowed to run, when nothing is running.
	pump() {
		if (this.#running || this.#stopped) return

		const queued = this.inStates(['queued']).filter(({ type }) => type === 'master')
		const job = queued.find(({ automatic }) => !automatic || !this.host.busy())

		if (!job) {
			if (queued.length > 0 && this.#retry === undefined) {
				this.#retry = setTimeout(() => {
					this.#retry = undefined
					this.pump()
				}, AUTOMATIC_RETRY_DELAY)
				this.#retry.unref()
			}

			return
		}

		void this.#run(job)
	}

	// Runs one job to its end. Failures end in the job, never in the queue.
	async #run(queued: CalibrationJob) {
		const controller = new AbortController()
		this.#running = { jobId: queued.jobId, controller }
		const { signal } = controller
		let job = this.#save(queued, { state: 'validating' })

		try {
			const staging = await this.store.createStaging(job.jobId)
			const request = this.host.request(job, staging)

			const result = await this.integrator.integrate(
				request,
				(progress) => {
					if (signal.aborted) return
					const state = progress.rowsTotal > 0 ? 'integrating' : 'validating'
					job = this.#save(job, { state, progress })
				},
				signal,
			)

			signal.throwIfAborted()
			job = this.#save(job, { state: 'publishing' })
			const revision = await this.host.publish(job, result, staging)
			await rm(staging, { recursive: true, force: true })
			this.#save(job, { state: 'completed', masterId: job.build?.masterId, revision })
		} catch (error) {
			if (!signal.aborted) {
				const code = (error as { readonly code?: CalibrationJobErrorCode }).code
				this.#save(job, { state: 'failed', code: code ?? 'processingFailed', error: Error.isError(error) ? error.message : String(error) })
			}

			await rm(this.store.stagingDirectory(job.jobId), { recursive: true, force: true, maxRetries: STAGING_REMOVAL_RETRIES, retryDelay: STAGING_REMOVAL_DELAY }).catch(() => undefined)
		} finally {
			this.#running = undefined
			this.pump()
		}
	}
}
