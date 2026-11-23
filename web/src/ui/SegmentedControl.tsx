import { cn } from 'cn'
import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { Field } from './Field'
import { moveIndex } from './navigation'

// Row of mutually exclusive options shown side by side, for a choice of two to five short labels, such as
// an acquisition mode. It is one stop of the Tab order, on the selected option: the arrow keys, Home, and End move the
// selection and the focus along it, as in a group of radio buttons, past the options that cannot be chosen. Such an
// option stays in view, disabled, with why as its tooltip.

export interface SegmentedControlProps<T extends string> {
	readonly label?: string
	// Options in display order.
	readonly options: readonly T[]
	// Selected option.
	readonly value: T
	// Called with the option chosen; not called for the selected one.
	readonly onChange: (value: T) => void
	// Display content of an option, a text or a text with a mark such as a colour swatch; the option itself when absent.
	readonly format?: (value: T) => ReactNode
	// Why an option cannot be chosen, its tooltip; undefined for an available option.
	readonly disabledReason?: (value: T) => string | undefined
	// Whether the whole control is disabled.
	readonly disabled?: boolean
	readonly className?: string
}

// Segmented control.
export function SegmentedControl<T extends string>({ label, options, value, onChange, format = String, disabledReason, disabled = false, className }: SegmentedControlProps<T>) {
	const buttons = useRef<(HTMLButtonElement | null)[]>([])
	const selected = options.indexOf(value)

	// Moves the selection and the focus by a navigation key to the nearest option that can be chosen that way, if any.
	function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		let next = moveIndex(index, options.length, event.key)
		if (next === undefined) return
		event.preventDefault()
		// Home and End go on inward, the arrows on in their direction, past the options that cannot be chosen.
		const key = event.key === 'Home' ? 'ArrowRight' : event.key === 'End' ? 'ArrowLeft' : event.key
		for (let tries = 1; next !== undefined && disabledReason?.(options[next]) !== undefined; tries++) next = tries < options.length ? moveIndex(next, options.length, key) : undefined
		if (next === undefined || next === index) return
		buttons.current[next]?.focus()
		if (options[next] !== value) onChange(options[next])
	}

	return (
		<Field label={label} className={className}>
			<div className="flex h-9.5 items-stretch">
				{options.map((option, index) => (
					<button
						key={option}
						ref={(button) => {
							buttons.current[index] = button
						}}
						type="button"
						title={disabledReason?.(option)}
						disabled={disabled || disabledReason?.(option) !== undefined}
						tabIndex={index === Math.max(selected, 0) ? 0 : -1}
						onClick={() => option !== value && onChange(option)}
						onKeyDown={(event) => handleKeyDown(event, index)}
						className={cn(
							'min-w-fit flex-1 cursor-pointer truncate border border-line-200 px-2 text-sm leading-5 transition-colors duration-150 first:rounded-l-sm last:rounded-r-sm not-first:-ml-px focus-visible:z-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed motion-reduce:transition-none',
							option === value ? 'z-1 border-accent bg-accent-subtle text-accent disabled:border-line-200 disabled:bg-base-300 disabled:text-ink-200' : 'bg-base-200 text-ink-200 not-disabled:hover:bg-base-300 not-disabled:hover:text-ink-100 disabled:text-ink-300',
						)}
					>
						{format(option)}
					</button>
				))}
			</div>
		</Field>
	)
}
