import type * as React from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { tw } from '@/shared/util'

const radioStyles = tv({
	slots: {
		base: 'inline-flex max-w-full items-center align-top select-none',
		input: 'peer sr-only',
		control: 'flex shrink-0 items-center justify-center rounded-full border bg-neutral-900 transition',
		indicator: 'rounded-full transition-all duration-150 ease-out',
		label: 'leading-none',
	},
	variants: {
		size: {
			sm: {
				base: 'gap-1.5',
				control: 'size-4',
				indicator: 'size-2',
				label: 'text-xs',
			},
			md: {
				base: 'gap-2',
				control: 'size-5',
				indicator: 'size-2.5',
				label: 'text-sm',
			},
			lg: {
				base: 'gap-2.5',
				control: 'size-6',
				indicator: 'size-3',
				label: 'text-base',
			},
		},
		color: {
			default: '[--color-variant:var(--color-neutral-500)]',
			primary: '[--color-variant:var(--primary)]',
			secondary: '[--color-variant:var(--secondary)]',
			success: '[--color-variant:var(--success)]',
			danger: '[--color-variant:var(--danger)]',
			warning: '[--color-variant:var(--warning)]',
		},
	},
	defaultVariants: {
		size: 'md',
		color: 'primary',
	},
})

export interface RadioClassNames {
	readonly base?: ClassValue
	readonly input?: ClassValue
	readonly control?: ClassValue
	readonly indicator?: ClassValue
	readonly label?: ClassValue
}

type RadioVariants = VariantProps<typeof radioStyles>

export interface RadioProps extends Omit<React.ComponentPropsWithRef<'input'>, 'checked' | 'defaultChecked' | 'step' | 'size' | 'color' | 'type' | 'value'>, RadioVariants {
	readonly children?: React.ReactNode
	readonly classNames?: RadioClassNames
	readonly label?: React.ReactNode
	readonly value?: boolean
	readonly onValueChange?: (value: boolean) => void
}

// Render a controlled radio with optional label content.
export function Radio({ autoFocus, children, className, classNames, disabled = false, label, name, onBlur, onChange, onClick, onFocus, onKeyDown, onValueChange, readOnly = false, ref, size, color, style, tabIndex, value = false, ...props }: RadioProps) {
	const checked = value === true
	const content = label ?? children
	const styles = radioStyles({ size, color })

	// Ignore state changes while disabled or read-only.
	function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
		if (disabled || readOnly) {
			event.preventDefault()
			event.target.checked = checked
			return
		}

		onChange?.(event)
		onValueChange?.(event.target.checked)
	}

	// Prevent mouse interaction from toggling a read-only radio.
	function handleClick(event: React.MouseEvent<HTMLInputElement>) {
		if (readOnly) {
			event.preventDefault()
		}

		onClick?.(event)
	}

	// Prevent keyboard toggles while the radio is read-only.
	function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (readOnly && (event.key === ' ' || event.key === 'Spacebar')) {
			event.preventDefault()
		}

		onKeyDown?.(event)
	}

	return (
		<label className={tw(styles.base(), disabled ? 'cursor-not-allowed opacity-40' : readOnly ? 'cursor-default opacity-90 pointer-events-none' : 'cursor-pointer', className, classNames?.base)}>
			<input
				{...props}
				autoFocus={autoFocus}
				checked={checked}
				className={tw(styles.input(), classNames?.input)}
				disabled={disabled}
				name={name}
				onBlur={onBlur}
				onChange={handleChange}
				onClick={handleClick}
				onFocus={onFocus}
				onKeyDown={handleKeyDown}
				readOnly={readOnly}
				ref={ref}
				style={style}
				tabIndex={tabIndex}
				type="radio"
			/>
			<span className={tw(styles.control(), checked ? 'border-(--color-variant)' : 'border-none', !disabled && !readOnly && (checked ? 'hover:border-(--color-variant)/90 active:border-(--color-variant)/80' : 'hover:bg-neutral-800 active:bg-neutral-700'), classNames?.control)}>
				<span className={tw(styles.indicator(), checked ? 'scale-100 opacity-100 bg-(--color-variant)' : 'scale-75 opacity-0 bg-transparent', classNames?.indicator)} />
			</span>
			{content !== undefined && content !== null && <span className={tw(styles.label(), disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-200', classNames?.label)}>{content}</span>}
		</label>
	)
}
