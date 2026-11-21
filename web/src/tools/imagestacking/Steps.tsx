import { cn } from 'cn'
import { type KeyboardEvent, useRef } from 'react'
import { moveIndex } from '../../ui/navigation'
import { type StatusTone, TONE_TEXT } from '../../ui/StatusBadge'
import { SECTION_LABELS, STACKING_SECTIONS, type StackingSection, type StepState } from './format'

// Steps of an Image Stacking project, in the order a stack goes through them, each with where it stands in a word, so the
// operator reads the state of the whole project at a glance and sees a running analysis, run, or composition from any
// step. The steps fill one row on a wide screen and wrap to two on a phone, so none is ever scrolled out of sight. Like a
// segmented control, the row is one stop of the Tab order, on the step shown: the arrow keys, Home, and End move to
// another step.

// Dot before the state of a step, by tone; the running one pulses unless motion is reduced.
const DOT: Readonly<Record<StatusTone, string>> = {
	muted: 'border border-dashed border-ink-300',
	neutral: 'border border-ink-200',
	active: 'animate-pulse bg-accent motion-reduce:animate-none',
	success: 'bg-success',
	warning: 'bg-warning',
	danger: 'bg-danger',
}

export interface StepsProps {
	// Step shown.
	readonly value: StackingSection
	// Where each step stands; absent while it is not known.
	readonly states: Readonly<Record<StackingSection, StepState | undefined>>
	// Called with the step chosen; not called for the one shown.
	readonly onChange: (step: StackingSection) => void
}

// Row of the steps of a project.
export function Steps({ value, states, onChange }: StepsProps) {
	const buttons = useRef<(HTMLButtonElement | null)[]>([])

	// Moves to another step by a navigation key, with the focus.
	function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		const next = moveIndex(index, STACKING_SECTIONS.length, event.key)
		if (next === undefined) return
		event.preventDefault()
		buttons.current[next]?.focus()
		if (STACKING_SECTIONS[next] !== value) onChange(STACKING_SECTIONS[next])
	}

	return (
		<div className="grid w-full max-w-3xl grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-1">
			{STACKING_SECTIONS.map((step, index) => {
				const selected = step === value
				const state = states[step]

				return (
					<button
						key={step}
						ref={(button) => {
							buttons.current[index] = button
						}}
						type="button"
						tabIndex={selected ? 0 : -1}
						title={state ? `${SECTION_LABELS[step]}: ${state.label}` : SECTION_LABELS[step]}
						onClick={() => !selected && onChange(step)}
						onKeyDown={(event) => handleKeyDown(event, index)}
						className={cn(
							'flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-sm border px-2 py-1.5 text-left transition-colors duration-150 focus-visible:z-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none',
							selected ? 'border-accent bg-accent-subtle' : 'border-line-200 bg-base-200 hover:bg-base-300',
						)}
					>
						<span className={cn('max-w-full truncate text-xs leading-5 sm:text-sm', selected ? 'font-medium text-accent' : 'text-ink-100')}>{SECTION_LABELS[step]}</span>
						<span className={cn('flex max-w-full items-center gap-1.5 text-xs leading-4', state ? TONE_TEXT[state.tone] : 'text-ink-300')}>
							{state && <span className={cn('size-1.5 flex-none rounded-full', DOT[state.tone])} />}
							<span className="truncate">{state?.label ?? ' '}</span>
						</span>
					</button>
				)
			})}
		</div>
	)
}
