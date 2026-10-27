import type { ImageInfo, ImageProcessingJob } from 'api'
import { cn } from 'cn'
import { Fragment, type PointerEvent, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Actions, Notice } from '../equipment-control/parts'
import { PanelSection } from '../shell/ContextualPanel'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { useNow } from '../useNow'
import { addStep, cancelProcessing, duplicateStep, enabledSteps, type ImageProcessingDraft, imageProcessingState, isActive, moveStep, removeStep, runProcessing, setStepEnabled, toggleExpanded, updateStep } from './imageprocessing'
import { OPERATION_TYPES, OPERATIONS, operationLabel, pipelineIssue } from './imageprocessing.catalog'
import { type ImageDocument, imagesState, imageUnavailableReason } from './images'
import { ProcessingStepCard } from './ProcessingStepCard'
import type { ImageToolPanelProps } from './tools'

// Image Processing tool of the Images workspace: the pipeline of the active document as a list of step cards, which the
// operator adds, reorders (by dragging a card's handle, or with its Move actions and Alt+↑/↓), enables, disables,
// edits, duplicates, and removes, and Run Pipeline, which sends the enabled steps to the server to be applied to the
// scientific pixels of the image the document shows. The job runs on the server, so switching tool, tab, or profile, or
// collapsing the panel, never stops it; only Stop Processing does. Its output opens as a new unsaved derived document;
// the source never changes. There is no preview: running again, with the steps edited, makes another document.

// Display names of the job states.
const STATE_LABELS: Readonly<Record<ImageProcessingJob['state'], string>> = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }

// Image Processing panel of the active document.
export function ImageProcessingPanel({ document, view, onOpen }: ImageToolPanelProps) {
	if (!document) {
		return (
			<EmptyState
				title="No image open"
				action={
					<Button variant="secondary" onClick={onOpen}>
						Open Image
					</Button>
				}
			/>
		)
	}

	return view ? <ImageProcessing document={document} draft={view.processing} /> : null
}

interface ImageProcessingProps {
	// Document whose pipeline is edited.
	readonly document: ImageDocument
	// Its pipeline, as shown.
	readonly draft: ImageProcessingDraft
}

// Sections of the Image Processing panel of a document.
function ImageProcessing({ document, draft }: ImageProcessingProps) {
	const { jobs, claimErrors } = useSnapshot(imageProcessingState)
	const job = draft.jobId === undefined ? undefined : jobs[draft.jobId]
	const active = isActive(job)
	const steps = enabledSteps(draft)
	const issue = document.info && pipelineIssue(document.info, steps)
	const failedStepId = job?.state === 'failed' ? job.errorStepId : undefined
	const runningStepId = job?.state === 'running' && job.currentStepIndex !== undefined ? job.steps[job.currentStepIndex]?.id : undefined

	// Returns why a step cannot run, or why it failed in the latest run or submission.
	function stepError(stepId: string): string | undefined {
		if (issue?.stepId === stepId) return issue.error
		if (draft.submitErrorStepId === stepId) return draft.submitError
		if (failedStepId === stepId) return job?.error
		return undefined
	}

	return (
		<>
			<ImageSection document={document} job={job} />
			<Pipeline documentKey={document.key} draft={draft} stepError={stepError} runningStepId={runningStepId} />
			<RunSection document={document} draft={draft} job={job} active={active} enabledCount={steps.length} blocker={runBlocker(document, draft, steps.length, active, issue?.error)} claimError={job ? claimErrors[job.jobId] : undefined} />
		</>
	)
}

// Returns why Run Pipeline is disabled: the document has no image, a pipeline of it is running, no step is enabled, or a
// step cannot apply to the image it would receive; undefined when it can run.
function runBlocker(document: ImageDocument, draft: ImageProcessingDraft, enabledCount: number, active: boolean, issue: string | undefined): string | undefined {
	const unavailable = imageUnavailableReason(document)
	if (unavailable) return unavailable
	if (active) return 'A pipeline of this document is running.'
	if (draft.steps.length === 0) return 'Add an operation first.'
	if (enabledCount === 0) return 'Enable at least one step.'
	return issue
}

