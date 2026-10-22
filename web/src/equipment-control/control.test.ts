import { expect, test } from 'bun:test'
import type { DeviceStates, FocuserState, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { commandUrl, type ControlRuntime, deviceStateOf, handleControlEvent, newControlRuntime, refreshStates, sendCommand, startCommand, stopCommand, watchControl } from './control'

function focuser(patch: Partial<FocuserState> = {}): FocuserState {
	return {
		connectionId: 'c',
		id: 'f',
		connected: true,
		moving: false,
		position: { value: 100, min: 0, max: 1000, step: 1 },
		canAbsoluteMove: true,
		canRelativeMove: true,
		canAbort: true,
		canReverse: false,
		reversed: false,
		canSync: true,
		hasBacklash: false,
		backlashEnabled: false,
		backlash: { value: 0, min: 0, max: 0, step: 1 },
		...patch,
	}
}

function states(patch: Partial<DeviceStates> = {}): DeviceStates {
	return { camera: [], mount: [], focuser: [], wheel: [], rotator: [], guideOutput: [], dome: [], cover: [], flatPanel: [], dewHeater: [], ...patch }
}

function newState(watched = 'c'): ControlRuntime {
	return proxy<ControlRuntime>({ ...newControlRuntime(), watched })
}

// Fetch fake answering each request with the response its handler builds, recording the requests.
function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
	const requests: { url: string; init?: RequestInit }[] = []
	const request = ((url: string, init?: RequestInit) => {
		requests.push({ url, init })
		return Promise.resolve(respond(url, init))
	}) as typeof fetch
	return { requests, request }
}

const event = (state: FocuserState): ServerEvent => ({ type: 'focuser:updated', state })

test('the snapshot is replaced and events received while it loads are replayed onto it', async () => {
	const state = newState()
	const { promise, resolve } = Promise.withResolvers<Response>()
	const { request } = fakeFetch(() => promise)

	const refresh = refreshStates(state, request)
	expect(state.loading).toBeTrue()
	handleControlEvent(state, event(focuser({ moving: true, position: { value: 150, min: 0, max: 1000, step: 1 } })), request)
	resolve(Response.json(states({ focuser: [focuser()] })))
	await refresh

	expect(state.loading).toBeFalse()
	expect(deviceStateOf(state.states, 'focuser', 'f')).toMatchObject({ moving: true, position: { value: 150 } })
})

test('events of other connections are ignored and a removed device is forgotten', () => {
	const state = newState()
	handleControlEvent(state, event(focuser({ connectionId: 'other' })))
	expect(state.states.focuser).toEqual({})

	handleControlEvent(state, event(focuser()))
	handleControlEvent(state, { type: 'mount:nudge', session: {} } as ServerEvent)
	expect(deviceStateOf(state.states, 'focuser', 'f')).toEqual(focuser())

	handleControlEvent(state, { type: 'device:removed', connectionId: 'c', id: 'f' })
	expect(deviceStateOf(state.states, 'focuser', 'f')).toBeUndefined()
})

test('a closing connection drops its states and switching connection starts over', () => {
	const state = newState()
	handleControlEvent(state, event(focuser()))
	handleControlEvent(state, { type: 'connection:close', id: 'c' })
	expect(state.states.focuser).toEqual({})

	const { requests, request } = fakeFetch(() => Response.json(states()))
	state.errors.f = 'boom'
	watchControl(state, 'd', request)
	expect(state.errors).toEqual({})
	expect(requests[0].url).toBe('/api/connections/d/states')
	watchControl(state, undefined, request)
	expect(state.watched).toBeUndefined()
	expect(requests).toHaveLength(1)
})

test('a failed snapshot is reported without dropping the states', async () => {
	const state = newState()
	handleControlEvent(state, event(focuser()))
	await refreshStates(state, fakeFetch(() => Response.json({ error: 'Connection not found' }, { status: 404 })).request)
	expect(state.loadError).toBe('Connection not found')
	expect(deviceStateOf(state.states, 'focuser', 'f')).toBeDefined()
})

test('an immediate command is sent once and its refusal is recorded', async () => {
	const state = newState()
	const { promise, resolve } = Promise.withResolvers<Response>()
	const { requests, request } = fakeFetch(() => promise)
	const command = { type: 'focuser', deviceId: 'f', action: 'reverse', label: 'Reverse', body: { enabled: true } } as const

	const first = sendCommand(state, command, request)
	const second = sendCommand(state, command, request)
	expect(state.pending.f).toBe('Reverse')
	expect(await second).toBeFalse()
	resolve(Response.json({ error: 'The device is busy', code: 'busy' }, { status: 409 }))
	expect(await first).toBeFalse()

	expect(requests).toHaveLength(1)
	expect(requests[0].url).toBe(commandUrl('c', 'focuser', 'f', 'reverse'))
	expect(JSON.parse(requests[0].init?.body as string)).toEqual({ enabled: true })
	expect(state.pending).toEqual({})
	expect(state.errors.f).toBe('The device is busy')
})

test('a durable command carries a fresh token and records its operation', async () => {
	const state = newState()
	const { requests, request } = fakeFetch(() => Response.json({ operationId: 'o1' }, { status: 202 }))

	await startCommand(state, { type: 'focuser', deviceId: 'f', action: 'move-to', label: 'Move', body: { position: 10 } }, request)
	await startCommand(state, { type: 'focuser', deviceId: 'f', action: 'move-to', label: 'Move', body: { position: 10 } }, request)

	const bodies = requests.map((r) => JSON.parse(r.init?.body as string) as { position: number; token: string })
	expect(bodies[0].position).toBe(10)
	expect(bodies[0].token).not.toBe(bodies[1].token)
	expect(state.operations.f).toBe('o1')
})

test('an unreachable server reports that the command may have been applied and refreshes the states', async () => {
	const state = newState()
	const { requests, request } = fakeFetch((url) => {
		if (url.endsWith('/states')) return Response.json(states({ focuser: [focuser({ moving: true })] }))
		throw new Error('offline')
	})

	expect(await sendCommand(state, { type: 'focuser', deviceId: 'f', action: 'stop', label: 'Stop' }, request)).toBeFalse()
	expect(state.errors.f).toContain('may have been applied')
	expect(requests.at(-1)?.url).toBe('/api/connections/c/states')
	expect(deviceStateOf(state.states, 'focuser', 'f')?.moving).toBeTrue()
})

test('a stop is sent even while another command of the device is in flight', async () => {
	const state = newState()
	state.pending.f = 'Move'
	const { requests, request } = fakeFetch(() => new Response(null, { status: 204 }))

	expect(await stopCommand(state, { type: 'focuser', deviceId: 'f', action: 'stop' }, request)).toBeTrue()
	expect(requests[0].url).toBe('/api/connections/c/focusers/f/stop')
	expect(state.pending.f).toBe('Move')

	const failing = fakeFetch(() => Response.json({ error: 'The focuser did not stop', code: 'timeout' }, { status: 504 }))
	expect(await stopCommand(state, { type: 'focuser', deviceId: 'f', action: 'stop' }, failing.request)).toBeFalse()
	expect(state.errors.f).toBe('The focuser did not stop')
})
