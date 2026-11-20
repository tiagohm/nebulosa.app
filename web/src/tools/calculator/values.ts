// Calculation contract shared by the calculators of the Calculator tool: the outcome of a calculation with the issue of
// each field it cannot use, the reading of the text a field holds into a number within its domain (the domains of real
// optics among them), and the stepping of that text with the arrow keys. A draft holds the text of its fields as typed,
// so an empty or partial field is never replaced by a previous value; it is parsed only here, at the calculation
// boundary. Results are written with the shared formats of `format.ts`, which never show NaN or Infinity.

// Why one field cannot be used, so the field can show it beside the result.
export interface FieldIssue {
	// Display name of the field, as the calculation reads it.
	readonly field: string
	// Sentence telling why, such as "Focal length must be greater than 0.".
	readonly reason: string
}

// Outcome of a calculation from a draft: its value, the fields still empty, why an input or the result is outside the
// model's domain (the sentences joined, with the issue of each field), or why the model gives no finite result.
export type Outcome<T> = { readonly status: 'ready'; readonly value: T } | { readonly status: 'incomplete'; readonly missing: readonly string[] } | { readonly status: 'invalid'; readonly reason: string; readonly issues: readonly FieldIssue[] } | { readonly status: 'unbounded'; readonly explanation: string }

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
	// Why each field outside its domain cannot be used.
	readonly invalid: FieldIssue[]
}

// Numbers greater than zero.
export const POSITIVE: Domain = { test: (value) => value > 0, description: 'greater than 0' }

// Numbers zero or greater.
export const NON_NEGATIVE: Domain = { test: (value) => value >= 0, description: 'zero or greater' }

// Whole numbers greater than zero.
export const POSITIVE_INTEGER: Domain = { test: (value) => value > 0 && Number.isInteger(value), description: 'a whole number greater than 0' }

// Options of a bounded domain.
export interface BetweenOptions {
	// Whether the minimum itself is excluded.
	readonly minOpen?: boolean
	// Whether the maximum itself is excluded.
	readonly maxOpen?: boolean
	// Unit written after each end in the description, with its leading space when it takes one, such as " mm" or "°".
	readonly unit?: string
}

// Returns the domain of the numbers between min and max; each end is included unless marked open.
export function between(min: number, max: number, { minOpen = false, maxOpen = false, unit = '' }: BetweenOptions = {}): Domain {
	return {
		test: (value) => (minOpen ? value > min : value >= min) && (maxOpen ? value < max : value <= max),
		description: `${minOpen ? 'greater than' : 'at least'} ${min}${unit} and ${maxOpen ? 'less than' : 'at most'} ${max}${unit}`,
	}
}

// Focal lengths of real optics in millimeters, from a 1 mm lens to a 100 m telescope, so a typo never gives a field or
// scale that cannot be written.
export const FOCAL_LENGTH = between(1, 100_000, { unit: ' mm' })

// Apertures of real optics in millimeters, from a 1 mm pinhole to a 100 m mirror.
export const APERTURE = between(1, 100_000, { unit: ' mm' })

// Factors of real reducers and Barlows, from a 0.1× focal reducer to a 10× Barlow.
export const FOCAL_MULTIPLIER = between(0.1, 10, { unit: '×' })

// Pixel sizes of real sensors in micrometers.
export const PIXEL_SIZE = between(0.1, 100, { unit: ' µm' })

// Returns the text of a number as JavaScript reads it: the decimal comma as a dot and the minus sign − as a hyphen.
function writtenNumber(text: string) {
	return text.replace(',', '.').replace('−', '-')
}

// Parses the text of a field: undefined when it is blank, NaN when it is not a finite number, the number otherwise.
// A comma is accepted as the decimal separator, and the minus sign − as the hyphen.
export function parseNumber(text: string): number | undefined {
	const trimmed = text.trim()
	if (trimmed === '') return undefined
	const value = Number(writtenNumber(trimmed))
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
	if (Number.isNaN(value)) check.invalid.push({ field: label, reason: `${label} must be a number.` })
	else if (!domain.test(value)) check.invalid.push({ field: label, reason: `${label} must be ${domain.description}.` })
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
	if (check.invalid.length > 0) return { status: 'invalid', reason: check.invalid.map((e) => e.reason).join(' '), issues: check.invalid }
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

// Writes the names of the missing fields as a list in a sentence: "focal length and pixel size".
const MISSING_LIST = new Intl.ListFormat('en', { type: 'conjunction' })

// Returns a field name as it reads inside a sentence: its first letter in lower case, unless the name opens with an
// abbreviation such as FWHM.
function inSentence(label: string) {
	return label.length > 1 && /[A-Z]/.test(label[1]) ? label : label.charAt(0).toLowerCase() + label.slice(1)
}

// Returns the sentence that explains an outcome without a value: the fields to enter, why an input cannot be used,
// or why the model has no finite result.
export function outcomeMessage(outcome: Exclude<Outcome<unknown>, { readonly status: 'ready' }>) {
	if (outcome.status === 'incomplete') return `Enter ${MISSING_LIST.format(outcome.missing.map(inSentence))}.`
	return outcome.status === 'invalid' ? outcome.reason : outcome.explanation
}

// Returns the issues of the fields of every outcome that is invalid, for the fields to show beside the result.
export function fieldIssues(...outcomes: readonly OptionalOutcome<unknown>[]): FieldIssue[] {
	return outcomes.flatMap((e) => (e?.status === 'invalid' ? e.issues : []))
}

// Returns the text of a field stepped by one unit of its last typed decimal (by ten with large), up or down, keeping
// that number of decimals: "3.76" steps to "3.77", "600" to "601"; undefined for a field that is empty, not a number,
// or written with an exponent, which has no last digit to step.
export function stepText(text: string, direction: 1 | -1, large: boolean = false) {
	const value = parseNumber(text)
	const written = writtenNumber(text.trim())
	if (value === undefined || Number.isNaN(value) || /e/i.test(written)) return undefined
	const decimals = written.includes('.') ? written.length - written.indexOf('.') - 1 : 0
	const next = (value + direction * (large ? 10 : 1) * 10 ** -decimals).toFixed(decimals)
	return Number(next) === 0 ? next.replace('-', '') : next
}

// Whether a draft differs from the values it was imported or reset with, in any of their fields.
export function differs<D extends object>(draft: D, reference: D) {
	return (Object.keys(reference) as (keyof D)[]).some((key) => draft[key] !== reference[key])
}