// Returns how an image is laid out: mono, a CFA mosaic and its pattern, or RGB.
function imageKind(info: ImageInfo): string {
	if (info.channels === 3) return 'RGB'
	return info.cfa ? `CFA mosaic (${info.cfa})` : 'Mono'
}

interface ImageSectionProps {
	// Document shown.
	readonly document: ImageDocument
	// Latest job of its pipeline.
	readonly job?: ImageProcessingJob
}

// Name, size, and layout of the image a run would process; on a camera tab, which frame that is.
function ImageSection({ document, job }: ImageSectionProps) {
	const { info } = document
	const earlierFrame = isActive(job) && job && info && job.imageId !== info.id

	return (
		<PanelSection title="Image">
			<Property label="Name">{document.name}</Property>
			{info ? (
				<>
					<Property label="Size">
						{info.width} × {info.height} px
					</Property>
					<Property label="Layout">{imageKind(info)}</Property>
				</>
			) : (
				<Notice>{imageUnavailableReason(document)} The pipeline can be edited meanwhile.</Notice>
			)}
			{document.source.kind === 'camera' && <Notice>Run processes the frame shown when it starts; newer frames never change a run.</Notice>}
			{earlierFrame && <Notice>The running pipeline processes an earlier frame of this camera.</Notice>}
		</PanelSection>
	)
}

interface PipelineProps {
	// Key of the document.
	readonly documentKey: string
	// Its pipeline, as shown.
	readonly draft: ImageProcessingDraft
	// Returns why a step cannot run or failed.
	readonly stepError: (stepId: string) => string | undefined
	// Step the running job applies.
	readonly runningStepId?: string
}

// Drag of a card by its handle: the step dragged, its index, and the index it would move to among the other steps.
interface Drag {
	// Id of the step dragged.
	readonly stepId: string
	// Its index in the pipeline.
	readonly from: number
	// Index it would take, among the other steps.
	readonly to: number
}

