import { cn } from 'cn'
import { type ReactNode, useState } from 'react'
import { Field, InputSuffix, inputClassName, suffixPadding } from './Field'
import { displayValue, isNumberText, parseNumberText, snapToStep } from './numberinput.step'

export interface NumberInputProps {
	readonly label?: string
	readonly value: number
	readonly onChange: (value: number) => void
	readonly min?: number
	readonly max?: number
	readonly step?: number
	readonly className?: string
	readonly classNames?: {
		readonly input?: string
	}
	readonly disabled?: boolean
	// Unit drawn inside the right end of the field, such as "mm" or "µm"; shown as written, never uppercased.
	readonly suffix?: string
}

const stepButtonClassName =
	'flex flex-[0_0_38px] cursor-pointer items-center justify-center border border-line-200 bg-base-300 p-0 text-base leading-none text-ink-100 transition-colors duration-150 not-disabled:hover:bg-accent-subtle not-disabled:hover:text-accent disabled:cursor-not-allowed disabled:bg-base-200 disabled:text-ink-300'

// Look of the text field between the step buttons: square corners against the buttons, centered tabular figures, and
// raised while focused so its focus ring is drawn over the buttons.
export const stepperInputClassName = cn(inputClassName, 'relative flex-1 rounded-none text-center tabular-nums focus:z-1')

// Props of the frame of a numeric field.
export interface StepperFrameProps {
	// Whether the − button is disabled, such as at the minimum or with nothing to step.
	readonly decreaseDisabled: boolean
	// Whether the + button is disabled.
	readonly increaseDisabled: boolean
	// Steps the value down.
	readonly onDecrease: () => void
	// Steps the value up.
	readonly onIncrease: () => void
	// Text field and its unit suffix, between the buttons.
	readonly children: ReactNode
}

// Frame of a numeric field: the − and + step buttons around its text field, kept out of the Tab order since the arrow
// keys step the field. Shared by NumberInput and the fields that keep their text as typed, such as the Calculator's.
export function StepperFrame({ decreaseDisabled, increaseDisabled, onDecrease, onIncrease, children }: StepperFrameProps) {
	return (
		<div className="flex h-9.5 items-stretch">
			<button type="button" tabIndex={-1} title="Decrease" disabled={decreaseDisabled} onClick={onDecrease} className={cn(stepButtonClassName, 'rounded-l-sm border-r-0')}>
				−
			</button>
			<div className="relative flex min-w-0 flex-1">{children}</div>
			<button type="button" tabIndex={-1} title="Increase" disabled={increaseDisabled} onClick={onIncrease} className={cn(stepButtonClassName, 'rounded-r-sm border-l-0')}>
				+
			</button>
		</div>
	)
}

// Numeric field with − and + step buttons, a unit suffix, and Arrow Up and Down stepping. It is a text field with the
// decimal keypad, so the value is always written with a dot, whatever the browser's locale; a typed comma is read as
// the decimal dot. A field of whole non-negative values (an integer step and a minimum of zero or more), such as a TCP
// port, opens the digits keypad instead, which has neither a dot nor a minus sign.
export function NumberInput({ label, value, onChange, min, max, step = 1, className, classNames, disabled, suffix }: NumberInputProps) {
	// Text being typed; undefined shows the committed value.
	const [draft, setDraft] = useState<string>()

	function commit(next: number) {
		onChange(snapToStep(next, step, min, max))
	}

	return (
		<Field label={label} className={className}>
			<StepperFrame decreaseDisabled={!!disabled || (min !== undefined && value <= min)} increaseDisabled={!!disabled || (max !== undefined && value >= max)} onDecrease={() => commit(value - step)} onIncrease={() => commit(value + step)}>
				<input
					type="text"
					inputMode={Number.isInteger(step) && min !== undefined && min >= 0 ? 'numeric' : 'decimal'}
					disabled={disabled}
					value={draft ?? String(displayValue(value, step, min, max))}
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
					style={suffix ? { paddingRight: suffixPadding(suffix) } : undefined}
					className={cn(stepperInputClassName, classNames?.input)}
				/>
				{suffix && <InputSuffix>{suffix}</InputSuffix>}
			</StepperFrame>
		</Field>
	)
}
