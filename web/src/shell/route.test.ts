import { describe, expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { DEFAULT_ROUTE, navigate, openWorkspace, parseRoute, type RouteState, routePath } from './route'

function newState(): RouteState {
	return proxy<RouteState>({ route: DEFAULT_ROUTE, captureMode: 'camera' })
}

function fakeHistory() {
	const paths: string[] = []
	return { paths, pushState: (_data: unknown, _unused: string, url?: string | URL | null) => void paths.push(String(url)) }
}

describe('parse', () => {
	test('reads workspaces and capture modes', () => {
		expect(parseRoute('/images')).toEqual({ workspace: 'images' })
		expect(parseRoute('/tools/')).toEqual({ workspace: 'tools' })
		expect(parseRoute('/capture/mount-nudge')).toEqual({ workspace: 'capture', mode: 'mount-nudge' })
	})

	test('falls back for unknown paths and modes', () => {
		expect(parseRoute('/')).toEqual(DEFAULT_ROUTE)
		expect(parseRoute('/sequencer')).toEqual(DEFAULT_ROUTE)
		expect(parseRoute('/capture')).toEqual({ workspace: 'capture', mode: 'camera' })
		expect(parseRoute('/capture/bogus')).toEqual({ workspace: 'capture', mode: 'camera' })
	})

	test('round-trips canonical paths', () => {
		for (const path of ['/capture/camera', '/capture/polar-alignment', '/images', '/sky', '/tools']) expect(routePath(parseRoute(path))).toBe(path)
	})
})

describe('navigate', () => {
	test('pushes only path changes', () => {
		const state = newState()
		const history = fakeHistory()

		navigate(state, { workspace: 'capture', mode: 'camera' }, history)
		navigate(state, { workspace: 'sky' }, history)

		expect(history.paths).toEqual(['/sky'])
		expect(state.route).toEqual({ workspace: 'sky' })
	})

	test('the rail reopens the last capture mode', () => {
		const state = newState()
		const history = fakeHistory()

		navigate(state, { workspace: 'capture', mode: 'focus-calibrator' }, history)
		openWorkspace(state, 'images', history)
		openWorkspace(state, 'capture', history)

		expect(state.route).toEqual({ workspace: 'capture', mode: 'focus-calibrator' })
		expect(history.paths).toEqual(['/capture/focus-calibrator', '/images', '/capture/focus-calibrator'])
	})
})
