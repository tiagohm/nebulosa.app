import { describe, expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { type CaptureRoute, DEFAULT_ROUTE, navigate, openWorkspace, parseRoute, redirect, type RouteState, routePath } from './route'

function newState(): RouteState {
	return proxy<RouteState>({ route: DEFAULT_ROUTE })
}

function fakeHistory() {
	const paths: string[] = []
	const replaced: string[] = []
	return { paths, replaced, pushState: (_data: unknown, _unused: string, url?: string | URL | null) => void paths.push(String(url)), replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => void replaced.push(String(url)) }
}

describe('parse', () => {
	test('reads workspaces, capture cameras, and capture modes', () => {
		expect(parseRoute('/images')).toEqual({ workspace: 'images' })
		expect(parseRoute('/tools/')).toEqual({ workspace: 'tools' })
		expect(parseRoute('/capture/guide/mount-nudge')).toEqual({ workspace: 'capture', camera: 'guide', mode: 'mount-nudge' })
	})

	test('reads capture paths written before camera views', () => {
		expect(parseRoute('/capture/mount-nudge')).toEqual({ workspace: 'capture', camera: 'main', mode: 'mount-nudge' })
	})

	test('falls back for unknown paths, cameras, and modes', () => {
		expect(parseRoute('/')).toEqual(DEFAULT_ROUTE)
		expect(parseRoute('/sequencer')).toEqual(DEFAULT_ROUTE)
		expect(parseRoute('/capture')).toEqual({ workspace: 'capture', camera: 'main', mode: 'camera' })
		expect(parseRoute('/capture/bogus')).toEqual({ workspace: 'capture', camera: 'main', mode: 'camera' })
		expect(parseRoute('/capture/guide/bogus')).toEqual({ workspace: 'capture', camera: 'guide', mode: 'camera' })
	})

	test('round-trips canonical paths', () => {
		for (const path of ['/capture/main/camera', '/capture/guide/polar-alignment', '/images', '/sky', '/tools']) expect(routePath(parseRoute(path))).toBe(path)
	})
})

describe('navigate', () => {
	test('pushes only path changes', () => {
		const state = newState()
		const history = fakeHistory()

		navigate(state, { workspace: 'capture', camera: 'main', mode: 'camera' }, history)
		navigate(state, { workspace: 'sky' }, history)

		expect(history.paths).toEqual(['/sky'])
		expect(state.route).toEqual({ workspace: 'sky' })
	})

	test('redirect replaces the path without a history entry', () => {
		const state = newState()
		const history = fakeHistory()

		redirect(state, { workspace: 'capture', camera: 'guide', mode: 'camera' }, history)

		expect(history.paths).toEqual([])
		expect(history.replaced).toEqual(['/capture/guide/camera'])
		expect(state.route).toEqual({ workspace: 'capture', camera: 'guide', mode: 'camera' })
	})

	test('the rail opens the given capture route', () => {
		const state = newState()
		const history = fakeHistory()
		const capture: CaptureRoute = { workspace: 'capture', camera: 'guide', mode: 'focus-calibrator' }

		openWorkspace(state, 'images', capture, history)
		openWorkspace(state, 'capture', capture, history)

		expect(state.route).toEqual(capture)
		expect(history.paths).toEqual(['/images', '/capture/guide/focus-calibrator'])
	})
})
