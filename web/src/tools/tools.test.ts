import { describe, expect, test } from 'bun:test'
import { TOOL_IDS } from '../shell/route'
import { TOOL_DEFINITIONS, toolStatus } from './tools'

describe('registry', () => {
	test('lists only the standalone tools, each under its own id', () => {
		expect(TOOL_IDS).toEqual(['calculator', 'solar-eclipse-map', 'lunar-eclipse-map', 'alpaca-server'])
		for (const id of TOOL_IDS) expect(TOOL_DEFINITIONS[id].id).toBe(id)
	})

	test('a tool without a view is planned', () => {
		expect(toolStatus(TOOL_DEFINITIONS.calculator)).toBe('planned')
		expect(toolStatus(TOOL_DEFINITIONS['lunar-eclipse-map'])).toBe('available')
		expect(toolStatus(TOOL_DEFINITIONS['solar-eclipse-map'])).toBe('available')
		expect(toolStatus({ view: () => null })).toBe('available')
	})
})
