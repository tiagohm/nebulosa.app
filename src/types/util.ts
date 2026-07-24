export function finiteNumber(value: unknown, fallback: number) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function positiveNumber(value: unknown, fallback: number) {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function nonNegativeNumber(value: unknown, fallback: number) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

// Clamps a number into the inclusive [min, max] range.
export function clamp(value: number, min: number, max: number) {
	if (!(value >= min)) return min
	if (value > max) return max
	return value
}

// Clamps a number into an integer range.
export function clampInteger(value: number, min: number, max: number) {
	if (max < min) return min
	if (!Number.isFinite(value)) return min
	return Math.max(min, Math.min(Math.trunc(value), max))
}
