import type * as React from 'react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { type ClassValue, tv } from 'tailwind-variants'
import { assignRef, clamp, tw } from '@/shared/util'
import { Icons } from '../Icon'

const numberInputStyles = tv({
	slots: {
		base: 'relative inline-flex min-w-0 align-top',
		surface: 'flex w-full min-w-0 items-stretch overflow-hidden rounded-lg transition',
		field: 'relative min-w-0 flex-1',
		input: 'peer h-full w-full border-none bg-transparent outline-none transition',
		label: 'pointer-events-none absolute origin-left truncate transition-all duration-150 ease-out',
		content: 'flex shrink-0 items-center whitespace-nowrap',
		stepper: 'flex flex-col gap-0',
		stepButton: 'flex flex-1 items-center justify-center bg-neutral-800/70 text-neutral-300 outline-none transition hover:bg-neutral-700 hover:text-neutral-100 cursor-pointer',
		stepIcon: '',
	},
	variants: {
		size: {
			md: {
				input: 'h-10 px-4 text-sm',
				label: 'left-4 right-4 top-1.5 text-xs leading-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-focus:top-1.5 peer-focus:translate-y-0 peer-placeholder-shown:text-sm peer-focus:text-xs',
				content: 'px-4 text-sm',
				stepper: 'relative inset-auto my-1 mr-1 w-8 self-stretch',
				stepIcon: 'size-[1.25em]',
			},
			lg: {
				input: 'h-11 px-5 text-base',
				label: 'left-5 right-5 top-1.5 text-xs leading-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-focus:top-1.5 peer-focus:translate-y-0 peer-placeholder-shown:text-base peer-focus:text-xs',
				content: 'px-4 text-base',
				stepper: 'relative inset-auto my-1 mr-1 w-9 self-stretch',
				stepIcon: 'size-[1.5em]',
			},
		},
		hasLabel: {
			true: {
				input: 'placeholder:text-transparent focus:placeholder:text-neutral-500',
				label: 'text-neutral-400 peer-placeholder-shown:text-neutral-500 peer-focus:text-neutral-200',
			},
			false: {
				input: 'placeholder:text-neutral-500',
				label: 'hidden',
			},
		},
		fullWidth: {
			true: {
				base: 'w-full',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		hasLabel: false,
	},
})

const numberInputSizeStyles = {
	md: {
		inputWithLabel: 'pt-5 pb-1.5',
		inputWithoutLabel: 'py-2.5',
	},
	lg: {
		inputWithLabel: 'pt-5 pb-1.5',
		inputWithoutLabel: 'py-2.5',
	},
} as const

export type NumberInputSize = keyof typeof numberInputSizeStyles

export interface NumberInputClassNames {
	readonly base?: ClassValue
	readonly surface?: ClassValue
	readonly field?: ClassValue
	readonly input?: ClassValue
	readonly label?: ClassValue
	readonly startContent?: ClassValue
	readonly endContent?: ClassValue
	readonly stepper?: ClassValue
	readonly stepButton?: ClassValue
	readonly stepIcon?: ClassValue
}

export interface NumberInputProps extends Omit<React.ComponentPropsWithRef<'input'>, 'children' | 'defaultValue' | 'inputMode' | 'placeholder' | 'size' | 'type' | 'value'> {
	readonly classNames?: NumberInputClassNames
	readonly label?: React.ReactNode
	readonly placeholder?: string
	readonly value?: number
	readonly onValueChange?: (value: number) => void
	readonly onEnter?: () => void
	readonly fireOnEnter?: boolean
	readonly fullWidth?: boolean
	readonly minValue?: number
	readonly maxValue?: number
	readonly step?: number
	readonly fractionDigits?: number
	readonly hideStepper?: boolean
	readonly size?: NumberInputSize
	readonly startContent?: React.ReactNode
	readonly endContent?: React.ReactNode
}

// Clamps a numeric value against optional bounds.
function clampValue(value: number, minValue?: number, maxValue?: number) {
	const minimum = minValue === undefined || maxValue === undefined ? minValue : Math.min(minValue, maxValue)
	const maximum = minValue === undefined || maxValue === undefined ? maxValue : Math.max(minValue, maxValue)

	if (minimum !== undefined && maximum !== undefined) {
		return clamp(value, minimum, maximum)
	}

	if (minimum !== undefined && value < minimum) return minimum
	if (maximum !== undefined && value > maximum) return maximum
	return value
}

// Clamps decimal precision into a stable formatting range.
function normalizeDecimalPlaces(decimalPlaces?: number) {
	if (!Number.isFinite(decimalPlaces)) return 0
	return clamp(Math.trunc(decimalPlaces!), 0, 16)
}

// Normalizes values so they respect the configured decimal precision.
function normalizeNumber(value: number | undefined, decimalPlaces?: number) {
	if (value === undefined || !Number.isFinite(value)) return undefined
	const factor = 10 ** normalizeDecimalPlaces(decimalPlaces)
	const normalized = Math.round(value * factor) / factor
	return Object.is(normalized, -0) ? 0 : normalized
}

// Converts a committed value into the editable text representation.
function toEditableValue(value: number, decimalPlaces?: number) {
	return value.toFixed(normalizeDecimalPlaces(decimalPlaces))
}

// Formats a committed value for the blurred display state.
function toFormattedValue(value: number | undefined, decimalPlaces?: number) {
	const normalized = normalizeNumber(value, decimalPlaces)
	if (normalized === undefined) return ''
	const digits = normalizeDecimalPlaces(decimalPlaces)
	return normalized.toFixed(digits)
}

// Parses the current draft text into a numeric value.
function parseDraftValue(value: string, decimalPlaces?: number) {
	const trimmedValue = value.trim()
	if (!trimmedValue) return undefined
	const parsedValue = Number(trimmedValue)
	return Number.isFinite(parsedValue) ? normalizeNumber(parsedValue, decimalPlaces) : undefined
}

// Sanitizes the configured step so button increments always move forward.
function normalizeStepValue(step: number | undefined, decimalPlaces?: number) {
	if (!(step !== undefined && Number.isFinite(step) && step > 0)) {
		return 1
	}

	const digits = normalizeDecimalPlaces(decimalPlaces)
	const normalizedStep = normalizeNumber(step, digits)

	if (normalizedStep === undefined || normalizedStep <= 0) {
		return digits === 0 ? 1 : 1 / 10 ** digits
	}

	return normalizedStep
}

// Renders a text-input-like number field with inline steppers.
export function NumberInput({
	autoCapitalize,
	autoComplete,
	autoCorrect,
	autoFocus,
	className,
	classNames,
	disabled = false,
	fireOnEnter = false,
	fractionDigits = 0,
	hideStepper = false,
	label,
	maxValue,
	minValue,
	name,
	onBlur,
	onChange,
	onFocus,
	onKeyDown,
	onWheel,
	onValueChange,
	onEnter,
	placeholder,
	readOnly = false,
	ref,
	size = 'md',
	startContent,
	endContent,
	spellCheck,
	step,
	style,
	tabIndex,
	fullWidth,
	value,
	...props
}: NumberInputProps) {
	const digits = normalizeDecimalPlaces(fractionDigits)
	const normalizedValue = normalizeNumber(value, digits)
	const committedValue = normalizedValue === undefined ? clampValue(0, minValue, maxValue) : clampValue(normalizedValue, minValue, maxValue)
	const [draft, setDraft] = useState(() => toFormattedValue(committedValue, digits))
	const focusedRef = useRef(false)
	const inputRef = useRef<HTMLInputElement | null>(null)
	const lastCommittedValueRef = useRef(committedValue)
	const hasStepper = hideStepper !== true && disabled !== true && readOnly !== true
	const hasStartContent = startContent !== undefined && startContent !== null
	const hasEndContent = endContent !== undefined && endContent !== null
	const styles = numberInputStyles({ size, hasLabel: !!label, fullWidth })
	const sizeStyles = numberInputSizeStyles[size]
	const displayedPlaceholder = label ? (placeholder ?? ' ') : placeholder

	// Keeps the internal draft aligned with the external controlled value.
	useEffect(() => {
		lastCommittedValueRef.current = committedValue

		if (!focusedRef.current) {
			setDraft(toFormattedValue(committedValue, digits))
		}
	}, [committedValue, digits])

	// Commits the current draft when editing finishes.
	const commitValue = useEffectEvent(() => {
		if (disabled || readOnly) return

		const parsedValue = parseDraftValue(draft, digits)

		if (parsedValue === undefined) {
			if (!draft.trim()) {
				if (lastCommittedValueRef.current !== undefined) {
					const value = clampValue(0, minValue, maxValue)
					lastCommittedValueRef.current = value
					onValueChange?.(value)
				}

				setDraft('')
				return
			}

			setDraft(toFormattedValue(lastCommittedValueRef.current, digits))
			return
		}

		const nextValue = clampValue(parsedValue, minValue, maxValue)

		if (nextValue !== lastCommittedValueRef.current) {
			lastCommittedValueRef.current = nextValue
			onValueChange?.(nextValue)
		}

		setDraft(focusedRef.current ? toEditableValue(nextValue, digits) : toFormattedValue(nextValue, digits))
	})

	// Applies a step increment or decrement from the latest draft.
	const stepValue = useEffectEvent((direction: -1 | 1) => {
		if (disabled || readOnly) return

		const baseValue = parseDraftValue(draft, digits) ?? lastCommittedValueRef.current ?? minValue ?? 0
		const nextValue = clampValue(baseValue + direction * normalizeStepValue(step, digits), minValue, maxValue)

		if (nextValue !== lastCommittedValueRef.current) {
			lastCommittedValueRef.current = nextValue
			onValueChange?.(nextValue)
		}

		focusedRef.current = true
		setDraft(toEditableValue(nextValue, digits))
		inputRef.current?.focus()
	})

	// Stores the live input element while preserving the forwarded ref.
	function handleInputRef(element: HTMLInputElement | null) {
		inputRef.current = element
		assignRef(ref, element)
	}

	// Commits the current draft on blur.
	function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
		focusedRef.current = false
		commitValue()
		onBlur?.(event)
	}

	// Keeps the raw draft text in sync while the user types.
	function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
		setDraft(event.target.value)
		onChange?.(event)
	}

	// Switches the field into editable raw-number mode.
	function handleFocus(event: React.FocusEvent<HTMLInputElement>) {
		focusedRef.current = true
		setDraft(toEditableValue(lastCommittedValueRef.current, digits))
		onFocus?.(event)
	}

	// Commits or steps the value from keyboard interactions.
	function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		onKeyDown?.(event)

		if (event.defaultPrevented) return

		if (event.key === 'ArrowUp') {
			event.preventDefault()
			stepValue(1)
			return
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault()
			stepValue(-1)
			return
		}

		if (fireOnEnter && event.key === 'Enter') {
			commitValue()
			onEnter?.()
		}
	}

	function handleWheel(event: React.WheelEvent<HTMLInputElement>) {
		onWheel?.(event)

		if (event.defaultPrevented) return

		const delta = event.deltaY || event.deltaX
		const direction = -Math.sign(delta)

		if (direction === 1 || direction === -1) {
			event.preventDefault()
			stepValue(direction)
			return
		}
	}

	// Prevents the buttons from stealing focus before the step applies.
	function handleStepMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
		event.preventDefault()
	}

	return (
		<div className={tw(styles.base(), className, disabled && 'opacity-50', readOnly && !disabled && 'opacity-80', classNames?.base)}>
			<div className={tw(styles.surface(), disabled ? 'bg-neutral-900/35 text-neutral-500' : readOnly ? 'bg-neutral-900/55 text-neutral-300' : 'bg-neutral-900/70 text-neutral-100 hover:bg-neutral-800 focus-within:bg-neutral-800', classNames?.surface)}>
				{hasStartContent && <div className={tw(styles.content(), disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-400', classNames?.startContent)}>{startContent}</div>}
				<div className={tw(styles.field(), classNames?.field)}>
					<input
						{...props}
						autoCapitalize={autoCapitalize}
						autoComplete={autoComplete}
						autoCorrect={autoCorrect}
						autoFocus={autoFocus}
						className={tw(
							styles.input(),
							label ? sizeStyles.inputWithLabel : sizeStyles.inputWithoutLabel,
							hasStartContent && 'pl-0',
							hasEndContent && 'pr-0',
							disabled ? 'cursor-not-allowed text-neutral-500 placeholder:text-neutral-600' : readOnly ? 'cursor-default text-neutral-300' : 'text-neutral-100 placeholder:text-neutral-500',
							classNames?.input,
						)}
						disabled={disabled}
						inputMode={digits === 0 ? 'numeric' : 'decimal'}
						name={name}
						onBlur={handleBlur}
						onChange={handleChange}
						onFocus={handleFocus}
						onKeyDown={handleKeyDown}
						onWheel={handleWheel}
						placeholder={displayedPlaceholder}
						readOnly={readOnly}
						ref={handleInputRef}
						spellCheck={spellCheck}
						style={style}
						tabIndex={tabIndex}
						type='text'
						value={draft}
					/>
					{label && (
						<label
							className={tw(styles.label(), hasStartContent && 'left-0', disabled ? 'text-neutral-600 peer-placeholder-shown:text-neutral-600 peer-focus:text-neutral-600' : readOnly ? 'text-neutral-400 peer-placeholder-shown:text-neutral-400 peer-focus:text-neutral-300' : undefined, classNames?.label)}>
							{label}
						</label>
					)}
				</div>
				{hasEndContent && <div className={tw(styles.content(), disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-400', classNames?.endContent)}>{endContent}</div>}
				{hasStepper && (
					<div className={tw(styles.stepper(), classNames?.stepper)}>
						<button className={tw(styles.stepButton(), 'rounded-t-md', classNames?.stepButton)} onClick={() => stepValue(1)} onMouseDown={handleStepMouseDown} tabIndex={-1} type='button'>
							<Icons.ChevronUp className={tw(styles.stepIcon(), classNames?.stepIcon)} />
						</button>
						<button className={tw(styles.stepButton(), 'rounded-b-md', classNames?.stepButton)} onClick={() => stepValue(-1)} onMouseDown={handleStepMouseDown} tabIndex={-1} type='button'>
							<Icons.ChevronDown className={tw(styles.stepIcon(), classNames?.stepIcon)} />
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
