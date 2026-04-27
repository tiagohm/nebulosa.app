import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { tw } from '@/shared/util'

const textInputStyles = tv({
	slots: {
		base: 'relative inline-flex min-w-0 align-top',
		surface: 'flex w-full min-w-0 items-stretch overflow-hidden rounded-lg transition',
		field: 'relative min-w-0 flex-1',
		input: 'peer h-full w-full border-none bg-transparent outline-none transition',
		label: 'pointer-events-none absolute origin-left truncate transition-all duration-150 ease-out',
		content: 'flex shrink-0 items-center whitespace-nowrap',
	},
	variants: {
		size: {
			md: {
				input: 'h-10 px-3 text-sm',
				label: 'left-3 right-3 top-1.5 text-xs leading-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-focus:top-1.5 peer-focus:translate-y-0 peer-placeholder-shown:text-sm peer-focus:text-xs',
				content: 'px-3 text-sm',
			},
			lg: {
				input: 'h-11 px-4 text-base',
				label: 'left-4 right-4 top-1.5 text-xs leading-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-focus:top-1.5 peer-focus:translate-y-0 peer-placeholder-shown:text-base peer-focus:text-xs',
				content: 'px-4 text-base',
			},
		},
		color: {
			default: {
				base: '[--color-variant:var(--color-neutral-500)]',
			},
			primary: {
				base: '[--color-variant:var(--primary)]',
			},
			secondary: {
				base: '[--color-variant:var(--secondary)]',
			},
			success: {
				base: '[--color-variant:var(--success)]',
			},
			danger: {
				base: '[--color-variant:var(--danger)]',
			},
			warning: {
				base: '[--color-variant:var(--warning)]',
			},
		},
		hasLabel: {
			true: {
				input: 'placeholder:text-transparent focus:placeholder:text-lighter-(--color-variant)/55',
			},
			false: {
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
		color: 'default',
	},
})

const textInputSizeStyles = {
	md: {
		inputWithLabel: 'pt-5 pb-1.5',
		inputWithoutLabel: 'py-2.5',
	},
	lg: {
		inputWithLabel: 'pt-5 pb-1.5',
		inputWithoutLabel: 'py-2.5',
	},
} as const

type TextInputVariants = VariantProps<typeof textInputStyles>

export interface TextInputClassNames {
	readonly base?: ClassValue
	readonly surface?: ClassValue
	readonly field?: ClassValue
	readonly input?: ClassValue
	readonly label?: ClassValue
	readonly startContent?: ClassValue
	readonly endContent?: ClassValue
}

export interface TextInputProps extends Omit<React.ComponentPropsWithRef<'input'>, 'children' | 'defaultValue' | 'size' | 'color' | 'type' | 'value'>, Omit<TextInputVariants, 'hasLabel'> {
	readonly classNames?: TextInputClassNames
	readonly label?: React.ReactNode
	readonly value?: string
	readonly onValueChange?: (value: string) => void
	readonly onEnter?: () => void
	readonly fireOnEnter?: boolean
	readonly startContent?: React.ReactNode
	readonly endContent?: React.ReactNode
}

// Render a shared text input surface with optional variant-aware coloring.
export function TextInput({
	autoCapitalize,
	autoComplete,
	autoCorrect,
	autoFocus,
	className,
	classNames,
	disabled = false,
	fireOnEnter = false,
	inputMode,
	label,
	maxLength,
	name,
	onBlur,
	onChange,
	onCompositionEnd,
	onCompositionStart,
	onFocus,
	onKeyDown,
	onValueChange,
	onEnter,
	placeholder,
	readOnly = false,
	ref,
	size = 'md',
	color,
	startContent,
	endContent,
	spellCheck,
	style,
	tabIndex,
	fullWidth,
	value = '',
	...props
}: TextInputProps) {
	const [draft, setDraft] = useState(value)
	const focusedRef = useRef(false)
	const composingRef = useRef(false)
	const lastCommittedValueRef = useRef(value)
	const styles = textInputStyles({ size, color, hasLabel: !!label, fullWidth })
	const sizeStyles = textInputSizeStyles[size]
	const displayedPlaceholder = label ? (placeholder ?? ' ') : placeholder
	const hasStartContent = startContent !== undefined && startContent !== null
	const hasEndContent = endContent !== undefined && endContent !== null
	const hasColorVariant = color !== undefined && color !== null && color !== 'default'
	const surfaceClassName = disabled
		? 'bg-neutral-900/35 text-neutral-500'
		: readOnly
			? 'bg-neutral-900/55 text-neutral-300'
			: hasColorVariant
				? 'bg-(--color-variant)/15 text-lighter-(--color-variant)/85 hover:bg-(--color-variant)/20 focus-within:bg-(--color-variant)/25'
				: 'bg-neutral-900/70 text-neutral-100 hover:bg-neutral-800 focus-within:bg-neutral-800'
	const inputClassName = disabled
		? 'cursor-not-allowed text-neutral-500 placeholder:text-neutral-600'
		: readOnly
			? 'cursor-default text-neutral-200 placeholder:text-neutral-500'
			: hasColorVariant
				? tw('text-lighter-(--color-variant)/85', !label && 'placeholder:text-lighter-(--color-variant)/45')
				: tw('text-neutral-100', !label && 'placeholder:text-neutral-500')
	const contentClassName = disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : hasColorVariant ? 'text-lighter-(--color-variant)/60' : 'text-neutral-400'
	const labelClassName = disabled
		? 'text-neutral-600 peer-placeholder-shown:text-neutral-600 peer-focus:text-neutral-600'
		: readOnly
			? 'text-neutral-400 peer-placeholder-shown:text-neutral-400 peer-focus:text-neutral-300'
			: hasColorVariant
				? 'text-lighter-(--color-variant)/65 peer-placeholder-shown:text-lighter-(--color-variant)/50 peer-focus:text-lighter-(--color-variant)/85'
				: 'text-neutral-400 peer-placeholder-shown:text-neutral-500 peer-focus:text-lighter-(--color-variant)/30'

	const commitValue = useEffectEvent(() => {
		if (disabled || readOnly || draft === lastCommittedValueRef.current) return
		lastCommittedValueRef.current = draft
		onValueChange?.(draft)
	})

	useEffect(() => {
		lastCommittedValueRef.current = value

		if (!focusedRef.current) {
			setDraft(value)
		}
	}, [value])

	// Commit the draft when the field loses focus.
	function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
		focusedRef.current = false
		commitValue()
		onBlur?.(event)
	}

	// Keep the local draft aligned with user edits.
	function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
		setDraft(event.target.value)
		onChange?.(event)
	}

	// Track composition completion before Enter can submit.
	function handleCompositionEnd(event: React.CompositionEvent<HTMLInputElement>) {
		composingRef.current = false
		onCompositionEnd?.(event)
	}

	// Track composition state to avoid committing partial IME input.
	function handleCompositionStart(event: React.CompositionEvent<HTMLInputElement>) {
		composingRef.current = true
		onCompositionStart?.(event)
	}

	// Mark the draft as actively edited while the input is focused.
	function handleFocus(event: React.FocusEvent<HTMLInputElement>) {
		focusedRef.current = true
		onFocus?.(event)
	}

	// Commit and report Enter when requested by the caller.
	function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		onKeyDown?.(event)

		if (!event.defaultPrevented && fireOnEnter && event.key === 'Enter' && !composingRef.current) {
			commitValue()
			onEnter?.()
		}
	}

	return (
		<div className={tw(styles.base(), className, disabled && 'opacity-40 cursor-not-allowed', readOnly && !disabled && 'opacity-90 pointer-events-none', classNames?.base)}>
			<div className={tw(styles.surface(), surfaceClassName, classNames?.surface)}>
				{hasStartContent && <div className={tw(styles.content(), contentClassName, classNames?.startContent)}>{startContent}</div>}
				<div className={tw(styles.field(), classNames?.field)}>
					<input
						{...props}
						autoCapitalize={autoCapitalize}
						autoComplete={autoComplete}
						autoCorrect={autoCorrect}
						autoFocus={autoFocus}
						className={tw(styles.input(), label ? sizeStyles.inputWithLabel : sizeStyles.inputWithoutLabel, hasStartContent && 'pl-0', hasEndContent && 'pr-0', inputClassName, classNames?.input)}
						disabled={disabled}
						inputMode={inputMode}
						maxLength={maxLength}
						name={name}
						onBlur={handleBlur}
						onChange={handleChange}
						onCompositionEnd={handleCompositionEnd}
						onCompositionStart={handleCompositionStart}
						onFocus={handleFocus}
						onKeyDown={handleKeyDown}
						placeholder={displayedPlaceholder}
						readOnly={readOnly}
						ref={ref}
						spellCheck={spellCheck}
						style={style}
						tabIndex={tabIndex}
						type="text"
						value={draft}
					/>
					{label && <label className={tw(styles.label(), hasStartContent && 'left-0', labelClassName, classNames?.label)}>{label}</label>}
				</div>
				{hasEndContent && <div className={tw(styles.content(), contentClassName, classNames?.endContent)}>{endContent}</div>}
			</div>
		</div>
	)
}
