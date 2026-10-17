import { describe, expect, test } from 'bun:test'
import { proxy } from 'valtio'
import type { RoleStatus } from '../equipment/equipment'
import { type CameraRole, type EquipmentRole, ROLES } from '../equipment/roles'
import type { RouteState } from '../shell/route'
import { requirementSummary, type ToolContext, toolAvailability } from './availability'
import { launchTool } from './launch'
import { TOOL_CATEGORIES, toolDefinition, TOOLS } from './tools'

function context(roles: Partial<Record<EquipmentRole, RoleStatus>> = {}, hasImage = false, camera?: CameraRole): ToolContext {
	const all = Object.fromEntries(ROLES.map((r) => [r.role, roles[r.role] ?? 'notSelected'])) as Record<EquipmentRole, RoleStatus>
	return { roles: all, camera: camera && { role: camera, status: all[camera] }, hasImage }
}

function tool(id: string) {
	return toolDefinition(id)!
}

describe('catalog', () => {
	test('every tool has a unique id and a known category', () => {
		expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length)
		for (const t of TOOLS) expect(TOOL_CATEGORIES.map((c) => c.id)).toContain(t.category)
	})

	test('capture tools need the camera of the view and the roles of their mode', () => {
		expect(tool('mount-nudge')).toMatchObject({ route: { workspace: 'capture', mode: 'mount-nudge' }, status: 'preview' })
		expect(tool('mount-nudge').requires).toEqual([{ kind: 'camera' }, { kind: 'role', role: 'MOUNT' }])
		expect(tool('camera').requires).toEqual([{ kind: 'camera' }])
		for (const t of TOOLS) expect(t.requires).not.toContainEqual({ kind: 'role', role: 'MAIN_CAMERA' })
	})
})

describe('availability', () => {
	test('a role must be connected, not only selected', () => {
		const result = toolAvailability(tool('mount-nudge'), context({ MAIN_CAMERA: 'connected', MOUNT: 'disconnected' }, false, 'MAIN_CAMERA'))

		expect(result.ready).toBe(false)
		expect(result.missing).toEqual([{ requirement: { kind: 'role', role: 'MOUNT' }, status: 'disconnected', message: 'The Mount is not connected.' }])
	})

	test('the guide camera meets the camera requirement without a main camera', () => {
		const result = toolAvailability(tool('mount-nudge'), context({ GUIDE_CAMERA: 'connected', MOUNT: 'connected' }, false, 'GUIDE_CAMERA'))
		expect(result).toEqual({ ready: true, missing: [] })
	})

	test('the camera is evaluated on the device of the selected view', () => {
		const messages = toolAvailability(tool('polar-alignment'), context({ MAIN_CAMERA: 'connected', GUIDE_CAMERA: 'unavailable', MOUNT: 'error' }, false, 'GUIDE_CAMERA')).missing.map((m) => m.message)
		expect(messages).toEqual(['The Guide Camera is unavailable: its connection is not open.', 'The Mount reported an error.'])
		expect(toolAvailability(tool('focus-calibrator'), context({ MAIN_CAMERA: 'connected' }, false, 'MAIN_CAMERA')).missing[0]?.message).toBe('No Focuser selected in Equipment Setup.')
	})

	test('no camera configured', () => {
		expect(toolAvailability(tool('camera'), context()).missing).toEqual([{ requirement: { kind: 'camera' }, status: 'notSelected', message: 'No camera configured in Equipment Setup.' }])
	})

	test('image tools need an open image; tools without requirements are ready', () => {
		expect(toolAvailability(tool('plate-solver'), context()).ready).toBe(false)
		expect(toolAvailability(tool('plate-solver'), context({}, true)).ready).toBe(true)
		expect(toolAvailability(tool('astronomy-calculators'), context()).ready).toBe(true)
	})

	test('summarizes requirements', () => {
		expect(requirementSummary(tool('mount-nudge'))).toBe('Requires a connected camera and Mount.')
		expect(requirementSummary(tool('plate-solver'))).toBe('Requires an open image.')
		expect(requirementSummary(tool('astronomy-calculators'))).toBeUndefined()
	})
})

describe('launch', () => {
	function setup() {
		const state = proxy<RouteState>({ route: { workspace: 'tools' } })
		const paths: string[] = []
		return { state, paths, history: { pushState: (_d: unknown, _u: string, url?: string | URL | null) => void paths.push(String(url)) } }
	}

	test('opens a capture tool in its mode within the selected camera view', () => {
		const { state, paths, history } = setup()

		expect(launchTool(state, tool('mount-nudge'), 'GUIDE_CAMERA', history)).toBe(true)
		expect(state.route).toEqual({ workspace: 'capture', camera: 'guide', mode: 'mount-nudge' })
		expect(paths).toEqual(['/capture/guide/mount-nudge'])
	})

	test('without a camera it opens Capture, which shows none is configured', () => {
		const { state, history } = setup()

		expect(launchTool(state, tool('camera'), undefined, history)).toBe(true)
		expect(state.route).toEqual({ workspace: 'capture', camera: 'main', mode: 'camera' })
	})

	test('a planned tool does not navigate', () => {
		const { state, paths, history } = setup()

		expect(launchTool(state, tool('plate-solver'), 'MAIN_CAMERA', history)).toBe(false)
		expect(state.route).toEqual({ workspace: 'tools' })
		expect(paths).toEqual([])
	})
})
