import { cn } from 'cn'
import type { KeyboardEvent, PointerEvent, Ref } from 'react'
import { Notice } from '../equipment-control/parts'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import type { ProcessingDraftStep } from './imageprocessing'
import { operationLabel, operationSummary } from './imageprocessing.catalog'
import { ProcessingStepForm } from './ProcessingStepForms'

// Card of one step of an Image Processing pipeline: a drag handle, the enabled box, and the name and summary of its
// operation, which expand or collapse its parameter form, its Move, Duplicate, and Remove actions, and why it cannot
// run. Expansion is independent of the enabled state, and a disabled step stays editable, only dimmed. The card only
// reports what the operator does; the panel owns the pipeline and the drag.

export interface ProcessingStepCardProps {
	// Step shown.
	readonly step: ProcessingDraftStep
	// Position of the step in the pipeline, from 0.
	readonly index: number
	// Number of steps of the pipeline.
	readonly count: number
	// Whether its form is shown.
	readonly expanded: boolean
	// Whether it is being dragged.
	readonly dragging: boolean
	// Why it cannot run or why it failed; absent when nothing is known against it.
	readonly error?: string
	// Whether the running job is applying it.
	readonly running: boolean
	// Element of the card, measured by the drag.
	readonly cardRef: Ref<HTMLLIElement>
	// Starts dragging the card from its handle.
	readonly onDragStart: (event: PointerEvent<HTMLButtonElement>) => void
	// Moves the step by an offset in the pipeline: -1 up, +1 down.
	readonly onMove: (offset: number) => void
	// Enables or disables the step.
	readonly onEnabledChange: (enabled: boolean) => void
	// Expands or collapses the card.
	readonly onToggleExpanded: () => void
	// Replaces the operation of the step.
	readonly onChange: (operation: ProcessingDraftStep['operation']) => void
	// Inserts a copy of the step after it.
	readonly onDuplicate: () => void
	// Removes the step.
	readonly onRemove: () => void
}

// Card of a pipeline step.
export function ProcessingStepCard({ step, index, count, expanded, dragging, error, running, cardRef, onDragStart, onMove, onEnabledChange, onToggleExpanded, onChange, onDuplicate, onRemove }: ProcessingStepCardProps) {
	const label = operationLabel(step.operation.type)
	const summary = operationSummary(step.operation)

	// Moves the step with Alt and the up or down arrow on its handle.
	function onHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
		if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
		event.preventDefault()
		onMove(event.key === 'ArrowUp' ? -1 : 1)
	}

	return (
		<li ref={cardRef} className={cn('rounded-md border bg-base-100 transition-colors duration-150 motion-reduce:transition-none', dragging ? 'border-accent' : error ? 'border-danger' : 'border-line-100')}>
			<div className={cn('flex items-center gap-1 py-1 pr-1 pl-0.5', !step.enabled && 'opacity-60')}>
				<button
					type="button"
					title="Drag to reorder; Alt+↑ or Alt+↓ moves it"
					onPointerDown={onDragStart}
					onKeyDown={onHandleKeyDown}
					className="flex h-8 w-6 flex-none cursor-grab touch-none items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ink-300 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
				>
					<Icon name="grip" strokeWidth={3} className="size-4" />
					<span className="sr-only">Reorder {label}</span>
				</button>
				<label title={step.enabled ? 'Enabled: Run applies this step' : 'Disabled: Run skips this step'} className="flex size-6 flex-none cursor-pointer items-center justify-center">
					<input type="checkbox" checked={step.enabled} onChange={(e) => onEnabledChange(e.target.checked)} className="m-0 size-3.5 cursor-pointer accent-accent" />
					<span className="sr-only">Enable {label}</span>
				</label>
				<button type="button" onClick={onToggleExpanded} title={expanded ? 'Collapse' : 'Expand'} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-1 py-0.5 text-left hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-accent">
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate text-[13px] text-ink-100">
							<span className="text-ink-300 tabular-nums">{index + 1}.</span> {label}
							{running && <span className="text-accent"> · running</span>}
						</span>
						<span className="truncate text-xs text-ink-300">{step.enabled ? summary : `Disabled · ${summary}`}</span>
					</span>
					<Icon name="stepForward" className={cn('size-4 text-ink-300 transition-transform duration-150 motion-reduce:transition-none', expanded && 'rotate-90')} />
				</button>
			</div>
			{error && !expanded && (
				<div className="px-3 pb-2">
					<Notice error>{error}</Notice>
				</div>
			)}
			{expanded && (
				<div className="flex flex-col gap-2 border-t border-line-100 px-3 py-2">
					<ProcessingStepForm operation={step.operation} onChange={onChange} />
					{error && <Notice error>{error}</Notice>}
					<div className="flex items-center justify-end gap-1">
						<IconButton icon="arrow" label="Move up" disabled={index === 0} onClick={() => onMove(-1)} />
						<IconButton icon="arrow" label="Move down" disabled={index === count - 1} onClick={() => onMove(1)} className="rotate-180" />
						<IconButton icon="duplicate" label="Duplicate" onClick={onDuplicate} />
						<IconButton icon="trash" label="Remove" onClick={onRemove} />
					</div>
				</div>
			)}
		</li>
	)
}
