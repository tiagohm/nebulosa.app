import { describe, expect, test } from 'bun:test'
import { IMAGE_TOOL_DEFINITIONS, IMAGE_TOOLS, imageToolGroup, imageToolsFor, imageToolUnavailable } from './tools'

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