// Cards of the steps, in order, and the Add Operation control.
function Pipeline({ documentKey, draft, stepError, runningStepId }: PipelineProps) {
	const cards = useRef(new Map<string, HTMLLIElement>())
	const dragRef = useRef<Drag>(undefined)
	const [drag, setDrag] = useState<Drag>()
	// Step whose handle gets the focus back after a keyboard move, which moves its card.
	const [focusStep, setFocusStep] = useState<string>()

	// The pipeline as the store holds it, for edits.
	const edit = () => imagesState.views[documentKey]?.processing

	useEffect(() => {
		if (focusStep === undefined) return
		cards.current.get(focusStep)?.querySelector('button')?.focus()
		setFocusStep(undefined)
	}, [focusStep])

	// Returns the index a dragged step would take among the other steps at a vertical position: the number of other
	// cards whose middle is above it.
	function targetIndex(stepId: string, clientY: number): number {
		let index = 0

		for (const step of draft.steps) {
			if (step.id === stepId) continue
			const rect = cards.current.get(step.id)?.getBoundingClientRect()
			if (rect && rect.top + rect.height / 2 < clientY) index++
		}

		return index
	}

	// Starts dragging a card from its handle, following the pointer until it is released, which moves the step.
	function startDrag(event: PointerEvent<HTMLButtonElement>, stepId: string, from: number) {
		if (event.button !== 0) return
		const handle = event.currentTarget
		handle.setPointerCapture(event.pointerId)
		dragRef.current = { stepId, from, to: from }
		setDrag(dragRef.current)

		const onMove = (e: globalThis.PointerEvent) => {
			const current = dragRef.current
			if (!current) return
			const to = targetIndex(stepId, e.clientY)
			if (to === current.to) return
			dragRef.current = { ...current, to }
			setDrag(dragRef.current)
		}

		const onEnd = (e: globalThis.PointerEvent) => {
			handle.removeEventListener('pointermove', onMove)
			handle.removeEventListener('pointerup', onEnd)
			handle.removeEventListener('pointercancel', onEnd)
			const current = dragRef.current
			dragRef.current = undefined
			setDrag(undefined)
			const pipeline = edit()
			if (current && e.type === 'pointerup' && pipeline) moveStep(pipeline, current.from, current.to)
		}

		handle.addEventListener('pointermove', onMove)
		handle.addEventListener('pointerup', onEnd)
		handle.addEventListener('pointercancel', onEnd)
	}

	// Index, among the other steps, before which the insertion line is drawn while dragging.
	let others = 0

	return (
		<PanelSection title="Pipeline">
			{draft.steps.length === 0 ? (
				<Notice>Add operations to build the pipeline. Run applies the enabled steps in order to a copy of the image.</Notice>
			) : (
				<ol className="m-0 flex list-none flex-col gap-1.5 p-0">
					{draft.steps.map((step, index) => {
						const dragged = drag?.stepId === step.id
						const line = drag !== undefined && !dragged && others === drag.to && drag.to !== drag.from
						if (!dragged) others++
						const last = index === draft.steps.length - 1 && drag !== undefined && drag.to === draft.steps.length - 1 && drag.to !== drag.from && !dragged

						return (
							<Fragment key={step.id}>
								{line && <InsertionLine />}
								<ProcessingStepCard
									step={step}
									index={index}
									count={draft.steps.length}
									expanded={draft.expanded.includes(step.id)}
									dragging={dragged}
									error={stepError(step.id)}
									running={runningStepId === step.id}
									cardRef={(element) => {
										if (element) cards.current.set(step.id, element)
										else cards.current.delete(step.id)
									}}
									onDragStart={(event) => startDrag(event, step.id, index)}
									onMove={(offset) => {
										const pipeline = edit()
										if (!pipeline) return
										moveStep(pipeline, index, index + offset)
										setFocusStep(step.id)
									}}
									onEnabledChange={(enabled) => {
										const pipeline = edit()
										if (pipeline) setStepEnabled(pipeline, step.id, enabled)
									}}
									onToggleExpanded={() => {
										const pipeline = edit()
										if (pipeline) toggleExpanded(pipeline, step.id)
									}}
									onChange={(operation) => {
										const pipeline = edit()
										if (pipeline) updateStep(pipeline, step.id, operation)
									}}
									onDuplicate={() => {
										const pipeline = edit()
										if (pipeline) duplicateStep(pipeline, step.id)
									}}
									onRemove={() => {
										const pipeline = edit()
										if (pipeline) removeStep(pipeline, step.id)
									}}
								/>
								{last && <InsertionLine />}
							</Fragment>
						)
					})}
				</ol>
			)}
			<div className="flex items-end gap-2">
				<Select
					label="Operation"
					className="min-w-0 flex-1"
					options={OPERATION_TYPES}
					value={draft.adding}
					format={operationLabel}
					group={(type) => OPERATIONS[type].group}
					onChange={(type) => {
						const pipeline = edit()
						if (pipeline) pipeline.adding = type
					}}
				/>
				<Button
					variant="secondary"
					title={`Add ${operationLabel(draft.adding)} at the end`}
					onClick={() => {
						const pipeline = edit()
						if (pipeline) addStep(pipeline, pipeline.adding)
					}}
				>
					<Icon name="plus" className="size-4" />
					Add
				</Button>
			</div>
		</PanelSection>
	)
}

// Line marking where a dragged card would be dropped.
function InsertionLine() {
	return <li className="h-0.5 rounded-full bg-accent" />
}

