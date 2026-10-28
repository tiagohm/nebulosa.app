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

	test('reads the eclipse of the Solar and Lunar Eclipse Maps, and no id for other tools', () => {
		expect(parseRoute('/tools/solar-eclipse-map/1786556760000')).toEqual({ workspace: 'tools', tool: 'solar-eclipse-map', eclipse: '1786556760000' })
		expect(parseRoute('/tools/solar-eclipse-map')).toEqual({ workspace: 'tools', tool: 'solar-eclipse-map' })
		expect(parseRoute('/tools/lunar-eclipse-map/1803423600000')).toEqual({ workspace: 'tools', tool: 'lunar-eclipse-map', eclipse: '1803423600000' })
		expect(parseRoute('/tools/lunar-eclipse-map')).toEqual({ workspace: 'tools', tool: 'lunar-eclipse-map' })
		expect(parseRoute('/tools/calculator/1786556760000')).toEqual({ workspace: 'tools', tool: 'calculator' })
		expect(routePath({ workspace: 'tools', tool: 'solar-eclipse-map', eclipse: '1786556760000' })).toBe('/tools/solar-eclipse-map/1786556760000')
		expect(routePath({ workspace: 'tools', tool: 'lunar-eclipse-map', eclipse: '1803423600000' })).toBe('/tools/lunar-eclipse-map/1803423600000')
		expect(routePath({ workspace: 'tools', tool: 'calculator', eclipse: '1786556760000' })).toBe('/tools/calculator')
	})

	test('reads the INDI properties view of a device', () => {
		expect(parseRoute('/equipment/abc123/indi')).toEqual({ workspace: 'equipment', device: 'abc123', view: 'indi' })
		expect(parseRoute('/equipment/abc123/indi/extra')).toEqual({ workspace: 'equipment', device: 'abc123', view: 'indi' })
		expect(parseRoute('/equipment/abc123/other')).toEqual({ workspace: 'equipment', device: 'abc123' })
		expect(routePath({ workspace: 'equipment', device: 'abc123', view: 'indi' })).toBe('/equipment/abc123/indi')
	})

	test('reads the Settings page, its section, and its external program', () => {
		expect(parseRoute('/settings')).toEqual({ workspace: 'settings', section: 'external-tools' })
		expect(parseRoute('/settings/external-tools')).toEqual({ workspace: 'settings', section: 'external-tools' })
		expect(parseRoute('/settings/external-tools/astap/extra')).toEqual({ workspace: 'settings', section: 'external-tools', tool: 'astap' })
		expect(parseRoute('/settings/other/astap')).toEqual({ workspace: 'settings', section: 'external-tools' })
		expect(routePath({ workspace: 'settings' })).toBe('/settings/external-tools')
		expect(routePath({ workspace: 'settings', section: 'external-tools' })).toBe('/settings/external-tools')
		expect(routePath({ workspace: 'settings', tool: 'astap' })).toBe('/settings/external-tools/astap')
	})

	test('reads the About page', () => {
		expect(parseRoute('/about')).toEqual({ workspace: 'about' })
		expect(parseRoute('/about/extra')).toEqual({ workspace: 'about' })
		expect(routePath({ workspace: 'about' })).toBe('/about')
	})

	test('opens Images for empty and unknown paths, the removed Capture workspace included', () => {
		expect(DEFAULT_ROUTE).toEqual({ workspace: 'images' })
		expect(parseRoute('/')).toEqual(DEFAULT_ROUTE)
		expect(parseRoute('/sequencer')).toEqual(DEFAULT_ROUTE)
		expect(parseRoute('/capture')).toEqual(DEFAULT_ROUTE)
		expect(parseRoute('/capture/main/auto-focus')).toEqual(DEFAULT_ROUTE)
	})

	test('round-trips canonical paths', () => {
		for (const path of ['/images', '/sky', '/tools', '/tools/calculator', '/tools/solar-eclipse-map/1786556760000', '/tools/lunar-eclipse-map/1803423600000', '/equipment/abc123', '/equipment/abc123/indi', '/about']) expect(routePath(parseRoute(path))).toBe(path)
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

	test('opens the About page once', () => {
		const state = newState()
		const history = fakeHistory()

		navigate(state, { workspace: 'about' }, history)
		navigate(state, { workspace: 'about' }, history)

		expect(history.paths).toEqual(['/about'])
		expect(state.route).toEqual({ workspace: 'about' })
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
