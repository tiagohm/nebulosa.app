import { describe, expect, test } from 'bun:test'
import { TOOL_IDS } from '../shell/route'
import { TOOL_DEFINITIONS, toolStatus } from './tools'

describe('registry', () => {
	test('lists only the standalone tools, each under its own id', () => {
		expect(TOOL_IDS).toEqual([
			'calculator',
			'astronomical-time-converter',
			'solar-eclipse-map',
			'lunar-eclipse-map',
			'close-approaches',
			'orbital-mechanics-explorer',
			'astro-weather',
			'observing-planner',
			'jupiter-observing-planner',
			'saturn-observing-planner',
			'artificial-satellites',
			'calibration-library',
			'image-stacking',
			'mount-remote-control',
			'mount-pointing-model',
			'meridian-flip-monitor',
			'observatory-cameras',
			'spice-kernel-library',
			'alpaca-server',
		])
		for (const id of TOOL_IDS) expect(TOOL_DEFINITIONS[id].id).toBe(id)
	})

	test('a tool without a view is planned', () => {
		expect(toolStatus(TOOL_DEFINITIONS['alpaca-server'])).toBe('planned')
		expect(toolStatus(TOOL_DEFINITIONS.calculator)).toBe('available')
		expect(toolStatus(TOOL_DEFINITIONS['astronomical-time-converter'])).toBe('available')
		expect(toolStatus(TOOL_DEFINITIONS['lunar-eclipse-map'])).toBe('available')
		expect(toolStatus(TOOL_DEFINITIONS['solar-eclipse-map'])).toBe('available')
		expect(toolStatus(TOOL_DEFINITIONS['close-approaches'])).toBe('available')
		expect(toolStatus(TOOL_DEFINITIONS['astro-weather'])).toBe('available')
		expect(toolStatus(TOOL_DEFINITIONS['artificial-satellites'])).toBe('available')
		expect(toolStatus(TOOL_DEFINITIONS['mount-remote-control'])).toBe('available')
		expect(toolStatus(TOOL_DEFINITIONS['meridian-flip-monitor'])).toBe('available')
		expect(toolStatus({ view: () => null })).toBe('available')
	})
})
