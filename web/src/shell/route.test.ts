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

	test('reads the group of the Calibration Library and writes it back', () => {
		expect(parseRoute('/tools/calibration-library/abc')).toEqual({ workspace: 'tools', tool: 'calibration-library', group: 'abc' })
		expect(routePath({ workspace: 'tools', tool: 'calibration-library', group: 'abc' })).toBe('/tools/calibration-library/abc')
		expect(parseRoute('/tools/calibration-library')).toEqual({ workspace: 'tools', tool: 'calibration-library' })
		expect(parseRoute('/tools/calculator/abc')).toEqual({ workspace: 'tools', tool: 'calculator' })
	})

	test('reads the project of Image Stacking and writes it back', () => {
		expect(parseRoute('/tools/image-stacking/p%201')).toEqual({ workspace: 'tools', tool: 'image-stacking', project: 'p 1' })
		expect(routePath({ workspace: 'tools', tool: 'image-stacking', project: 'p 1' })).toBe('/tools/image-stacking/p%201')
		expect(parseRoute('/tools/image-stacking')).toEqual({ workspace: 'tools', tool: 'image-stacking' })
		expect(parseRoute('/tools/artificial-satellites/270001')).toEqual({ workspace: 'tools', tool: 'artificial-satellites', satellite: '270001' })
		expect(routePath({ workspace: 'tools', tool: 'artificial-satellites', satellite: '800000001' })).toBe('/tools/artificial-satellites/800000001')
		expect(parseRoute('/tools/artificial-satellites')).toEqual({ workspace: 'tools', tool: 'artificial-satellites' })
		expect(parseRoute('/tools/close-approaches/25544')).toEqual({ workspace: 'tools', tool: 'close-approaches' })
		expect(routePath({ workspace: 'tools', tool: 'calculator', project: 'p' })).toBe('/tools/calculator')
		expect(parseRoute('/tools/observing-planner/plan%20a')).toEqual({ workspace: 'tools', tool: 'observing-planner', plan: 'plan a' })
		expect(routePath({ workspace: 'tools', tool: 'observing-planner', plan: 'plan a' })).toBe('/tools/observing-planner/plan%20a')
		expect(parseRoute('/tools/observing-planner')).toEqual({ workspace: 'tools', tool: 'observing-planner' })
		expect(parseRoute('/tools/jupiter-observing-planner')).toEqual({ workspace: 'tools', tool: 'jupiter-observing-planner' })
		expect(parseRoute('/tools/jupiter-observing-planner/extra')).toEqual({ workspace: 'tools', tool: 'jupiter-observing-planner' })
		expect(routePath({ workspace: 'tools', tool: 'jupiter-observing-planner' })).toBe('/tools/jupiter-observing-planner')
		expect(routePath({ workspace: 'tools', tool: 'calculator', plan: 'p' })).toBe('/tools/calculator')
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

	test('reads the INDI messages view of a device', () => {
		expect(parseRoute('/equipment/abc123/messages')).toEqual({ workspace: 'equipment', device: 'abc123', view: 'messages' })
		expect(parseRoute('/equipment/abc123/messages/extra')).toEqual({ workspace: 'equipment', device: 'abc123', view: 'messages' })
		expect(parseRoute('/equipment/abc123/Messages')).toEqual({ workspace: 'equipment', device: 'abc123' })
		expect(routePath({ workspace: 'equipment', device: 'abc123', view: 'messages' })).toBe('/equipment/abc123/messages')
	})

	test('reads the Settings page, its section, and its external program', () => {
		expect(parseRoute('/settings')).toEqual({ workspace: 'settings', section: 'external-tools' })
		expect(parseRoute('/settings/external-tools')).toEqual({ workspace: 'settings', section: 'external-tools' })
		expect(parseRoute('/settings/external-tools/astap/extra')).toEqual({ workspace: 'settings', section: 'external-tools', tool: 'astap' })
		expect(parseRoute('/settings/other/astap')).toEqual({ workspace: 'settings', section: 'external-tools' })
		expect(parseRoute('/settings/status-bar')).toEqual({ workspace: 'settings', section: 'status-bar' })
		expect(parseRoute('/settings/status-bar/extra')).toEqual({ workspace: 'settings', section: 'status-bar' })
		expect(routePath({ workspace: 'settings', section: 'status-bar' })).toBe('/settings/status-bar')
		expect(parseRoute('/tools/astronomical-time-converter')).toEqual({ workspace: 'tools', tool: 'astronomical-time-converter' })
		expect(routePath({ workspace: 'tools', tool: 'astronomical-time-converter' })).toBe('/tools/astronomical-time-converter')
		expect(routePath({ workspace: 'settings' })).toBe('/settings/external-tools')
		expect(routePath({ workspace: 'settings', section: 'external-tools' })).toBe('/settings/external-tools')
		expect(routePath({ workspace: 'settings', tool: 'astap' })).toBe('/settings/external-tools/astap')
	})

	test('reads the Observing Sites and Date & Time sections, and the site shown', () => {
		expect(parseRoute('/settings/observing-sites')).toEqual({ workspace: 'settings', section: 'observing-sites' })
		expect(parseRoute('/settings/observing-sites/a%20b/extra')).toEqual({ workspace: 'settings', section: 'observing-sites', site: 'a b' })
		expect(routePath({ workspace: 'settings', section: 'observing-sites', site: 'a b' })).toBe('/settings/observing-sites/a%20b')
		expect(parseRoute('/settings/date-time/extra')).toEqual({ workspace: 'settings', section: 'date-time' })
		expect(routePath({ workspace: 'settings', section: 'date-time', site: 'ignored' })).toBe('/settings/date-time')
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
		for (const path of ['/images', '/sky', '/tools', '/tools/calculator', '/tools/solar-eclipse-map/1786556760000', '/tools/lunar-eclipse-map/1803423600000', '/tools/observing-planner/p1', '/equipment/abc123', '/equipment/abc123/indi', '/equipment/abc123/messages', '/about'])
			expect(routePath(parseRoute(path))).toBe(path)
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
