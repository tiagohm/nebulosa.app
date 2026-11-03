import type { StackingComposition, StackingProductSummary } from 'api'

// Presets of color composition as data: which filter feeds each output channel and the luminance, resolved against the
// masters of a project into a composition the server validates. A filter is recognized by the canonical keys its group
// can have (lower case, spaces collapsed), never guessed beyond them; a preset whose filters have no master stays
// unresolved and names what is missing. Every term weighs 1, so a channel fed by two filters is their mean.

// Filter a preset asks for.
export type FilterRole = 'L' | 'R' | 'G' | 'B' | 'Ha' | 'OIII' | 'SII'

// Canonical filter keys of each role.
export const FILTER_ROLE_KEYS: Readonly<Record<FilterRole, readonly string[]>> = {
	L: ['l', 'lum', 'luminance', 'clear', 'c'],
	R: ['r', 'red'],
	G: ['g', 'green'],
	B: ['b', 'blue'],
	Ha: ['ha', 'h-alpha', 'halpha', 'h alpha', 'hα', 'h-a'],
	OIII: ['oiii', 'o3', 'o-iii', 'o iii', 'o-3'],
	SII: ['sii', 's2', 's-ii', 's ii', 's-2'],
}

// A preset: the filters of each output channel, and the filter blended as luminance.
export interface CompositionPreset {
	readonly name: string
	readonly red: readonly FilterRole[]
	readonly green: readonly FilterRole[]
	readonly blue: readonly FilterRole[]
	readonly luminance?: FilterRole
}

// Presets, in the order they are offered; Custom starts from the composition shown.
export const COMPOSITION_PRESETS: readonly CompositionPreset[] = [
	{ name: 'RGB', red: ['R'], green: ['G'], blue: ['B'] },
	{ name: 'LRGB', red: ['R'], green: ['G'], blue: ['B'], luminance: 'L' },
	{ name: 'SHO', red: ['SII'], green: ['Ha'], blue: ['OIII'] },
	{ name: 'HOO', red: ['Ha'], green: ['OIII'], blue: ['OIII'] },
	{ name: 'LSHO', red: ['SII'], green: ['Ha'], blue: ['OIII'], luminance: 'L' },
]

// Name of the preset of a composition edited by hand.
export const CUSTOM_PRESET = 'Custom'

// Outcome of resolving a preset: a composition, or the filters without a usable master.
export type PresetResolution = { readonly composition: StackingComposition } | { readonly missing: readonly FilterRole[] }

// Returns the newest usable mono master of a filter role; products come newest first.
function masterOf(role: FilterRole, products: readonly StackingProductSummary[]) {
	return products.find((product) => product.status !== 'unavailable' && product.channels === 1 && FILTER_ROLE_KEYS[role].includes(product.groupKey))
}

// Resolves a preset against the masters of a project: one source per filter, the newest usable mono master of it, with
// no correction, and the luminance blended fully after matching it to the mixed luminance.
export function resolvePreset(preset: CompositionPreset, products: readonly StackingProductSummary[]): PresetResolution {
	const roles = [...new Set([...preset.red, ...preset.green, ...preset.blue, ...(preset.luminance ? [preset.luminance] : [])])]
	const missing = roles.filter((role) => !masterOf(role, products))
	if (missing.length > 0) return { missing }
	const sources = roles.map((role) => ({ productId: masterOf(role, products)!.productId, plane: 0, gain: 1, offset: 0 }))
	const terms = (channel: readonly FilterRole[]) => channel.map((role) => ({ plane: roles.indexOf(role), weight: 1 }))

	return {
		composition: {
			preset: preset.name,
			sources,
			mix: { red: terms(preset.red), green: terms(preset.green), blue: terms(preset.blue) },
			...(preset.luminance && { luminance: { source: roles.indexOf(preset.luminance), alpha: 1, match: 'robustLinear' as const } }),
		},
	}
}

// Returns the weight of a source in an output channel, 0 when absent.
export function weightOf(composition: StackingComposition, channel: 'red' | 'green' | 'blue', source: number) {
	return composition.mix[channel].find((term) => term.plane === source)?.weight ?? 0
}

// Returns a composition with the weight of a source in an output channel set, marked Custom.
export function withWeight(composition: StackingComposition, channel: 'red' | 'green' | 'blue', source: number, weight: number): StackingComposition {
	const terms = composition.mix[channel].filter((term) => term.plane !== source)
	return { ...composition, preset: CUSTOM_PRESET, mix: { ...composition.mix, [channel]: weight > 0 ? [...terms, { plane: source, weight }].sort((a, b) => a.plane - b.plane) : terms } }
}

// Returns a composition without a source: its terms go, later sources move down by one, and a luminance of it goes.
export function withoutSource(composition: StackingComposition, source: number): StackingComposition {
	const shift = (terms: StackingComposition['mix']['red']) => terms.flatMap((term) => (term.plane === source ? [] : [{ ...term, plane: term.plane > source ? term.plane - 1 : term.plane }]))
	const { luminance, ...rest } = composition
	const kept = luminance && luminance.source !== source ? { ...luminance, source: luminance.source > source ? luminance.source - 1 : luminance.source } : undefined
	return { ...rest, preset: CUSTOM_PRESET, sources: composition.sources.filter((_, index) => index !== source), mix: { red: shift(composition.mix.red), green: shift(composition.mix.green), blue: shift(composition.mix.blue) }, ...(kept && { luminance: kept }) }
}
