import { describe, expect, test } from 'bun:test'
import { IMAGE_TOOL_DEFINITIONS, IMAGE_TOOLS, imageToolGroup, imageToolUnavailable } from './tools'

const CAMERA_TAB = { source: { kind: 'camera', connectionId: 'conn', deviceId: 'cam' } } as const
const FILE = { source: { kind: 'file', path: '/images/m42.fits' } } as const

describe('tool registry', () => {
	test('lists the image tools before the camera operations, each under its category heading', () => {
		const categories = IMAGE_TOOLS.map((id) => IMAGE_TOOL_DEFINITIONS[id].category)
		expect(categories.indexOf('camera')).toBeGreaterThan(categories.lastIndexOf('image'))
		expect(imageToolGroup('inspector')).toBe('Image Tools')
		expect(imageToolGroup('auto-focus')).toBe('Camera Operations')
		for (const id of IMAGE_TOOLS) expect(IMAGE_TOOL_DEFINITIONS[id].id).toBe(id)
	})

	test('image tools with a panel can be selected on any document', () => {
		for (const document of [CAMERA_TAB, FILE, undefined]) {
			expect(imageToolUnavailable('inspector', document)).toBeUndefined()
			expect(imageToolUnavailable('star-detection', document)).toBeUndefined()
		}
	})

	test('Camera Acquisition can be selected on a camera tab', () => {
		expect(imageToolUnavailable('camera-acquisition', CAMERA_TAB)).toBeUndefined()
		expect(imageToolUnavailable('camera-acquisition', FILE)).toBe('Only on a camera tab.')
	})

	test('camera operations are offered only on camera tabs', () => {
		for (const document of [FILE, { source: { kind: 'derived', sourceName: 'M42' } } as const, undefined]) expect(imageToolUnavailable('auto-focus', document)).toBe('Only on a camera tab.')
	})

	test('a tool without a panel cannot be selected', () => {
		expect(imageToolUnavailable('streak-detection', FILE)).toBe('Not available yet.')
		expect(imageToolUnavailable('guiding', CAMERA_TAB)).toBe('Not available yet.')
	})
})
