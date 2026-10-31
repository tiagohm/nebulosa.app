import { cn } from 'cn'
import { Field } from './Field'

// Row of mutually exclusive options shown side by side, for a choice of two to five short labels, such as
// an acquisition mode.

export interface SegmentedControlProps<T extends string> {
	readonly label?: string
	// Options in display order.
	readonly options: readonly T[]
	// Selected option.
	readonly value: T
	// Called with the option chosen; not called for the selected one.
	readonly onChange: (value: T) => void
	// Display text of an option; the option itself when absent.
	readonly format?: (value: T) => string
	// Whether the whole control is disabled.
	readonly disabled?: boolean
	readonly className?: string
}

// Segmented control.
export function SegmentedControl<T extends string>({ label, options, value, onChange, format = String, disabled = false, className }: SegmentedControlProps<T>) {
	return (
		<Field label={label} className={className}>
			<div className="flex h-9.5 items-stretch">
				{options.map((option) => (
					<button
						key={option}
						type="button"
						disabled={disabled}
						onClick={() => option !== value && onChange(option)}
						className={cn(
							'min-w-fit flex-1 cursor-pointer truncate border border-line-200 px-2 text-[13px] leading-5 transition-colors duration-150 first:rounded-l-sm last:rounded-r-sm not-first:-ml-px disabled:cursor-not-allowed',
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
