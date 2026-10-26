import type { IndiBlobElement, IndiNumberElement, IndiProperty } from 'api'
import { formatIndiNumber, parseIndiNumber } from 'nebulosa/src/devices/indi/number'

// Pure presentation helpers of the INDI Properties view: the groups of the vectors in driver order, the search,
// and the text of permissions, kinds, rules, numbers, and BLOB deliveries. Numbers stay in the driver's own units
// and format; nothing infers a unit or an angle from a name.

// Group of the vectors the driver defines without one.
export const OTHER_GROUP = 'Other'

// Vectors of one group of a device.
export interface IndiVectorGroup {
	// Group name, or OTHER_GROUP.
	readonly name: string
	// Vectors of the group, in driver order.
	readonly vectors: readonly IndiProperty[]
}

// Text of each permission.
export const PERMISSION_LABELS: Readonly<Record<'ro' | 'wo' | 'rw', string>> = { ro: 'read-only', wo: 'write-only', rw: 'read-write' }

// Text of each vector kind.
export const TYPE_LABELS: Readonly<Record<IndiProperty['type'], string>> = { TEXT: 'Text', NUMBER: 'Number', SWITCH: 'Switch', LIGHT: 'Light', BLOB: 'BLOB' }

// Text of each switch rule.
export const RULE_LABELS: Readonly<Record<'OneOfMany' | 'AtMostOne' | 'AnyOfMany', string>> = { OneOfMany: 'one of many', AtMostOne: 'at most one', AnyOfMany: 'any of many' }

// Text color of each property state; the state is always written too.
export const STATE_COLORS: Readonly<Record<IndiProperty['state'], string>> = { Idle: 'text-ink-300', Ok: 'text-success', Busy: 'text-accent', Alert: 'text-danger' }

// Returns the label of a vector or element, or its name when the driver gave none.
export function labelOf(item: { readonly name: string; readonly label?: string }) {
	return item.label || item.name
}

// Groups vectors by their group, in the order each group first appears.
export function groupVectors(vectors: readonly IndiProperty[]): IndiVectorGroup[] {
	const groups = new Map<string, IndiProperty[]>()

	for (const vector of vectors) {
		const name = vector.group || OTHER_GROUP
		const group = groups.get(name)
		if (group) group.push(vector)
		else groups.set(name, [vector])
	}

	return Array.from(groups, ([name, members]) => ({ name, vectors: members }))
}

// Whether a vector's name or label, or one of its elements' names or labels, contains a lowercase query.
function vectorMatches(vector: IndiProperty, query: string) {
	if (vector.name.toLowerCase().includes(query) || vector.label?.toLowerCase().includes(query)) return true
	return vector.elementNames.some((name) => name.toLowerCase().includes(query) || vector.elements[name]?.label?.toLowerCase().includes(query))
}

// Returns the groups matching a query, ignoring case: a group whose name matches with all its vectors, otherwise
// only its matching vectors; groups left without vectors are dropped. A blank query returns the groups.
export function searchVectors(groups: readonly IndiVectorGroup[], query: string): readonly IndiVectorGroup[] {
	const text = query.trim().toLowerCase()
	if (!text) return groups

	return groups.flatMap((group) => {
		if (group.name.toLowerCase().includes(text)) return [group]
		const vectors = group.vectors.filter((vector) => vectorMatches(vector, text))
		return vectors.length > 0 ? [{ name: group.name, vectors }] : []
	})
}

// Returns a number element's value written with its format, without the padding of its field width.
export function numberText(element: IndiNumberElement) {
	return formatIndiNumber(element.value, element.format).trim()
}

// Reads a number typed in decimal or sexagesimal (12:30:36, -5 30) in the driver's units; undefined when it is
// blank or unreadable.
export function parseNumberText(text: string): number | undefined {
	const trimmed = text.trim()
	if (!trimmed) return undefined
	const value = parseIndiNumber(trimmed)
	return Number.isFinite(value) ? value : undefined
}

// Returns the range of a number element as text, such as "0 to 100, step 1", with its own format; undefined when
// the driver declares no range (a maximum not above the minimum).
export function rangeText(element: IndiNumberElement) {
	if (!(element.max > element.min)) return undefined
	const range = `${formatIndiNumber(element.min, element.format).trim()} to ${formatIndiNumber(element.max, element.format).trim()}`
	return element.step > 0 ? `${range}, step ${element.step}` : range
}

// Returns the latest delivery of a BLOB element as text, such as ".fits · 2.1 MB"; undefined before any.
export function blobText(element: IndiBlobElement) {
	if (element.format === undefined && element.size === undefined) return undefined
	const size = element.size === undefined ? undefined : element.size < 1000 ? `${element.size} B` : element.size < 1e6 ? `${(element.size / 1e3).toFixed(1)} kB` : `${(element.size / 1e6).toFixed(1)} MB`
	return [element.format || 'no format', size].filter(Boolean).join(' · ')
}
