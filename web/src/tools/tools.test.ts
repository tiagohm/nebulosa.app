import { describe, expect, test } from 'bun:test'
import { TOOL_IDS } from '../shell/route'
import { catalogGroups, matchesTool, RUNNING_GROUP_LABEL, TOOL_DEFINITIONS, TOOL_GROUPS, toolStatus } from './tools'

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
			'framing',
			'jupiter-observing-planner',
			'saturn-observing-planner',
			'planetary-events',
			'meteor-showers',
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

	test('gives every tool card an icon of its own', () => {
		const icons = TOOL_IDS.map((id) => TOOL_DEFINITIONS[id].icon)
		expect(new Set(icons).size).toBe(icons.length)
	})

	test('puts every tool in exactly one group', () => {
		const grouped = TOOL_GROUPS.flatMap((group) => group.tools)
		expect(grouped.toSorted()).toEqual([...TOOL_IDS].toSorted())
	})

	test('keeps every card summary within two lines of the narrowest card', () => {
		for (const id of TOOL_IDS) expect(TOOL_DEFINITIONS[id].summary.length).toBeLessThanOrEqual(40)
	})
})

describe('filter', () => {
	const satellites = TOOL_DEFINITIONS['artificial-satellites']

	test('matches every word in the name or the description, ignoring case', () => {
		expect(matchesTool(satellites, '')).toBe(true)
		expect(matchesTool(satellites, 'SATELLITES')).toBe(true)
		expect(matchesTool(satellites, 'celestrak passes')).toBe(true)
		expect(matchesTool(satellites, 'satellites eclipse')).toBe(false)
		expect(matchesTool(satellites, 'ground tracks')).toBe(true)
	})

	test('ignores accents', () => {
		expect(matchesTool(TOOL_DEFINITIONS['jupiter-observing-planner'], 'Júpiter')).toBe(true)
	})

	test('finds a tool by the words of its keywords', () => {
		const found = (query: string) => TOOL_IDS.filter((id) => matchesTool(TOOL_DEFINITIONS[id], query))
		expect(found('dew')).toEqual(['calculator', 'astro-weather'])
		expect(found('fov')).toEqual(['calculator', 'framing'])
		expect(found('critical focus')).toEqual(['calculator'])
		expect(found('pixel scale')).toEqual(['calculator'])
		expect(found('moon')).toContain('lunar-eclipse-map')
		expect(found('blood moon')).toEqual(['lunar-eclipse-map'])
		expect(found('iss')).toEqual(['artificial-satellites'])
		expect(found('pier side')).toEqual(['meridian-flip-monitor'])
		expect(found('perseids')).toEqual(['meteor-showers'])
		expect(found('retrograde')).toEqual(['planetary-events'])
		expect(found('xisf')).toEqual(['calibration-library'])
		expect(found('sigma clip')).toEqual(['image-stacking'])
		expect(found('jupiter')).toEqual(['jupiter-observing-planner', 'planetary-events'])
	})
})

describe('catalog groups', () => {
	const labels = (groups: readonly { label: string }[]) => groups.map((group) => group.label)

	test('shows the groups of the night when nothing runs', () => {
		expect(labels(catalogGroups('', () => false))).toEqual(['Planning', 'Rig & Observatory', 'Frames', 'Reference'])
	})

	test('lifts running tools into a first group, out of their own', () => {
		const running = (id: string) => id === 'meridian-flip-monitor' || id === 'mount-remote-control'
		const groups = catalogGroups('', running)
		expect(groups[0]).toEqual({ label: RUNNING_GROUP_LABEL, tools: ['meridian-flip-monitor', 'mount-remote-control'] })
		expect(groups.find((group) => group.label === 'Rig & Observatory')?.tools).toEqual(['mount-pointing-model', 'observatory-cameras', 'alpaca-server'])
	})

	test('filters the running group like the others', () => {
		const groups = catalogGroups('lx200', (id) => id === 'meridian-flip-monitor' || id === 'mount-remote-control')
		expect(groups).toEqual([{ label: RUNNING_GROUP_LABEL, tools: ['mount-remote-control'] }])
	})
})