interface RunSectionProps {
	// Document whose pipeline runs.
	readonly document: ImageDocument
	// Its pipeline, as shown.
	readonly draft: ImageProcessingDraft
	// Latest job of the pipeline.
	readonly job?: ImageProcessingJob
	// Whether that job waits or runs.
	readonly active: boolean
	// Number of enabled steps.
	readonly enabledCount: number
	// Why Run Pipeline is disabled.
	readonly blocker?: string
	// Why the output of the job could not be opened.
	readonly claimError?: string
}

// Run Pipeline and Stop Processing, with the state of the latest job, the step it applies, and the steps it was
// submitted with.
function RunSection({ document, draft, job, active, enabledCount, blocker, claimError }: RunSectionProps) {
	const now = useNow(active)
	// Job whose stop was asked; it stays running until the server says it ended.
	const [stopping, setStopping] = useState<string>()
	const stepping = job?.state === 'running' && job.currentStepIndex !== undefined ? job.steps[job.currentStepIndex] : undefined

	return (
		<PanelSection title="Run">
			<Property label="Steps">
				{enabledCount} of {draft.steps.length} enabled
			</Property>
			<Actions>
				<Button disabled={blocker !== undefined} title={blocker} onClick={() => void runProcessing(imageProcessingState, imagesState, document.key)}>
					Run Pipeline
				</Button>
				<Button
					variant="secondary"
					disabled={!active || !job || stopping === job.jobId}
					onClick={() => {
						if (!job) return
						setStopping(job.jobId)
						void cancelProcessing(job.jobId)
					}}
				>
					Stop Processing
				</Button>
			</Actions>
			{blocker && !active && <Notice>{blocker}</Notice>}
			{draft.submitError && draft.submitErrorStepId === undefined && <Notice error>{draft.submitError}</Notice>}
			{job && (
				<>
					<Property label="Status">{active && stopping === job.jobId ? 'Stopping…' : STATE_LABELS[job.state]}</Property>
					{stepping && job.currentStepIndex !== undefined && (
						<Property label="Step">
							{job.currentStepIndex + 1} of {job.steps.length} · {operationLabel(stepping.operation.type)}
						</Property>
					)}
					{job.startedAt !== undefined && <Property label="Elapsed">{formatSeconds((job.endedAt ?? now) - job.startedAt)}</Property>}
					{job.error && <Notice error>{job.errorStepId === undefined ? job.error : `${stepName(job, job.errorStepId)}: ${job.error}`}</Notice>}
					{job.state === 'completed' && !claimError && <Notice>The result opened as a new unsaved image; the source is unchanged.</Notice>}
					{claimError && <Notice error>{claimError}</Notice>}
					{active && (
						<>
							<Notice>Applying these steps; edits apply to the next run.</Notice>
							<ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
								{job.steps.map(({ id, operation }, i) => (
									<li key={id} className={cn('truncate', i === job.currentStepIndex ? 'text-accent' : 'text-ink-200')}>
										{i + 1}. {operationLabel(operation.type)}
									</li>
								))}
							</ol>
						</>
					)}
				</>
			)}
		</PanelSection>
	)
}

// Returns the position and name of a step of a job, such as "Step 2 (Gaussian Blur)".
function stepName(job: ImageProcessingJob, stepId: string): string {
	const index = job.steps.findIndex((step) => step.id === stepId)
	return index < 0 ? 'A step' : `Step ${index + 1} (${operationLabel(job.steps[index].operation.type)})`
}

interface PropertyProps {
	// Name of the property.
	readonly label: string
	// Its value.
	readonly children: React.ReactNode
}

// Name and value of a property.
function Property({ label, children }: PropertyProps) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-xs text-ink-300">{label}</span>
			<span className="min-w-0 truncate text-right text-ink-100 tabular-nums">{children}</span>
		</div>
	)
}

// Returns a duration in milliseconds as seconds with one decimal.
function formatSeconds(milliseconds: number): string {
	return `${(milliseconds / 1000).toFixed(1)} s`
}
