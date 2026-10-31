import { cn } from 'cn'
import type { ReactNode } from 'react'

// Shared look of every single-line form control (text, number and select trigger).
export const inputClassName =
	'box-border h-9.5 w-full min-w-0 rounded-sm border border-line-200 bg-base-200 px-3 py-2 font-mono text-sm leading-5 text-ink-100 transition-colors duration-150 placeholder:text-ink-300 hover:border-ink-300 focus:border-accent focus:outline-2 focus:-outline-offset-1 focus:outline-accent disabled:cursor-not-allowed disabled:border-line-100 disabled:bg-base-300 disabled:text-ink-300'

// Unit or short text drawn inside the right end of a control, such as "mm" or "°". It is kept in its own
// case, unlike the uppercase label, so symbols such as µ render as written.
export function InputSuffix({ children }: { readonly children: ReactNode }) {
	return <span className="pointer-events-none absolute top-1/2 right-3 z-2 -translate-y-1/2 font-mono text-xs leading-none text-ink-300 select-none">{children}</span>
}

// Right padding of a control that leaves room for a suffix of the given length in characters.
export function suffixPadding(suffix: string) {
	return `calc(${suffix.length}ch + 1.25rem)`
}

export interface FieldProps {
	readonly label?: string
	readonly className?: string
	readonly children: ReactNode
}

export function Field({ label, className, children }: FieldProps) {
	return (
		<div className={cn('flex min-w-fit flex-col gap-2', className)}>
			{label && <label className="text-xs font-medium tracking-[0.08em] text-ink-200 uppercase">{label}</label>}
			{children}
		</div>
	)
}
