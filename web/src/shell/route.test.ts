import { describe, expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { DEFAULT_ROUTE, navigate, openWorkspace, parseRoute, redirect, type RouteState, routePath } from './route'

function newState(): RouteState {
	return proxy<RouteState>({ route: DEFAULT_ROUTE })
}

function fakeHistory() {
	const paths: string[] = []
	const replaced: string[] = []
	return { paths, replaced, pushState: (_data: unknown, _unused: string, url?: string | URL | null) => void paths.push(String(url)), replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => void replaced.push(String(url)) }
}

describe('parse', () => {
	test('reads workspaces and tools', () => {
		expect(parseRoute('/images')).toEqual({ workspace: 'images' })
		expect(parseRoute('/tools/')).toEqual({ workspace: 'tools' })
		expect(parseRoute('/tools/alpaca-server')).toEqual({ workspace: 'tools', tool: 'alpaca-server' })
		expect(parseRoute('/tools/bogus')).toEqual({ workspace: 'tools' })
		expect(parseRoute('/equipment')).toEqual({ workspace: 'equipment' })
		expect(parseRoute('/equipment/abc123/extra')).toEqual({ workspace: 'equipment', device: 'abc123' })
		expect(routePath({ workspace: 'equipment' })).toBe('/equipment')
		expect(routePath({ workspace: 'equipment', device: 'abc123' })).toBe('/equipment/abc123')
	})

	test('reads the Settings page and its external program', () => {
		expect(parseRoute('/settings')).toEqual({ workspace: 'settings' })
		expect(parseRoute('/settings/external-tools')).toEqual({ workspace: 'settings' })
		expect(parseRoute('/settings/external-tools/astap/extra')).toEqual({ workspace: 'settings', tool: 'astap' })
		expect(parseRoute('/settings/other/astap')).toEqual({ workspace: 'settings' })
		expect(routePath({ workspace: 'settings' })).toBe('/settings/external-tools')
		expect(routePath({ workspace: 'settings', tool: 'astap' })).toBe('/settings/external-tools/astap')
	})

	test('opens Images for empty and unknown paths, the removed Capture workspace included', () => {
		expect(DEFAULT_ROUTE).toEqual({ workspace: 'images' })
		expect(parseRoute('/')).toEqual(DEFAULT_ROUTE)
		expect(parseRoute('/sequencer')).toEqual(DEFAULT_ROUTE)
		expect(parseRoute('/capture')).toEqual(DEFAULT_ROUTE)
		expect(parseRoute('/capture/main/auto-focus')).toEqual(DEFAULT_ROUTE)
	})

	test('round-trips canonical paths', () => {
		for (const path of ['/images', '/sky', '/tools', '/tools/calculator']) expect(routePath(parseRoute(path))).toBe(path)
	})
})

describe('navigate', () => {
	test('pushes only path changes', () => {
		const state = newState()
		const history = fakeHistory()

		navigate(state, { workspace: 'images' }, history)
		navigate(state, { workspace: 'sky' }, history)

		expect(history.paths).toEqual(['/sky'])
		expect(state.route).toEqual({ workspace: 'sky' })
	})

	test('redirect replaces the path without a history entry', () => {
		const state = newState()
		const history = fakeHistory()

		redirect(state, { workspace: 'tools' }, history)

		expect(history.paths).toEqual([])
		expect(history.replaced).toEqual(['/tools'])
		expect(state.route).toEqual({ workspace: 'tools' })
	})

	test('the rail opens a workspace', () => {
		const state = newState()
		const history = fakeHistory()

		openWorkspace(state, 'sky', history)
		openWorkspace(state, 'images', history)

		expect(state.route).toEqual({ workspace: 'images' })
		expect(history.paths).toEqual(['/sky', '/images'])
	})
})
