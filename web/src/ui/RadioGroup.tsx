import { useId } from 'react'
import { Field } from './Field'

// Row of native radio buttons with their labels, for a choice among a few short options shown inline, such
// as a unit.

export interface RadioGroupProps<T extends string> {
	readonly label?: string
	// Options in display order.
	readonly options: readonly T[]
	// Selected option.
	readonly value: T
	// Called with the option chosen.
	readonly onChange: (value: T) => void
	// Display text of an option; the option itself when absent.
	readonly format?: (value: T) => string
	// Whether the whole group is disabled.
	readonly disabled?: boolean
	readonly className?: string
}

// Radio group.
export function RadioGroup<T extends string>({ label, options, value, onChange, format = String, disabled = false, className }: RadioGroupProps<T>) {
	const name = useId()

	return (
		<Field label={label} className={className}>
			<div className="flex justify-center flex-wrap gap-x-4 gap-y-1">
				{options.map((option) => (
					<label key={option} className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-200 select-none has-disabled:cursor-not-allowed has-disabled:text-ink-300">
						<input type="radio" name={name} value={option} checked={option === value} disabled={disabled} onChange={() => onChange(option)} className="m-0 size-3.5 cursor-pointer accent-accent disabled:cursor-not-allowed" />
						{format(option)}
					</label>
				))}
			</div>
		</Field>
	)
}
