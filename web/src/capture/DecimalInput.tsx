import { useState } from 'react'
import { TextInput } from '../ui/TextInput'

// Decimal field of the Camera Capture panel for times such as 0.0001 s. Unlike NumberInput, it never rounds
// to a step, so the value typed is the value sent; a value that is not a number, or is below its minimum,
// stays in the field without being committed.

export interface DecimalInputProps {
	readonly label: string
	// Committed value.
	readonly value: number
	// Called with every valid value typed.
	readonly onChange: (value: number) => void
	// Lowest valid value.
	readonly min: number
	// Whether the minimum itself is invalid, as for an exposure time that must be positive.
	readonly exclusiveMin?: boolean
	// Unit drawn inside the field.
	readonly suffix?: string
	readonly disabled?: boolean
	readonly className?: string
}

// Returns the value of a typed text, or undefined when it is not a finite number above the minimum.
export function parseDecimal(text: string, min: number, exclusiveMin = false): number | undefined {
	const trimmed = text.trim()
	if (!trimmed) return undefined
	const value = Number(trimmed)
	if (!Number.isFinite(value)) return undefined
	return (exclusiveMin ? value > min : value >= min) ? value : undefined
}

// Decimal input.
export function DecimalInput({ label, value, onChange, min, exclusiveMin = false, suffix, disabled, className }: DecimalInputProps) {
	// Text being typed; undefined shows the committed value.
	const [draft, setDraft] = useState<string>()
	const invalid = draft !== undefined && parseDecimal(draft, min, exclusiveMin) === undefined

	return (
		<div className={className}>
			<TextInput
				label={label}
				inputMode="decimal"
				value={draft ?? String(value)}
				suffix={suffix}
				disabled={disabled}
				onChange={(e) => {
					const text = e.target.value
					setDraft(text)
					const parsed = parseDecimal(text, min, exclusiveMin)
					if (parsed !== undefined) onChange(parsed)
				}}
				onBlur={() => setDraft(undefined)}
			/>
			{invalid && <p className="m-0 mt-1 text-xs leading-4 text-danger">{exclusiveMin ? `Enter a number greater than ${min}.` : `Enter a number of at least ${min}.`}</p>}
		</div>
	)
}
