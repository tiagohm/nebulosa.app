// Calculation contract shared by the calculators of the Calculator tool: the outcome of a calculation, the reading of
// the text a field holds into a number within its domain, and the display formats of the results. A draft holds the
// text of its fields as typed, so an empty or partial field is never replaced by a previous value; it is parsed only
// here, at the calculation boundary. Formats never show NaN or Infinity.

// Outcome of a calculation from a draft: its value, the fields still empty, why an input or the result is outside the
// model's domain, or why the model gives no finite result.
export type Outcome<T> = { readonly status: 'ready'; readonly value: T } | { readonly status: 'incomplete'; readonly missing: readonly string[] } | { readonly status: 'invalid'; readonly reason: string } | { readonly status: 'unbounded'; readonly explanation: string }

// Outcome of an output that depends only on optional fields; undefined while all of them are empty.
export type OptionalOutcome<T> = Outcome<T> | undefined

// Domain a field accepts.
export interface Domain {
	// Whether a finite number lies in the domain.
	readonly test: (value: number) => boolean
	// Description of the domain completing "<field> must be …", such as "greater than 0".
	readonly description: string
}

// Fields read from a draft that are empty or outside their domain, by display name.
export interface Check {
	// Names of the required fields that are empty.
	readonly missing: string[]
	// Sentences telling why a field cannot be used.
	readonly invalid: string[]
}

// Numbers greater than zero.
export const POSITIVE: Domain = { test: (value) => value > 0, description: 'greater than 0' }

// Numbers zero or greater.
export const NON_NEGATIVE: Domain = { test: (value) => value >= 0, description: 'zero or greater' }

// Whole numbers greater than zero.
export const POSITIVE_INTEGER: Domain = { test: (value) => value > 0 && Number.isInteger(value), description: 'a whole number greater than 0' }

// Returns the domain of the numbers between min and max; each end is included unless marked open.
export function between(min: number, max: number, minOpen: boolean = false, maxOpen: boolean = false): Domain {
	return {
		test: (value) => (minOpen ? value > min : value >= min) && (maxOpen ? value < max : value <= max),
		description: `${minOpen ? 'greater than' : 'at least'} ${min} and ${maxOpen ? 'less than' : 'at most'} ${max}`,
	}
}

// Parses the text of a field: undefined when it is blank, NaN when it is not a finite number, the number otherwise.
// A comma is accepted as the decimal separator.
export function parseNumber(text: string): number | undefined {
	const trimmed = text.trim()
	if (trimmed === '') return undefined
	const value = Number(trimmed.replace(',', '.'))
	return Number.isFinite(value) ? value : Number.NaN
}

// Returns the text a field shows for a number, empty for an absent or non-positive value so that a quantity no source
// knows reads as missing rather than as zero.
export function positiveText(value: number | undefined) {
	return value !== undefined && Number.isFinite(value) && value > 0 ? String(value) : ''
}

// Returns an empty check.
export function newCheck(): Check {
	return { missing: [], invalid: [] }
}

// Reads a required field into check: its number, or NaN when it is empty or outside domain, which then records it
// as missing or invalid. A NaN is never used, since outcome computes nothing while the check records a problem.
export function required(check: Check, label: string, text: string, domain: Domain): number {
	const value = parseNumber(text)

	if (value === undefined) {
		check.missing.push(label)
		return Number.NaN
	}

	return accept(check, label, value, domain) ? value : Number.NaN
}

// Reads an optional field into check: undefined when it is empty, NaN when it is outside domain (recorded as invalid),
// its number otherwise.
export function optional(check: Check, label: string, text: string, domain: Domain): number | undefined {
	const value = parseNumber(text)
	if (value === undefined) return undefined
	return accept(check, label, value, domain) ? value : Number.NaN
}

// Whether a parsed number lies in domain; records why not in check.
function accept(check: Check, label: string, value: number, domain: Domain) {
	if (Number.isNaN(value)) check.invalid.push(`${label} must be a number.`)
	else if (!domain.test(value)) check.invalid.push(`${label} must be ${domain.description}.`)
	else return true
	return false
}

// Returns a ready outcome.
export function ready<T>(value: T): Outcome<T> {
	return { status: 'ready', value }
}

// Returns the outcome of a check: invalid when a field is outside its domain, incomplete when a required field is
// empty, otherwise what compute returns, which may itself be invalid or unbounded.
export function outcome<T>(check: Check, compute: () => Outcome<T>): Outcome<T> {
	if (check.invalid.length > 0) return { status: 'invalid', reason: check.invalid.join(' ') }
	if (check.missing.length > 0) return { status: 'incomplete', missing: check.missing }
	return compute()
}

// Returns the outcome of an output computed from optional fields: undefined while every one of texts is empty, so the
// output is simply not shown; otherwise read reads the fields into a check and returns the computation, run only when
// the check records no problem.
export function optionalOutcome<T>(texts: readonly string[], read: (check: Check) => () => Outcome<T>): OptionalOutcome<T> {
	if (texts.every((text) => text.trim() === '')) return undefined
	const check = newCheck()
	const compute = read(check)
	return outcome(check, compute)
}

// Returns the sentence that explains an outcome without a value: the fields to enter, why an input cannot be used,
// or why the model has no finite result.
export function outcomeMessage(outcome: Exclude<Outcome<unknown>, { readonly status: 'ready' }>) {
	if (outcome.status === 'incomplete') return `Enter ${outcome.missing.join(', ')}.`
	return outcome.status === 'invalid' ? outcome.reason : outcome.explanation
}

// Whether a draft differs from the values it was imported or reset with, in any of their fields.
export function differs<D extends object>(draft: D, reference: D) {
	return (Object.keys(reference) as (keyof D)[]).some((key) => draft[key] !== reference[key])
}

// Formats a finite number with a fixed number of decimals; a dash for a value that is not finite.
export function formatFixed(value: number, digits: number) {
	return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

// Formats a duration in seconds: seconds below a minute ("12.5 s"), then minutes and seconds ("4 min 05 s"), then
// hours and minutes ("12 h 05 min"); a dash for a value that is not finite.
export function formatDuration(seconds: number) {
	if (!Number.isFinite(seconds)) return '—'
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`
	const total = Math.round(seconds)
	if (total < 3600) return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`
	const minutes = Math.round(seconds / 60)
	return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}
