import type { ImageInfo, ImageProcessingJob, ImageProcessingOperation, ImageProcessingOperationType, ImageProcessingRequest, ImageProcessingSnapshot, ImageProcessingStep, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import { jsonInit, responseError } from '../http'
import { createOperation } from './imageprocessing.catalog'
import { browserIo, documentOf, type ImagesIo, type ImagesState, message, openDerivedImage } from './images'

// Image Processing of the Images workspace, as this tab knows it: the pipeline each document edits, and the mirror of
// the server's pipeline jobs.
//
// The pipeline of a document (ImageProcessingDraft, in its view state, so a camera tab keeps it across its frames and
// a reconnection of its camera) is an ordered list of steps, each enabled or not, that only Run sends: the enabled
// steps, in order, as a deep copy, so editing, reordering, or toggling steps afterwards never changes a submitted
// job. Disabled steps keep their parameters and are never sent.
//
// The server runs every job (imageprocessing.ts of the API); this store mirrors the compact jobs of its snapshot and
// imageProcessing:updated events, never letting a late event take a job back to an earlier stage. The output of a
// job this tab submitted is claimed once, when the job completes, and opens as a new unsaved derived document, the
// active one only when its source still is; a job of another tab is never claimed here.

// Step of a pipeline being edited.
export interface ProcessingDraftStep {
	// Id of the step, unique within the pipeline; names it in the job and in its failure.
	readonly id: string
	// Whether Run applies it; a disabled step keeps its parameters.
	enabled: boolean
	// Operation and its parameters.
	operation: ImageProcessingOperation
}

// Pipeline of a document as the operator edits it.
export interface ImageProcessingDraft {
	// Steps, in order.
	steps: readonly ProcessingDraftStep[]
	// Ids of the steps whose cards are expanded.
	expanded: readonly string[]
	// Operation the Add Operation selector shows.
	adding: ImageProcessingOperationType
	// Latest job Run submitted from this document.
	jobId?: string
	// Why the latest Run was refused.
	submitError?: string
	// Step the latest refusal names.
	submitErrorStepId?: string
}

// Document a job was submitted from by this tab, which claims its output.
export interface ImageProcessingSubmission {
	// Key of the document whose Run submitted it.
	readonly documentKey: string
	// Name of that document, which the derived document names as its source.
	readonly sourceName: string
}

// Mirror of the server's image processing jobs.
export interface ImageProcessingState {
	// Known jobs, by job id.
	jobs: Record<string, ImageProcessingJob>
	// Jobs this tab submitted, by job id.
	submissions: Record<string, ImageProcessingSubmission>
	// Outputs being claimed or claimed, by job id; a job is claimed at most once.
	claims: Record<string, 'pending' | 'claimed'>
	// Why the output of a job could not be claimed, by job id.
	claimErrors: Record<string, string>
}

// Ended jobs of other tabs kept at most.
const MAX_JOBS = 64

// Order of the job states: a job only moves forward through them.
const STATE_RANK: Readonly<Record<ImageProcessingJob['state'], number>> = { queued: 0, running: 1, completed: 2, failed: 2, cancelled: 2 }

// Mirror of the server's image processing jobs, shared by every component of the tab.
export const imageProcessingState = proxy<ImageProcessingState>({ jobs: {}, submissions: {}, claims: {}, claimErrors: {} })

// Adds a step of an operation type with its defaults at the end of a pipeline, enabled and expanded.
export function addStep(draft: ImageProcessingDraft, type: ImageProcessingOperationType) {
	const id = nanoid()
	draft.steps = [...draft.steps, { id, enabled: true, operation: createOperation(type) }]
	draft.expanded = [...draft.expanded, id]
}

// Inserts a copy of a step right after it, with a new id, the same operation and parameters, and the same enabled
// state, expanded.
export function duplicateStep(draft: ImageProcessingDraft, stepId: string) {
	const index = draft.steps.findIndex((step) => step.id === stepId)
	if (index < 0) return
	const { enabled, operation } = draft.steps[index]
	const id = nanoid()
	draft.steps = draft.steps.toSpliced(index + 1, 0, { id, enabled, operation: copyOf(operation) })
	draft.expanded = [...draft.expanded, id]
}

// Removes a step.
export function removeStep(draft: ImageProcessingDraft, stepId: string) {
	draft.steps = draft.steps.filter((step) => step.id !== stepId)
	draft.expanded = draft.expanded.filter((id) => id !== stepId)
}

// Enables or disables a step, keeping its parameters and position.
export function setStepEnabled(draft: ImageProcessingDraft, stepId: string, enabled: boolean) {
	const step = draft.steps.find((s) => s.id === stepId)
	if (step) step.enabled = enabled
}

// Replaces the operation of a step.
export function updateStep(draft: ImageProcessingDraft, stepId: string, operation: ImageProcessingOperation) {
	const step = draft.steps.find((s) => s.id === stepId)
	if (step) step.operation = operation
}

// Moves the step at index from to index to (both clamped to the pipeline), shifting the steps between.
export function moveStep(draft: ImageProcessingDraft, from: number, to: number) {
	const count = draft.steps.length
	if (from < 0 || from >= count) return
	const target = Math.max(0, Math.min(count - 1, to))
	if (target === from) return
	const step = draft.steps[from]
	draft.steps = draft.steps.toSpliced(from, 1).toSpliced(target, 0, step)
}

// Expands a collapsed card or collapses an expanded one, whatever the step's enabled state.
export function toggleExpanded(draft: ImageProcessingDraft, stepId: string) {
	draft.expanded = draft.expanded.includes(stepId) ? draft.expanded.filter((id) => id !== stepId) : [...draft.expanded, stepId]
}

// Returns the steps Run sends: the enabled ones, in order, as a deep copy detached from the draft.
export function enabledSteps(draft: Pick<ImageProcessingDraft, 'steps'>): ImageProcessingStep[] {
	return draft.steps.filter((step) => step.enabled).map(({ id, operation }) => ({ id, operation: copyOf(operation) }))
}

// Returns a plain deep copy of an operation, detached from any proxy.
function copyOf(operation: ImageProcessingOperation): ImageProcessingOperation {
	return JSON.parse(JSON.stringify(operation)) as ImageProcessingOperation
}

// Whether a job is waiting or running.
export function isActive(job: Pick<ImageProcessingJob, 'state'> | undefined): boolean {
	return job?.state === 'queued' || job?.state === 'running'
}

// Records a job unless the known one is further along: a later state, or more steps finished. Returns whether it
// was recorded.
function track(state: ImageProcessingState, job: ImageProcessingJob): boolean {
	const known = state.jobs[job.jobId]

	if (known) {
		const rank = STATE_RANK[known.state]
		if (rank === 2 || STATE_RANK[job.state] < rank || (STATE_RANK[job.state] === rank && job.completedSteps < known.completedSteps)) return false
	}

	state.jobs[job.jobId] = job
	prune(state)
	return true
}

// Forgets the oldest ended jobs of other tabs beyond MAX_JOBS.
function prune(state: ImageProcessingState) {
	const forgettable = Object.values(state.jobs).filter((job) => !isActive(job) && !(job.jobId in state.submissions))
	if (forgettable.length <= MAX_JOBS) return
	forgettable.sort((a, b) => a.queuedAt - b.queuedAt)
	for (const job of forgettable.slice(0, forgettable.length - MAX_JOBS)) delete state.jobs[job.jobId]
}

// Claims the output of a completed job this tab submitted, once, and opens it as a new derived document, active only
// when its source document is the one shown.
async function claim(state: ImageProcessingState, images: ImagesState, jobId: string, io: ImagesIo) {
	const submission = state.submissions[jobId]
	if (state.jobs[jobId]?.state !== 'completed' || !submission || state.claims[jobId]) return
	state.claims[jobId] = 'pending'

	try {
		const response = await io.fetch(`/api/image-processing/${encodeURIComponent(jobId)}/claim`, { method: 'POST' })

		if (!response.ok) {
			state.claimErrors[jobId] = await responseError(response)
			return
		}

		const info = (await response.json()) as ImageInfo
		state.claims[jobId] = 'claimed'
		await openDerivedImage(images, info, submission.sourceName, images.activeKey === submission.documentKey, io)
	} catch (error) {
		state.claimErrors[jobId] = message(error)
	}
}

// Applies a server event to the store, claiming the output of a job of this tab that completed; other events are
// ignored.
export function handleImageProcessingEvent(state: ImageProcessingState, images: ImagesState, event: ServerEvent, io: ImagesIo = browserIo) {
	if (event.type !== 'imageProcessing:updated') return
	if (track(state, event.job)) void claim(state, images, event.job.jobId, io)
}

// Fetches the snapshot of the server's jobs after the socket (re)opened, and claims the outputs of the jobs of this
// tab that completed meanwhile.
export async function refreshImageProcessing(state: ImageProcessingState, images: ImagesState, io: ImagesIo = browserIo) {
	try {
		const response = await io.fetch('/api/image-processing')
		if (!response.ok) return
		const snapshot = (await response.json()) as ImageProcessingSnapshot
		for (const job of snapshot.jobs) track(state, job)
	} catch {
		// The next reconnection retries.
		return
	}

	await Promise.all(Object.keys(state.submissions).map((jobId) => claim(state, images, jobId, io)))
}

// Submits the enabled steps of the pipeline of a document applied to the image it shows. The job becomes the latest of
// the document; a refusal, with the step it names, is kept in its draft.
export async function runProcessing(state: ImageProcessingState, images: ImagesState, documentKey: string, io: ImagesIo = browserIo) {
	const document = documentOf(images, documentKey)
	const draft = images.views[documentKey]?.processing
	if (!document?.info || !draft) return

	const request: ImageProcessingRequest = { steps: enabledSteps(draft) }
	const sourceName = document.name
	draft.submitError = undefined
	draft.submitErrorStepId = undefined

	try {
		const response = await io.fetch(`/api/images/${encodeURIComponent(document.info.id)}/processing`, jsonInit('POST', request))

		if (!response.ok) {
			const body = (await response.json().catch(() => ({}))) as { readonly error?: string; readonly stepId?: string }
			const current = images.views[documentKey]?.processing

			if (current) {
				current.submitError = body.error ?? `${response.status} ${response.statusText}`.trim()
				current.submitErrorStepId = body.stepId
			}

			return
		}

		const job = (await response.json()) as ImageProcessingJob
		state.submissions[job.jobId] = { documentKey, sourceName }
		track(state, job)
		const current = images.views[documentKey]?.processing
		if (current) current.jobId = job.jobId
		// The job may have completed, by its event, before this answer arrived.
		await claim(state, images, job.jobId, io)
	} catch {
		const current = images.views[documentKey]?.processing
		if (current) current.submitError = 'Unable to reach the server'
	}
}

// Asks the server to cancel a job; its end arrives as an event.
export async function cancelProcessing(jobId: string, io: ImagesIo = browserIo) {
	try {
		await io.fetch(`/api/image-processing/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
	} catch {
		// The job state stays as the server reports it.
	}
}
