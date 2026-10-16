import { cn } from 'cn'
import { useState } from 'react'
import { Field, inputClassName } from './Field'

export interface NumberInputProps {
	readonly label?: string
	readonly value: number
	readonly onChange: (value: number) => void
	readonly min?: number
	readonly max?: number
	readonly step?: number
	readonly className?: string
	readonly disabled?: boolean
}

const stepButtonClassName =
	'flex flex-[0_0_38px] cursor-pointer items-center justify-center border border-line-200 bg-base-300 p-0 text-base leading-none text-ink-100 transition-colors duration-150 not-disabled:hover:bg-accent-subtle not-disabled:hover:text-accent disabled:cursor-not-allowed disabled:bg-base-200 disabled:text-ink-300'

export function NumberInput({ label, value, onChange, min, max, step = 1, className, disabled }: NumberInputProps) {
	// Text being typed; undefined shows the committed value.
	const [draft, setDraft] = useState<string>()

	function commit(next: number) {
		let v = Math.round(next / step) * step
		if (min !== undefined) v = Math.max(min, v)
		if (max !== undefined) v = Math.min(max, v)
		onChange(v)
	}

	return (
		<Field label={label} className={className}>
			<div className="flex h-[38px] items-stretch">
				<button type="button" tabIndex={-1} disabled={disabled || (min !== undefined && value <= min)} onClick={() => commit(value - step)} className={cn(stepButtonClassName, 'rounded-l-sm border-r-0')}>
					−
				</button>
				<input
					type="number"
					inputMode="decimal"
					disabled={disabled}
					min={min}
					max={max}
					step={step}
					value={draft ?? value}
					onChange={(e) => {
						const text = e.target.value
						setDraft(text)
						if (text !== '' && Number.isFinite(+text)) commit(+text)
					}}
					onBlur={() => setDraft(undefined)}
					className={cn(inputClassName, 'relative flex-1 rounded-none text-center tabular-nums [appearance:textfield] focus:z-1 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none')}
				/>
				<button type="button" tabIndex={-1} disabled={disabled || (max !== undefined && value >= max)} onClick={() => commit(value + step)} className={cn(stepButtonClassName, 'rounded-r-sm border-l-0')}>
					+
				</button>
			</div>
		</Field>
	)
}
