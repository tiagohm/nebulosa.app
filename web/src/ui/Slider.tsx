import { cn } from 'cn'
import { useId, useState } from 'react'

// Compact numeric control for panels: a label and a typed value on one line, with a range track below
// for coarse changes. Values are rounded to the step and kept within the range.

export interface SliderProps {
	// Name of the value.
	readonly label: string
	// Current value, within [min, max].
	readonly value: number
	// Called with the new value, rounded to step and kept within [min, max].
	readonly onChange: (value: number) => void
	// Smallest value.
	readonly min: number
	// Largest value.
	readonly max: number
	// Increment of the value, positive.
	readonly step: number
	// Whether the control is disabled.
	readonly disabled?: boolean
	// Extra classes of the root element.
	readonly className?: string
}

// Number of decimals that represent a step exactly enough for display, at most 6.
function decimalsOf(step: number): number {
	return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))))
}

// Labeled range slider with a typed value.
export function Slider({ label, value, onChange, min, max, step, disabled, className }: SliderProps) {
	const id = useId()
	// Text being typed; undefined shows the committed value.
	const [draft, setDraft] = useState<string>()
	const decimals = decimalsOf(step)

	function commit(next: number) {
		onChange(Math.min(max, Math.max(min, Number((Math.round(next / step) * step).toFixed(decimals)))))
	}

	return (
		<div className={cn('flex flex-col gap-1', className)}>
			<div className="flex items-center justify-between gap-3">
				<label htmlFor={id} className="text-xs text-ink-300">
					{label}
				</label>
				<input
					type="number"
					inputMode="decimal"
					disabled={disabled}
					min={min}
					max={max}
					step={step}
					value={draft ?? value.toFixed(decimals)}
					onChange={(e) => {
						const text = e.target.value
						setDraft(text)
						if (text !== '' && Number.isFinite(+text)) commit(+text)
					}}
					onBlur={() => setDraft(undefined)}
					className="box-border h-6 w-20 rounded-sm border border-line-200 bg-base-200 px-1.5 text-right font-mono text-xs text-ink-100 tabular-nums [appearance:textfield] hover:border-ink-300 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:text-ink-300 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				/>
			</div>
			<input id={id} type="range" disabled={disabled} min={min} max={max} step={step} value={value} onChange={(e) => commit(+e.target.value)} className="h-4 w-full cursor-pointer accent-accent disabled:cursor-not-allowed" />
		</div>
	)
}
