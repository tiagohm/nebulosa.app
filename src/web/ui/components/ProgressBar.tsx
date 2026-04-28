import type * as React from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { clamp, tw } from '@/shared/util'

const progressBarStyles = tv({
	slots: {
		base: 'inline-flex min-w-0 select-none align-top',
		body: 'flex min-w-0 items-center gap-2',
		content: 'flex shrink-0 items-center whitespace-nowrap',
		track: 'relative min-w-0 flex-1 overflow-hidden rounded-full transition',
		fill: 'absolute inset-y-0 left-0 rounded-full bg-(--color-variant) transition-[width] duration-200 ease-out',
	},
	variants: {
		size: {
			sm: {
				base: 'min-w-24',
				content: 'text-xs',
				track: 'h-1',
			},
			md: {
				base: 'min-w-28',
				content: 'text-sm',
				track: 'h-1.5',
			},
			lg: {
				base: 'min-w-32',
				content: 'text-base',
				track: 'h-2',
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
		fullWidth: {
			true: {
				base: 'w-full',
				body: 'w-full',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		color: 'primary',
		fullWidth: true,
	},
})

type ProgressBarVariants = VariantProps<typeof progressBarStyles>

export interface ProgressBarClassNames {
	readonly base?: ClassValue
	readonly body?: ClassValue
	readonly startContent?: ClassValue
	readonly endContent?: ClassValue
	readonly track?: ClassValue
	readonly fill?: ClassValue
}

export interface ProgressBarProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'color'>, ProgressBarVariants {
	readonly classNames?: ProgressBarClassNames
	readonly value?: number
	readonly minValue?: number
	readonly maxValue?: number
	readonly disabled?: boolean
	readonly readOnly?: boolean
	readonly indeterminate?: boolean
	readonly startContent?: React.ReactNode
	readonly endContent?: React.ReactNode
}

// Normalizes progress bounds into an ascending numeric tuple.
function normalizeProgressBounds(minValue: number, maxValue: number) {
	const minimumValue = Number.isFinite(minValue) ? minValue : 0
	const maximumValue = Number.isFinite(maxValue) ? maxValue : 100

	return minimumValue <= maximumValue ? ([minimumValue, maximumValue] as const) : ([maximumValue, minimumValue] as const)
}

// Clamps progress values into the normalized min/max range.
function normalizeProgressValue(value: number | undefined, minValue: number, maxValue: number) {
	return clamp(Number.isFinite(value) ? value! : minValue, minValue, maxValue)
}

// Converts a normalized progress value into a 0..1 fill ratio.
function progressValueRatio(value: number, minValue: number, maxValue: number) {
	if (minValue === maxValue) return 1
	return clamp((value - minValue) / (maxValue - minValue), 0, 1)
}

// Render a color-aware determinate or indeterminate progress indicator without labels.
export function ProgressBar({ className, classNames, color, disabled = false, endContent, fullWidth, indeterminate = false, maxValue = 100, minValue = 0, readOnly = false, ref, size = 'md', startContent, style, value, ...props }: ProgressBarProps) {
	const [minimumValue, maximumValue] = normalizeProgressBounds(minValue, maxValue)
	const normalizedValue = normalizeProgressValue(value, minimumValue, maximumValue)
	const fillRatio = progressValueRatio(normalizedValue, minimumValue, maximumValue)
	const styles = progressBarStyles({ color, fullWidth, size })
	const stateClassName = disabled ? 'cursor-not-allowed opacity-40 pointer-events-none' : readOnly ? 'cursor-default opacity-90 pointer-events-none' : 'cursor-default'
	const contentClassName = disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-400'
	const trackClassName = disabled ? 'bg-neutral-900/35' : readOnly ? 'bg-neutral-900/55' : 'bg-neutral-800'
	const hasStartContent = startContent !== undefined && startContent !== null
	const hasEndContent = endContent !== undefined && endContent !== null

	return (
		<div {...props} className={tw(styles.base(), stateClassName, className, classNames?.base)} ref={ref} style={style}>
			<div className={tw(styles.body(), classNames?.body)}>
				{hasStartContent && <div className={tw(styles.content(), contentClassName, classNames?.startContent)}>{startContent}</div>}
				<div className={tw(styles.track(), trackClassName, classNames?.track)}>
					<div className={tw(styles.fill(), indeterminate && 'progress-bar-indeterminate w-2/5 transition-none', classNames?.fill)} style={indeterminate ? undefined : { width: `${fillRatio * 100}%` }} />
				</div>
				{hasEndContent && <div className={tw(styles.content(), contentClassName, classNames?.endContent)}>{endContent}</div>}
			</div>
		</div>
	)
}
