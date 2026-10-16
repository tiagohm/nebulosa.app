import { cn } from 'cn'
import type { ReactNode } from 'react'

// Shared look of every single-line form control (text, number and select trigger).
export const inputClassName =
	'box-border h-[38px] w-full min-w-0 rounded-sm border border-line-200 bg-base-200 px-3 py-2 font-mono text-sm leading-5 text-ink-100 transition-colors duration-150 placeholder:text-ink-300 hover:border-ink-300 focus:border-accent focus:outline-2 focus:-outline-offset-1 focus:outline-accent disabled:cursor-not-allowed disabled:border-line-100 disabled:bg-base-300 disabled:text-ink-300'

export interface FieldProps {
	readonly label?: string
	readonly className?: string
	readonly children: ReactNode
}

export function Field({ label, className, children }: FieldProps) {
	return (
		<div className={cn('flex min-w-0 flex-col gap-2', className)}>
			{label && (
				<label className="text-xs font-medium tracking-[0.08em] text-ink-200 uppercase">
					{label}
				</label>
			)}
			{children}
		</div>
	)
}
