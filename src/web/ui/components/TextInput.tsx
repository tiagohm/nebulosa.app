import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'
import { tw } from '@/shared/util'

const textInputStyles = tv({
	slots: {
		base: 'relative inline-flex min-w-0 align-top',
		input: 'peer h-11 w-full rounded-lg border bg-neutral-900/70 px-4 text-sm shadow-sm outline-none transition',
		label: 'pointer-events-none absolute left-4 right-4 origin-left truncate transition-all duration-150 ease-out',
	},
	variants: {
		hasLabel: {
			true: {
				input: 'pt-5 pb-1.5 placeholder:text-transparent focus:placeholder:text-neutral-500',
				label: 'top-1.5 text-xs leading-none text-neutral-400 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-placeholder-shown:text-neutral-500 peer-focus:top-1.5 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-neutral-200',
			},
			false: {
				input: 'py-2.5 placeholder:text-neutral-500',
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

export interface TextInputClassNames {
	readonly base?: string
	readonly input?: string
	readonly label?: string
}

export interface TextInputProps extends Omit<React.ComponentPropsWithRef<'input'>, 'children' | 'className' | 'defaultValue' | 'disabled' | 'maxLength' | 'placeholder' | 'readOnly' | 'type' | 'value'> {
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
	const displayedPlaceholder = label ? (placeholder ?? ' ') : placeholder

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
		<div className={tw(styles.base({ fullWidth }), className, disabled && 'opacity-60', readOnly && !disabled && 'opacity-90', classNames?.base)}>
			<input
				{...props}
				autoCapitalize={autoCapitalize}
				autoComplete={autoComplete}
				autoCorrect={autoCorrect}
				autoFocus={autoFocus}
				className={tw(
					styles.input({ fullWidth }),
					disabled ? 'cursor-not-allowed border-none bg-neutral-900/35 text-neutral-500 placeholder:text-neutral-600' : readOnly ? 'cursor-default border-none bg-neutral-900/55 text-neutral-300' : 'border-none text-neutral-100 placeholder:text-neutral-500 hover:bg-neutral-800 focus:bg-neutral-800',
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
			{label && <label className={tw(styles.label(), disabled ? 'text-neutral-600 peer-placeholder-shown:text-neutral-600 peer-focus:text-neutral-600' : readOnly ? 'text-neutral-400 peer-placeholder-shown:text-neutral-400 peer-focus:text-neutral-300' : undefined, classNames?.label)}>{label}</label>}
		</div>
	)
}
