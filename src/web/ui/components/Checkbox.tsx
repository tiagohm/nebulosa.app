import type * as React from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { tw } from '@/shared/util'
import { Icons } from '../Icon'

const checkboxStyles = tv({
	slots: {
		base: 'inline-flex max-w-full items-center align-top select-none',
		input: 'peer sr-only',
		control: 'flex shrink-0 items-center justify-center border-none bg-transparent transition',
		icon: 'transition-all duration-150 ease-out',
		label: 'leading-none',
	},
	variants: {
		size: {
			sm: {
				base: 'gap-1.5',
				control: 'size-4 rounded',
				label: 'text-xs',
				icon: 'size-3',
			},
			md: {
				base: 'gap-2',
				control: 'size-5 rounded-md',
				label: 'text-sm',
				icon: 'size-4',
			},
			lg: {
				base: 'gap-2.5',
				control: 'size-6 rounded-lg',
				label: 'text-base',
				icon: 'size-5',
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

export interface CheckboxClassNames {
	readonly base?: ClassValue
	readonly input?: ClassValue
	readonly control?: ClassValue
	readonly icon?: ClassValue
	readonly label?: ClassValue
}

type CheckboxVariants = VariantProps<typeof checkboxStyles>

export interface CheckboxProps extends Omit<React.ComponentPropsWithRef<'input'>, 'checked' | 'defaultChecked' | 'step' | 'size' | 'color' | 'type' | 'value'>, CheckboxVariants {
	readonly children?: React.ReactNode
	readonly classNames?: CheckboxClassNames
	readonly label?: React.ReactNode
	readonly value?: boolean
	readonly onValueChange?: (value: boolean) => void
}

// Render a controlled checkbox with optional label content.
export function Checkbox({ autoFocus, children, className, classNames, disabled = false, label, name, onBlur, onChange, onClick, onFocus, onKeyDown, onValueChange, readOnly = false, ref, size, color, style, tabIndex, value = false, ...props }: CheckboxProps) {
	const checked = value === true
	const content = label ?? children
	const styles = checkboxStyles({ size, color })

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

	// Prevent mouse interaction from toggling a read-only checkbox.
	function handleClick(event: React.MouseEvent<HTMLInputElement>) {
		if (readOnly) {
			event.preventDefault()
		}

		onClick?.(event)
	}

	// Prevent keyboard toggles while the checkbox is read-only.
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
				type="checkbox"
			/>
			<span
				className={tw(
					styles.control(),
					!disabled && 'peer-focus-visible:ring-0',
					checked ? 'bg-(--color-variant) text-white' : 'bg-neutral-900 text-transparent',
					!disabled && !readOnly && (checked ? 'hover:bg-(--color-variant)/90 active:bg-(--color-variant)/80' : 'hover:bg-neutral-800 active:bg-neutral-700'),
					classNames?.control,
				)}>
				<Icons.Check className={tw(styles.icon(), checked ? 'scale-100 opacity-100' : 'scale-75 opacity-0', classNames?.icon)} />
			</span>
			{content !== undefined && content !== null && <span className={tw(styles.label(), disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-200', classNames?.label)}>{content}</span>}
		</label>
	)
}
