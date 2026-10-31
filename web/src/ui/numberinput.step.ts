// Value arithmetic of NumberInput: snapping a typed or stepped value to the step grid and the bounds, and showing a
// value that comes from outside the field, without the binary floating-point residue of a decimal number (0.1 + 0.2
// shows 0.3, not 0.30000000000000004, and a degree value stored in radians shows 1.3, not 1.3000000000000003).

// Largest digit count Number.prototype.toFixed accepts.
const MAX_FRACTION_DIGITS = 100

// Significant digits a decimal number keeps in NumberInput; a double holds 15, so the digits after these are residue.
const SIGNIFICANT_DIGITS = 12

// Returns the number of decimal places of value as written (0.05 has 2, 1e-7 has 7, 5 has 0), ignoring its
// floating-point residue; value is finite.
function fractionDigits(value: number): number {
	const [mantissa, exponent = '0'] = String(+value.toPrecision(SIGNIFICANT_DIGITS)).toLowerCase().split('e')
	const fraction = mantissa.split('.')[1]?.length ?? 0
	return Math.min(MAX_FRACTION_DIGITS, Math.max(0, fraction - +exponent))
}

// Returns the number of decimal places of step, which is the precision of every multiple of it; step is finite and
// positive.
export function stepFractionDigits(step: number): number {
	return fractionDigits(step)
}

// Returns the value a field shows: value rounded to the precision of what the field can commit, that is the decimal
// places of step, or of a bound when it is finer, since a bound is kept exactly (see snapToStep). A value set from
// outside the field, as one converted from radians or computed by a solver, carries more digits than that.
export function displayValue(value: number, step: number, min?: number, max?: number): number {
	const digits = Math.max(stepFractionDigits(step), min === undefined ? 0 : fractionDigits(min), max === undefined ? 0 : fractionDigits(max))
	return +value.toFixed(digits)
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
