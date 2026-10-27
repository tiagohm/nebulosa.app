// Value arithmetic of NumberInput: snapping a typed or stepped value to the step grid and the bounds without the
// binary floating-point residue of a decimal step (0.1 + 0.2 shows 0.3, not 0.30000000000000004).

// Largest digit count Number.prototype.toFixed accepts.
const MAX_FRACTION_DIGITS = 100

// Returns the number of decimal places of step as written (0.05 has 2, 1e-7 has 7, 5 has 0), which is the precision
// of every multiple of it; step is finite and positive.
export function stepFractionDigits(step: number): number {
	const [mantissa, exponent = '0'] = String(step).toLowerCase().split('e')
	const fraction = mantissa.split('.')[1]?.length ?? 0
	return Math.min(MAX_FRACTION_DIGITS, Math.max(0, fraction - +exponent))
}

// Returns value rounded to the nearest multiple of step, rounded again to the decimal places of step to drop the
// floating-point residue of the multiplication, then clamped to min and max when given (a bound is kept exactly as
// given, even when it is not a multiple of step).
export function snapToStep(value: number, step: number, min?: number, max?: number): number {
	let v = +(Math.round(value / step) * step).toFixed(stepFractionDigits(step))
	if (min !== undefined) v = Math.max(min, v)
	if (max !== undefined) v = Math.min(max, v)
	return v
}
