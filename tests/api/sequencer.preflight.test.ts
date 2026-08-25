import { describe, expect, test } from 'bun:test'
import { compile } from 'src/api/sequencer.compiler'
import { preflight, validate } from 'src/api/sequencer.preflight'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import { canonical, frame } from './sequencer.fixture'

describe('preflight', () => {
	test('a refused definition reports its diagnostics and no numbers', () => {
		const definition = canonical()
		const view = validate({ ...definition, quality: { ...definition.quality, enabled: true } })

		expect(view.ok).toBe(false)
		expect(view.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(['quality.enabled'])
		expect(view.removals).toEqual([])
		expect(view.repeat).toBe(0)
		expect(view.groups).toEqual([])
		expect(view.requiredSlots).toBe(0)
		expect(view.slotLimit).toBe(0)
		expect(view.projectedIntegration).toBe(0)
		expect(view.roles).toEqual([])
	})

	test('an accepted definition reports the removals of the compilation', () => {
		const definition = canonical()
		const view = validate({ ...definition, notification: { ...definition.notification, enabled: true } })

		expect(view.ok).toBe(true)
		expect(view.diagnostics).toEqual([])
		expect(view.removals.map((removal) => removal.path)).toEqual(['dither.retry.onExhausted', 'autofocus.retry.onExhausted', 'meridianFlip.retry.onExhausted', 'guiding.restoreAfterInterruption', 'notification'])
	})

	test('every group reports the slots and the integration the lowering derived', () => {
		const definition = canonical()
		const view = validate({ ...definition, capture: { ...definition.capture, repeat: 3, frames: [frame('lum', { count: 4, abandonmentBudget: 2 })] } })

		expect(view.groups).toEqual([{ id: 'lum', name: 'lum', frameType: 'LIGHT', exposureTime: 60, requiredSlots: 4, abandonmentBudget: 2, slotLimit: 6, projectedIntegration: 240 }])
	})

	test('the totals scale the groups by the cycle count', () => {
		const definition = canonical()
		const view = validate({ ...definition, capture: { ...definition.capture, repeat: 3, frames: [frame('lum', { count: 4, abandonmentBudget: 2 }), frame('red', { count: 2 }, { exposureTime: 30 })] } })

		expect(view.repeat).toBe(3)
		expect(view.requiredSlots).toBe(18)
		expect(view.slotLimit).toBe(24)
		expect(view.projectedIntegration).toBe(900)
	})

	test('the totals report the integration ceiling the session ends at', () => {
		const definition = canonical()
		const execution = { ...definition.execution, end: { type: 'integrationTime', time: 60 } as const }
		const view = validate({ ...definition, execution, capture: { ...definition.capture, repeat: 3, frames: [frame('lum', { count: 4 })] } })

		expect(view.projectedIntegration).toBe(720)
		expect(view.integrationLimit).toBe(60)
	})

	test('a sequence that ends with itself declares no integration ceiling', () => {
		const view = validate(canonical())

		expect(view.integrationLimit).toBeUndefined()
	})

	test('the view reports the roles the session reserves', () => {
		const view = validate(canonical())

		expect(view.roles).toEqual(['camera', 'mount', 'focuser'])
	})

	test('a compilation is projected without being compiled again', () => {
		const compilation = compile(canonical())
		const view = preflight(compilation)

		expect(view.ok).toBe(true)
		expect(view.repeat).toBe(2)
		expect(view.groups).toHaveLength(2)
	})

	test('a registry refusing a block refuses the pre-flight view', () => {
		const view = validate(canonical(), { registry: new SequencerBlockRegistry() })

		expect(view.ok).toBe(false)
		expect(view.diagnostics.length).toBeGreaterThan(0)
	})
})
