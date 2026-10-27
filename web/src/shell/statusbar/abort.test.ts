import { describe, expect, test } from 'bun:test'
import type { DeviceSummary, MountState } from 'api'
import { newControlRuntime } from '../../equipment-control/control'
import { newProfile } from '../../profile/profile'
import type { Profile } from '../../profile/schema'
import { abortProfileMount, type MountAbortStores } from './abort'

function mount(id: string, connectionId: string): DeviceSummary {
	return { id, type: 'mount', name: `Mount ${id}`, connected: true, connectionId, hardwareId: id, interfaces: ['mount'], driver: { executable: '', version: '' } }
}

function slewing(id: string, connectionId: string, patch: Partial<MountState> = {}) {
	return { id, connectionId, connected: true, canAbort: true, slewing: true, moving: false, parking: false, homing: false, ...patch } as MountState
}

// Profile A works with server A and its mount m1, which is slewing; profile B works with server B.
function stores() {
	const a: Profile = { ...newProfile('A'), connectionId: 'saved-a', equipment: { 'saved-a': { MOUNT: { id: 'm1', name: 'Mount m1' } } } }
	const b: Profile = { ...newProfile('B'), connectionId: 'saved-b', equipment: { 'saved-b': { MOUNT: { id: 'm2', name: 'Mount m2' } } } }
	const control = newControlRuntime()
	control.watched = 'A'
	control.states.mount.m1 = slewing('m1', 'A')

	return {
		connections: {
			connections: [
				{ id: 'saved-a', name: 'A', type: 'INDI', host: 'a.local', port: 7624 },
				{ id: 'saved-b', name: 'B', type: 'INDI', host: 'b.local', port: 7624 },
			],
			servers: [
				{ id: 'A', type: 'INDI', host: 'a.local', port: 7624 },
				{ id: 'B', type: 'INDI', host: 'b.local', port: 7624 },
			],
		},
		profiles: { profiles: [a, b], activeId: a.id },
		devices: { watched: 'A', devices: [mount('m1', 'A')] },
		control,
		operations: { operations: {} },
		notifications: { server: 'online' },
	} satisfies MountAbortStores
}

function recorder(status = 204, body?: object) {
	const calls: { url: string; method?: string }[] = []
	const request = ((url: string, init?: RequestInit) => {
		calls.push({ url, method: init?.method })
		return Promise.resolve(body ? Response.json(body, { status }) : new Response(null, { status }))
	}) as typeof fetch
	return { calls, request }
}

describe('abort of the profile mount', () => {
	test('stops exactly the mount of the active profile on its connection', async () => {
		const { calls, request } = recorder()
		expect(await abortProfileMount(stores(), request)).toBe(true)
		expect(calls).toEqual([{ url: '/api/connections/A/mounts/m1/stop', method: 'POST' }])
	})

	test('sends nothing after a profile switch that happened after the button rendered', async () => {
		const state = stores()
		state.profiles.activeId = state.profiles.profiles[1].id
		const { calls, request } = recorder()
		expect(await abortProfileMount(state, request)).toBe(false)
		expect(calls).toEqual([])
	})

	test('sends nothing after the mount role was unassigned or the mount stopped', async () => {
		const unassigned = stores()
		unassigned.profiles.profiles[0].equipment['saved-a'] = {}
		const stopped = stores()
		stopped.control.states.mount.m1 = slewing('m1', 'A', { slewing: false })
		const { calls, request } = recorder()
		expect(await abortProfileMount(unassigned, request)).toBe(false)
		expect(await abortProfileMount(stopped, request)).toBe(false)
		expect(calls).toEqual([])
	})

	test('sends nothing while the event socket is offline', async () => {
		const state = { ...stores(), notifications: { server: 'offline' as const } }
		const { calls, request } = recorder()
		expect(await abortProfileMount(state, request)).toBe(false)
		expect(calls).toEqual([])
	})

	test('records a refused stop on the mount', async () => {
		const state = stores()
		const { request } = recorder(409, { error: 'The mount did not stop' })
		expect(await abortProfileMount(state, request)).toBe(false)
		expect(state.control.errors.m1).toBe('The mount did not stop')
	})
})
