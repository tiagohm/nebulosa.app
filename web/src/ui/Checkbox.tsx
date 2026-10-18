import { cn } from 'cn'

// Native checkbox with its label, styled for compact panels.

export interface CheckboxProps {
	// Text next to the box.
	readonly label: string
	// Whether the box is checked.
	readonly checked: boolean
	// Called with the new checked state.
	readonly onChange: (checked: boolean) => void
	// Whether the control is disabled.
	readonly disabled?: boolean
	// Extra classes of the label element.
	readonly className?: string
}

// Labeled checkbox.
export function Checkbox({ label, checked, onChange, disabled, className }: CheckboxProps) {
	return (
		<label className={cn('flex cursor-pointer items-center gap-2 text-[13px] text-ink-200 select-none has-disabled:cursor-not-allowed has-disabled:text-ink-300', className)}>
			<input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="m-0 size-3.5 cursor-pointer accent-accent disabled:cursor-not-allowed" />
			{label}
		</label>
	)
}
