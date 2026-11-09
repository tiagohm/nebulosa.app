import { describe, expect, test } from 'bun:test'
import { fitImageToolBar, IMAGE_TOOL_DEFINITIONS, IMAGE_TOOLS, imageToolBarWidth, imageToolGroup, imageToolsFor, imageToolUnavailable, TOOL_BAR_BUTTON_WIDTH, TOOL_BAR_DIVIDER_WIDTH, TOOL_BAR_GAP } from './tools'

const CAMERA_TAB = { source: { kind: 'camera', connectionId: 'conn', deviceId: 'cam' } } as const
const FILE = { source: { kind: 'file', path: '/images/m42.fits' } } as const
const DERIVED = { source: { kind: 'derived', sourceName: 'M42' } } as const

describe('tool registry', () => {
	test('lists the image tools before the camera operations, each under its category heading', () => {
		const categories = IMAGE_TOOLS.map((id) => IMAGE_TOOL_DEFINITIONS[id].category)
		expect(categories.indexOf('camera')).toBeGreaterThan(categories.lastIndexOf('image'))
		expect(imageToolGroup('inspector')).toBe('Image Tools')
		expect(imageToolGroup('auto-focus')).toBe('Camera Operations')
		for (const id of IMAGE_TOOLS) expect(IMAGE_TOOL_DEFINITIONS[id].id).toBe(id)
	})

	test('the Star Profile Inspector is an analysis of any document, right after Star Detection', () => {
		expect(IMAGE_TOOLS[IMAGE_TOOLS.indexOf('star-detection') + 1]).toBe('star-profile')
		expect(IMAGE_TOOL_DEFINITIONS['star-profile']).toMatchObject({ label: 'Star Profile Inspector', category: 'image', outputs: ['analysis'] })
		expect(imageToolsFor(FILE)).toContain('star-profile')
		expect(imageToolsFor(DERIVED)).toContain('star-profile')
	})

	test('every tool with a panel can be selected', () => {
		for (const id of IMAGE_TOOLS) expect(imageToolUnavailable(id)).toBeUndefined()
	})

	test('a camera tab lists every tool', () => {
		expect(imageToolsFor(CAMERA_TAB)).toEqual(IMAGE_TOOLS)
	})

	test('camera operations are listed only on camera tabs', () => {
		for (const document of [FILE, DERIVED, undefined]) {
			const tools = imageToolsFor(document)
			expect(tools).toContain('inspector')
			expect(tools).toContain('streak-detection')
			for (const id of tools) expect(IMAGE_TOOL_DEFINITIONS[id].category).toBe('image')
		}
	})
})

describe('tool bar', () => {
	const IMAGE_ONLY = imageToolsFor(FILE)

	test('shows every tool when the bar is wide enough', () => {
		const width = imageToolBarWidth(IMAGE_TOOLS, false)
		expect(fitImageToolBar(IMAGE_TOOLS, 'inspector', width)).toEqual({ shown: IMAGE_TOOLS, overflow: [] })
	})

	test('counts a divider between the image tools and the camera operations', () => {
		expect(imageToolBarWidth(['inspector', 'plate-solver'], false)).toBe(2 * TOOL_BAR_BUTTON_WIDTH + TOOL_BAR_GAP)
		expect(imageToolBarWidth(['inspector', 'camera-acquisition'], false)).toBe(2 * TOOL_BAR_BUTTON_WIDTH + TOOL_BAR_DIVIDER_WIDTH + 2 * TOOL_BAR_GAP)
		expect(imageToolBarWidth(['inspector'], true)).toBe(2 * TOOL_BAR_BUTTON_WIDTH + TOOL_BAR_GAP)
	})

	test('moves the trailing tools to the overflow list beside its button', () => {
		const width = imageToolBarWidth(IMAGE_ONLY.slice(0, 3), true)
		const layout = fitImageToolBar(IMAGE_ONLY, 'inspector', width)
		expect(layout.shown).toEqual(IMAGE_ONLY.slice(0, 3))
		expect(layout.overflow).toEqual(IMAGE_ONLY.slice(3))
	})

	test('keeps the selected tool visible in place of the last one that fits', () => {
		const width = imageToolBarWidth(['inspector', 'plate-solver', 'guiding'], true)
		const layout = fitImageToolBar(IMAGE_TOOLS, 'guiding', width)
		expect(layout.shown).toEqual(['inspector', 'plate-solver', 'guiding'])
		expect(layout.overflow).not.toContain('guiding')
		expect(layout.shown.length + layout.overflow.length).toBe(IMAGE_TOOLS.length)
	})

	test('shows at least the selected tool however narrow the bar is', () => {
		expect(fitImageToolBar(IMAGE_TOOLS, 'tppa', 0).shown).toEqual(['tppa'])
	})

	test('every tool has an icon', () => {
		for (const id of IMAGE_TOOLS) expect(IMAGE_TOOL_DEFINITIONS[id].icon).toBeTruthy()
	})
})
