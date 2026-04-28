import type * as React from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { tw } from '@/shared/util'

const switchStyles = tv({
	slots: {
		base: 'inline-flex max-w-full items-center align-top select-none',
		input: 'peer sr-only',
		control: 'relative shrink-0 rounded-full transition',
		thumb: 'absolute top-1/2 left-0.5 flex -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-sm transition-all duration-150 ease-out',
		label: 'leading-none',
	},
	variants: {
		size: {
			sm: {
				base: 'gap-1.5',
				control: 'h-5 w-9',
				thumb: 'size-4',
				label: 'text-xs',
			},
			md: {
				base: 'gap-2',
				control: 'h-6 w-11',
				thumb: 'size-5',
				label: 'text-sm',
			},
			lg: {
				base: 'gap-2.5',
				control: 'h-7 w-14',
				thumb: 'size-6',
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

// Match the thumb travel distance to each switch track size.
const switchThumbTranslateStyles = {
	sm: 'translate-x-4',
	md: 'translate-x-5',
	lg: 'translate-x-7',
} as const

export interface SwitchClassNames {
	readonly base?: ClassValue
	readonly input?: ClassValue
	readonly control?: ClassValue
	readonly thumb?: ClassValue
	readonly label?: ClassValue
}

type SwitchVariants = VariantProps<typeof switchStyles>

export interface SwitchProps extends Omit<React.ComponentPropsWithRef<'input'>, 'checked' | 'defaultChecked' | 'step' | 'size' | 'color' | 'type' | 'value'>, SwitchVariants {
	readonly children?: React.ReactNode
	readonly classNames?: SwitchClassNames
	readonly label?: React.ReactNode
	readonly thumbContent?: React.ReactNode
	readonly value?: boolean
	readonly onValueChange?: (value: boolean) => void
}

// Render a controlled switch with a sliding thumb and optional label content.
export function Switch({ autoFocus, children, className, classNames, disabled = false, label, name, onBlur, onChange, onClick, onFocus, onKeyDown, onValueChange, readOnly = false, ref, size = 'md', color = 'primary', style, tabIndex, thumbContent, value = false, ...props }: SwitchProps) {
	const checked = value === true
	const content = children ?? label
	const styles = switchStyles({ size, color })

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

	// Prevent mouse interaction from toggling a read-only switch.
	function handleClick(event: React.MouseEvent<HTMLInputElement>) {
		if (readOnly) {
			event.preventDefault()
		}

		onClick?.(event)
	}

	// Prevent keyboard toggles while the switch is read-only.
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
			<span className={tw(styles.control(), checked ? 'bg-(--color-variant)' : 'bg-neutral-800', !disabled && 'peer-focus-visible:ring-0', !disabled && !readOnly && (checked ? 'hover:bg-(--color-variant)/90 active:bg-(--color-variant)/80' : 'hover:bg-neutral-700 active:bg-neutral-600'), classNames?.control)}>
				<span className={tw(styles.thumb(), checked ? switchThumbTranslateStyles[size] : 'translate-x-0', checked ? 'text-(--color-variant)' : 'text-neutral-500', classNames?.thumb)}>{thumbContent}</span>
			</span>
			{content !== undefined && content !== null && <span className={tw(styles.label(), disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-200', classNames?.label)}>{content}</span>}
		</label>
	)
}
