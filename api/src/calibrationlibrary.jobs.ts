import { rm } from 'fs/promises'
import { DEFAULT_MEMORY_BUDGET, type IntegrationErrorCode, type IntegrationFrame, type IntegrationProgress, type IntegrationResult, type MasterWorkerRequest } from './calibrationlibrary.analysis'
import type { CalibrationKind, CalibrationMetadata, CalibrationRecipe, CompatibilityFinding, MasterReference } from './calibrationlibrary.compatibility'
import type { CalibrationLibraryStore } from './calibrationlibrary.store'

// Durable queue of the master jobs of the Calibration Library. A job is written before a request is answered, with the
// exact frames it saw, so it survives a closed tab and a restart: a queued job runs after a restart, while a job that was
// working becomes interrupted and waits for an explicit retry. One master integrates at a time. An automatic job waits
// while a device operation runs, so a wizard's masters never compete with an acquisition, and it holds no device itself.
// A request that repeats a fingerprint meets the job already doing it.

// State of a job:
// - queued: written, not started.
// - validating: checking its frames.
// - integrating: combining rows.
// - publishing: making its product visible.
// - completed, failed, cancelled: ended.
// - interrupted: the process ended while it worked; nothing of it was published.
export type CalibrationJobState = 'queued' | 'validating' | 'integrating' | 'publishing' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

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

// Durable job.
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

// The queue. Every state change is written before it is published.
export class CalibrationJobs {
	// Job on the worker, with what stops it.
	#running?: { readonly jobId: string; readonly controller: AbortController }
	// Next check of the automatic jobs.
	#retry?: Timer
	// Whether the queue was stopped, which starts nothing more.
	#stopped = false

	// Creates the queue, which runs nothing until recover.
	constructor(
		readonly store: CalibrationLibraryStore,
		readonly integrator: Integrator,
		readonly host: JobHost,
		readonly memoryBudget: number = DEFAULT_MEMORY_BUDGET,
	) {}

	// Writes a job and publishes it.
	#save(job: CalibrationJob, patch: Partial<CalibrationJob>) {
		const next = { ...job, ...patch, updatedAt: Date.now() }
		this.store.putJob(next)
		this.host.updated(next)
		return next
	}

	// Brings the jobs of a previous process back: work in progress becomes interrupted, staging nobody owns goes away, and
	// the queue resumes. A job that published right before the crash is completed, because its product is the proof.
	async recover() {
		for (const job of this.store.jobsIn(['validating', 'integrating', 'publishing'])) {
			const master = job.fingerprint === undefined ? undefined : this.store.masterByFingerprint(job.fingerprint)
			if (master) this.#save(job, { state: 'completed', masterId: master.masterId, revision: master.revision })
			else this.#save(job, { state: 'interrupted', error: 'The server stopped while this job was working' })
		}

		const queued = this.store.jobsIn(['queued', 'interrupted'])
		await this.store.removeOrphanStaging(new Set(queued.map(({ jobId }) => jobId)))
		this.pump()
	}

	// Adds a job and starts the queue.
	enqueue(job: CalibrationJob) {
		this.store.putJob(job)
		this.host.updated(job)
		this.pump()
	}

	// Cancels a job that has not ended, and returns it, or undefined when it cannot be cancelled. Staged work is discarded.
	async cancel(jobId: string) {
		const job = this.store.job(jobId)
		if (!job || !ACTIVE_JOB_STATES.includes(job.state)) return undefined
		const running = this.#running?.jobId === jobId
		const cancelled = this.#save(job, { state: 'cancelled' })

		// A running job removes its own staging once its worker is gone, which holds files open until then.
		if (running) this.#running!.controller.abort(new DOMException('Cancelled', 'AbortError'))
		else await rm(this.store.stagingDirectory(jobId), { recursive: true, force: true })

		this.pump()
		return cancelled
	}

	// Queues a failed or interrupted job again, from the start and with the frames it saw. Returns it, or undefined when it
	// cannot be retried.
	async retry(jobId: string) {
		const job = this.store.job(jobId)
		if (!job?.build || (job.state !== 'failed' && job.state !== 'interrupted')) return undefined
		await rm(this.store.stagingDirectory(jobId), { recursive: true, force: true })
		const queued = this.#save(job, { state: 'queued', progress: NO_PROGRESS, error: undefined, code: undefined })
		this.pump()
		return queued
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

		const queued = this.store.jobsIn(['queued']).filter(({ type }) => type === 'master')
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
