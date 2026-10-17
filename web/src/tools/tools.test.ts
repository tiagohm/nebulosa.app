import { describe, expect, test } from 'bun:test'
import { proxy } from 'valtio'
import type { RoleStatus } from '../equipment/equipment'
import { type EquipmentRole, ROLES } from '../equipment/roles'
import type { RouteState } from '../shell/route'
import { requirementSummary, type ToolContext, toolAvailability } from './availability'
import { launchTool } from './launch'
import { TOOL_CATEGORIES, toolDefinition, TOOLS } from './tools'

function context(roles: Partial<Record<EquipmentRole, RoleStatus>> = {}, hasImage = false): ToolContext {
	const all = Object.fromEntries(ROLES.map((r) => [r.role, roles[r.role] ?? 'notSelected'])) as Record<EquipmentRole, RoleStatus>
	return { roles: all, hasImage }
}

function tool(id: string) {
	return toolDefinition(id)!
}

describe('catalog', () => {
	test('every tool has a unique id and a known category', () => {
		expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length)
		for (const t of TOOLS) expect(TOOL_CATEGORIES.map((c) => c.id)).toContain(t.category)
	})

	test('capture tools take their requirements from the capture modes', () => {
		expect(tool('mount-nudge')).toMatchObject({ route: { workspace: 'capture', mode: 'mount-nudge' }, status: 'preview' })
		expect(tool('mount-nudge').requires).toEqual([
			{ kind: 'role', role: 'MAIN_CAMERA' },
			{ kind: 'role', role: 'MOUNT' },
		])
	})
})

describe('availability', () => {
	test('a role must be connected, not only selected', () => {
		const result = toolAvailability(tool('mount-nudge'), context({ MAIN_CAMERA: 'connected', MOUNT: 'disconnected' }))

		expect(result.ready).toBe(false)
		expect(result.missing).toEqual([{ requirement: { kind: 'role', role: 'MOUNT' }, status: 'disconnected', message: 'The Mount is not connected.' }])
	})

	test('distinguishes unselected, unavailable, and failed devices', () => {
		const messages = toolAvailability(tool('polar-alignment'), context({ MAIN_CAMERA: 'unavailable', MOUNT: 'error' })).missing.map((m) => m.message)
		expect(messages).toEqual(['The Main Camera is unavailable: its connection is not open.', 'The Mount reported an error.'])
		expect(toolAvailability(tool('focus-calibrator'), context({ MAIN_CAMERA: 'connected' })).missing[0]?.message).toBe('No Focuser selected in Equipment Setup.')
	})

	test('image tools need an open image; tools without requirements are ready', () => {
		expect(toolAvailability(tool('plate-solver'), context()).ready).toBe(false)
		expect(toolAvailability(tool('plate-solver'), context({}, true)).ready).toBe(true)
		expect(toolAvailability(tool('astronomy-calculators'), context()).ready).toBe(true)
	})

	test('summarizes requirements', () => {
		expect(requirementSummary(tool('mount-nudge'))).toBe('Requires a connected Main Camera and Mount.')
		expect(requirementSummary(tool('plate-solver'))).toBe('Requires an open image.')
		expect(requirementSummary(tool('astronomy-calculators'))).toBeUndefined()
	})
})

describe('launch', () => {
	function setup() {
		const state = proxy<RouteState>({ route: { workspace: 'tools' }, captureMode: 'camera' })
		const paths: string[] = []
		return { state, paths, history: { pushState: (_d: unknown, _u: string, url?: string | URL | null) => void paths.push(String(url)) } }
	}

	test('opens a preview tool in its workspace and mode', () => {
		const { state, paths, history } = setup()

		expect(launchTool(state, tool('mount-nudge'), history)).toBe(true)
		expect(state.route).toEqual({ workspace: 'capture', mode: 'mount-nudge' })
		expect(paths).toEqual(['/capture/mount-nudge'])
	})

	test('a planned tool does not navigate', () => {
		const { state, paths, history } = setup()

		expect(launchTool(state, tool('plate-solver'), history)).toBe(false)
		expect(state.route).toEqual({ workspace: 'tools' })
		expect(paths).toEqual([])
	})
})
