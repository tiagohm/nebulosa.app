import type { ReactNode } from 'react'
import { tv, type VariantProps } from 'tailwind-variants'

// The one label and value row of the app's contextual panels, inspectors, and results: on one line while both fit,
// the label at the start and the value at the end; a value that does not fit goes below its label, still at the end,
// and a label or value wider than the panel wraps instead of being cut. A list groups consecutive rows outside a
// section with the spacing a section gives them.

// Value of a row, by its tone: plain, a success, or a failure.
const value = tv({
	base: 'ml-auto max-w-full min-w-0 text-right wrap-break-word tabular-nums',
	variants: {
		tone: {
			default: 'text-ink-100',
			success: 'text-success',
			danger: 'text-danger',
		},
	},
	defaultVariants: {
		tone: 'default',
	},
})

export interface DataRowProps extends VariantProps<typeof value> {
	// Name of the datum.
	readonly label: string
	// Its value, with its unit.
	readonly children: ReactNode
}

// Label and value of one datum.
export function DataRow({ label, tone, children }: DataRowProps) {
	return (
		<div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm leading-5">
			<span className="min-w-0 wrap-break-word text-ink-300">{label}</span>
			<span className={value({ tone })}>{children}</span>
		</div>
	)
}

// Consecutive rows, spaced as the rows of a section.
export function DataList({ children }: { readonly children: ReactNode }) {
	return <div className="flex flex-col gap-0">{children}</div>
}
