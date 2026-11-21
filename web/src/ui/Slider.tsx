import { cn } from 'cn'
import { useId, useState } from 'react'
import { isNumberText, parseNumberText } from './numberinput.step'

// Compact numeric control for panels: a label and a typed value on one line, with a range track below
// for coarse changes. Values are rounded to the step and kept within the range. The typed value is a text field with the
// decimal keypad, stepped with Arrow Up and Down, so it is always written with a dot whatever the browser's locale; a
// typed comma is read as the decimal dot.

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
					type="text"
					inputMode="decimal"
					disabled={disabled}
					value={draft ?? value.toFixed(decimals)}
					onChange={(e) => {
						const text = e.target.value
						if (!isNumberText(text)) return
						setDraft(text)
						const typed = parseNumberText(text)
						if (typed !== undefined) commit(typed)
					}}
					onKeyDown={(e) => {
						if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
						e.preventDefault()
						setDraft(undefined)
						commit(value + (e.key === 'ArrowUp' ? step : -step))
					}}
					onBlur={() => setDraft(undefined)}
					className="box-border h-6 w-20 rounded-sm border border-line-200 bg-base-200 px-1.5 text-right font-mono text-xs text-ink-100 tabular-nums hover:border-ink-300 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:text-ink-300"
				/>
			</div>
			<input id={id} type="range" disabled={disabled} min={min} max={max} step={step} value={value} onChange={(e) => commit(+e.target.value)} className="h-4 w-full cursor-pointer accent-accent disabled:cursor-not-allowed" />
		</div>
	)
}
