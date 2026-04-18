import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'
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
		hasLabel: false,
	},
})

const textInputSizeStyles = {
	md: {
		inputBase: 'h-10 px-4 text-sm',
		inputWithLabel: 'pt-5 pb-1.5',
		inputWithoutLabel: 'py-2.5',
		label: 'left-4 right-4 top-1.5 text-xs leading-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-focus:top-1.5 peer-focus:translate-y-0 peer-placeholder-shown:text-sm peer-focus:text-xs',
		content: 'px-4 text-sm',
	},
	lg: {
		inputBase: 'h-11 px-5 text-base',
		inputWithLabel: 'pt-5 pb-1.5',
		inputWithoutLabel: 'py-2.5',
		label: 'left-5 right-5 top-1.5 text-xs leading-none peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-focus:top-1.5 peer-focus:translate-y-0 peer-placeholder-shown:text-base peer-focus:text-xs',
		content: 'px-4 text-base',
	},
} as const

export type TextInputSize = keyof typeof textInputSizeStyles

export interface TextInputClassNames {
	readonly base?: string
	readonly surface?: string
	readonly field?: string
	readonly input?: string
	readonly label?: string
	readonly startContent?: string
	readonly endContent?: string
}

export interface TextInputProps extends Omit<React.ComponentPropsWithRef<'input'>, 'children' | 'className' | 'defaultValue' | 'disabled' | 'maxLength' | 'placeholder' | 'readOnly' | 'size' | 'type' | 'value'> {
	readonly className?: string
	readonly classNames?: TextInputClassNames
	readonly label?: React.ReactNode
	readonly placeholder?: string
	readonly value?: string
	readonly onValueChange?: (value: string) => void
	readonly onEnter?: () => void
	readonly readOnly?: boolean
	readonly disabled?: boolean
	readonly maxLength?: number
	readonly fireOnEnter?: boolean
	readonly fullWidth?: boolean
	readonly size?: TextInputSize
	readonly startContent?: React.ReactNode
	readonly endContent?: React.ReactNode
}

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
	const styles = textInputStyles({ hasLabel: !!label })
	const sizeStyles = textInputSizeStyles[size]
	const displayedPlaceholder = label ? (placeholder ?? ' ') : placeholder
	const hasStartContent = startContent !== undefined && startContent !== null
	const hasEndContent = endContent !== undefined && endContent !== null

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

	function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
		focusedRef.current = false
		commitValue()
		onBlur?.(event)
	}

	function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
		setDraft(event.target.value)
		onChange?.(event)
	}

	function handleCompositionEnd(event: React.CompositionEvent<HTMLInputElement>) {
		composingRef.current = false
		onCompositionEnd?.(event)
	}

	function handleCompositionStart(event: React.CompositionEvent<HTMLInputElement>) {
		composingRef.current = true
		onCompositionStart?.(event)
	}

	function handleFocus(event: React.FocusEvent<HTMLInputElement>) {
		focusedRef.current = true
		onFocus?.(event)
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		onKeyDown?.(event)

		if (!event.defaultPrevented && fireOnEnter && event.key === 'Enter' && !composingRef.current) {
			commitValue()
			onEnter?.()
		}
	}

	return (
		<div className={tw(styles.base({ fullWidth }), className, disabled && 'opacity-50', readOnly && !disabled && 'opacity-80', classNames?.base)}>
			<div className={tw(styles.surface(), disabled ? 'bg-neutral-900/35 text-neutral-500' : readOnly ? 'bg-neutral-900/55 text-neutral-300' : 'bg-neutral-900/70 text-neutral-100 hover:bg-neutral-800 focus-within:bg-neutral-800', classNames?.surface)}>
				{hasStartContent && <div className={tw(styles.content(), sizeStyles.content, disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-400', classNames?.startContent)}>{startContent}</div>}
				<div className={tw(styles.field(), classNames?.field)}>
					<input
						{...props}
						autoCapitalize={autoCapitalize}
						autoComplete={autoComplete}
						autoCorrect={autoCorrect}
						autoFocus={autoFocus}
						className={tw(
							styles.input({ fullWidth }),
							sizeStyles.inputBase,
							label ? sizeStyles.inputWithLabel : sizeStyles.inputWithoutLabel,
							hasStartContent && 'pl-0',
							hasEndContent && 'pr-0',
							disabled ? 'cursor-not-allowed text-neutral-500 placeholder:text-neutral-600' : readOnly ? 'cursor-default text-neutral-300' : 'text-neutral-100 placeholder:text-neutral-500',
							classNames?.input,
						)}
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
						type='text'
						value={draft}
					/>
					{label && (
						<label
							className={tw(
								styles.label(),
								sizeStyles.label,
								hasStartContent && 'left-0',
								disabled ? 'text-neutral-600 peer-placeholder-shown:text-neutral-600 peer-focus:text-neutral-600' : readOnly ? 'text-neutral-400 peer-placeholder-shown:text-neutral-400 peer-focus:text-neutral-300' : undefined,
								classNames?.label,
							)}>
							{label}
						</label>
					)}
				</div>
				{hasEndContent && <div className={tw(styles.content(), sizeStyles.content, disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-400', classNames?.endContent)}>{endContent}</div>}
			</div>
		</div>
	)
}
