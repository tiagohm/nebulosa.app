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
	// Tooltip of the box and its label, such as what checking it selects.
	readonly title?: string
	// Whether the label is read only by assistive technology, for a box whose column or row already says what it is.
	readonly hideLabel?: boolean
}

// Labeled checkbox.
export function Checkbox({ label, checked, onChange, disabled, className, title, hideLabel = false }: CheckboxProps) {
	return (
		<label title={title} className={cn('flex cursor-pointer items-center gap-2 text-sm text-ink-200 select-none has-disabled:cursor-not-allowed has-disabled:text-ink-300', className)}>
			<input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="m-0 size-3.5 cursor-pointer accent-accent disabled:cursor-not-allowed" />
			{hideLabel ? <span className="sr-only">{label}</span> : label}
		</label>
	)
}
