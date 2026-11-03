import { describe, expect, test } from 'bun:test'
import type { StackingProductSummary } from 'api'
import { COMPOSITION_PRESETS, resolvePreset, weightOf, withoutSource, withWeight } from './presets'

function master(productId: string, groupKey: string, patch: Partial<StackingProductSummary> = {}) {
	return { productId, groupKey, name: groupKey, channels: 1, status: 'ready', ...patch } as StackingProductSummary
}

function preset(name: string) {
	return COMPOSITION_PRESETS.find((item) => item.name === name)!
}

describe('presets', () => {
	test('HOO feeds two channels from one source, and the newest usable master of a filter is chosen', () => {
		const products = [master('h2', 'h-alpha', { status: 'unavailable' }), master('h1', 'ha'), master('o1', 'oiii'), master('o0', 'oiii')]
		const resolved = resolvePreset(preset('HOO'), products)
		expect(resolved).toEqual({
			composition: {
				preset: 'HOO',
				sources: [
					{ productId: 'h1', plane: 0, gain: 1, offset: 0 },
					{ productId: 'o1', plane: 0, gain: 1, offset: 0 },
				],
				mix: { red: [{ plane: 0, weight: 1 }], green: [{ plane: 1, weight: 1 }], blue: [{ plane: 1, weight: 1 }] },
			},
		})
	})

	test('a preset without masters of its filters stays unresolved, and color masters are never a mono filter', () => {
		expect(resolvePreset(preset('LSHO'), [master('h', 'ha'), master('s', 'sii'), master('o', 'oiii', { channels: 3 })])).toEqual({ missing: ['OIII', 'L'] })
		const lrgb = resolvePreset(preset('LRGB'), [master('r', 'red'), master('g', 'g'), master('b', 'b'), master('l', 'lum')])
		expect('composition' in lrgb && lrgb.composition.luminance).toEqual({ source: 3, alpha: 1, match: 'robustLinear' })
	})

	test('editing weights and removing a source keep the mix consistent', () => {
		const resolved = resolvePreset(preset('LSHO'), [master('h', 'ha'), master('s', 'sii'), master('o', 'oiii'), master('l', 'l')])
		if (!('composition' in resolved)) throw new Error('unresolved')
		const custom = withWeight(resolved.composition, 'red', 1, 0.3)
		expect([custom.preset, weightOf(custom, 'red', 0), weightOf(custom, 'red', 1)]).toEqual(['Custom', 1, 0.3])
		expect(withWeight(custom, 'red', 1, 0).mix.red).toEqual([{ plane: 0, weight: 1 }])
		const removed = withoutSource(custom, 0)
		expect(removed.sources.map((source) => source.productId)).toEqual(['h', 'o', 'l'])
		expect(removed.mix).toEqual({ red: [{ plane: 0, weight: 0.3 }], green: [{ plane: 0, weight: 1 }], blue: [{ plane: 1, weight: 1 }] })
		expect(removed.luminance?.source).toBe(2)
		expect(withoutSource(removed, 2).luminance).toBeUndefined()
	})
})
