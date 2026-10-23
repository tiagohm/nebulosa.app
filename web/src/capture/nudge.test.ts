import { expect, test } from 'bun:test'
import type { MountNudgeSession, MountState } from 'api'
import { proxy } from 'valtio'
import { handleNudgeEvent, nudgeDirectionSupported, nudgeEndProblem, nudgeKey, type NudgeRuntime, pressNudge, refreshNudges, releaseNudge, stopNudges, watchNudgeMount } from './nudge'

const TARGET = { connectionId: 'c', id: 'm' }

function newState(patch: Partial<NudgeRuntime> = {}) {
	return proxy<NudgeRuntime>({ target: { ...TARGET }, sessions: {}, sending: false, ...patch })
}

function session(patch: Partial<MountNudgeSession> = {}): MountNudgeSession {
	return { token: 't', operationId: 'o', connectionId: 'c', deviceId: 'm', direction: 'N', phase: 'moving', startedAt: 1000, ...patch }
}

function mountState(patch: Partial<MountState> = {}): MountState {
	return {
		connectionId: 'c',
		id: 'm',
		connected: true,
		rightAscension: 0,
		declination: 0,
		slewing: false,
		tracking: true,
		parked: false,
		parking: false,
		homing: false,
		canGoTo: true,
		canFlip: false,
		canSync: true,
		canAbort: true,
		canTracking: true,
		canPark: true,
		canSetPark: false,
		canHome: false,
		canFindHome: false,
		canSetHome: false,
		canMove: true,
		canMoveNS: true,
		canMoveWE: true,
		moving: false,
		slewRates: [],
		trackModes: ['SIDEREAL'],
		trackMode: 'SIDEREAL',
		mountType: 'EQ_GEM',
		hasPierSide: false,
		pierSide: 'NEITHER',
		site: { latitude: 0, longitude: 0, elevation: 0 },
		time: { utc: 0, offset: 0 },
		...patch,
	}
}

// Fetch fake answering each request with the response its handler builds, recording the requests.
function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
	const requests: { url: string; body?: unknown }[] = []
	const request = ((url: string, init?: RequestInit) => {
		requests.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
		return Promise.resolve(handler(url, init))
	}) as typeof fetch
	return { request, requests }
}

// Start response of a moving press with the token of the request.
function started(init: RequestInit | undefined, phase: MountNudgeSession['phase'] = 'moving', heartbeatInterval = 10) {
	const { token, direction } = JSON.parse(init!.body as string) as { token: string; direction: MountNudgeSession['direction'] }
	return Response.json({ session: session({ token, direction, phase }), heartbeatInterval, leaseTimeout: 100 }, { status: 202 })
}

test('a press starts, renews its lease while moving, and stops on release', async () => {
	const state = newState()
	const { request, requests } = fakeFetch((url, init) => (url.endsWith('/nudge') ? started(init) : new Response(null, { status: 204 })))

	await pressNudge(state, 'NE', request)
	const token = state.press!.token
	expect(state.press).toMatchObject({ direction: 'NE', phase: 'moving', target: TARGET })
	expect(requests[0]).toEqual({ url: '/api/connections/c/mounts/m/nudge', body: { token, direction: 'NE' } })

	await Bun.sleep(35)
	expect(requests.filter((r) => r.url === `/api/mounts/nudges/${token}/heartbeat`).length).toBeGreaterThanOrEqual(2)

	await releaseNudge(state, request)
	expect(state.press).toBeUndefined()
	expect(requests.at(-1)?.url).toBe(`/api/mounts/nudges/${token}/stop`)

	const sent = requests.length
	await Bun.sleep(30)
	expect(requests.length).toBe(sent)
})

test('a release before the start answers sends the stop at once and never renews the press', async () => {
	const state = newState()
	const answer = Promise.withResolvers<Response>()
	const { request, requests } = fakeFetch((url) => (url.endsWith('/nudge') ? answer.promise : new Response(null, { status: 204 })))

	const pressing = pressNudge(state, 'S', request)
	const token = state.press!.token
	await releaseNudge(state, request)
	expect(requests.map((r) => r.url)).toEqual(['/api/connections/c/mounts/m/nudge', `/api/mounts/nudges/${token}/stop`])
	expect(state.press).toBeUndefined()

	answer.resolve(Response.json({ session: session({ token, phase: 'moving' }), heartbeatInterval: 5, leaseTimeout: 50 }, { status: 202 }))
	await pressing
	await Bun.sleep(20)
	expect(state.press).toBeUndefined()
	expect(requests.some((r) => r.url.endsWith('/heartbeat'))).toBeFalse()
})

test('a second press is ignored while one is held', async () => {
	const state = newState()
	const { request, requests } = fakeFetch((url, init) => (url.endsWith('/nudge') ? started(init) : new Response(null, { status: 204 })))

	await pressNudge(state, 'N', request)
	await pressNudge(state, 'E', request)
	expect(requests.filter((r) => r.url.endsWith('/nudge'))).toHaveLength(1)
	expect(state.press?.direction).toBe('N')
	await releaseNudge(state, request)
})

test('a refused start keeps the server reason and holds no press', async () => {
	const state = newState()
	const { request } = fakeFetch(() => Response.json({ error: 'The mount is busy' }, { status: 409 }))

	await pressNudge(state, 'W', request)
	expect(state.press).toBeUndefined()
	expect(state.error).toBe('The mount is busy')
})

test('events of an older press never change the current one, and the end of the press forgets it', async () => {
	const state = newState()
	const { request } = fakeFetch((url, init) => (url.endsWith('/nudge') ? started(init) : new Response(null, { status: 204 })))
	await pressNudge(state, 'N', request)
	const token = state.press!.token

	handleNudgeEvent(state, { type: 'mount:nudge', session: session({ token: 'old', phase: 'stopped', startedAt: 500 }) })
	expect(state.press?.phase).toBe('moving')
	expect(state.sessions[nudgeKey('c', 'm')]?.token).toBe('old')

	handleNudgeEvent(state, { type: 'mount:nudge', session: session({ token, phase: 'moving', startedAt: 2000 }) })
	handleNudgeEvent(state, { type: 'mount:nudge', session: session({ token: 'old', phase: 'failed', reason: 'timeout', startedAt: 500 }) })
	expect(state.sessions[nudgeKey('c', 'm')]?.token).toBe(token)

	handleNudgeEvent(state, { type: 'mount:nudge', session: session({ token, phase: 'failed', reason: 'timeout', stopConfirmed: true, startedAt: 2000 }) })
	expect(state.press).toBeUndefined()
	expect(state.error).toBe('Stopped: control of the motion was lost.')
})

test('a socket reopen never restores a press the server no longer runs', async () => {
	const state = newState()
	const { request } = fakeFetch((url, init) => (url.endsWith('/nudge') ? started(init) : url === '/api/mounts/nudges' ? Response.json([]) : new Response(null, { status: 204 })))
	await pressNudge(state, 'N', request)
	state.sessions[nudgeKey('c', 'm')] = session({ token: state.press!.token })

	await refreshNudges(state, request)
	expect(state.press).toBeUndefined()
	expect(state.sessions).toEqual({})
})

test('STOP ends this tab press and the nudge another tab runs on the mount', async () => {
	const state = newState()
	state.sessions[nudgeKey('c', 'm')] = session({ token: 'other-tab' })
	const { request, requests } = fakeFetch(() => new Response(null, { status: 204 }))

	await stopNudges(state, request)
	expect(requests.map((r) => r.url)).toEqual(['/api/mounts/nudges/other-tab/stop'])
})

test('follows the mount state and judges directions by axis', () => {
	const state = newState()
	handleNudgeEvent(state, { type: 'mount:updated', state: mountState({ canMoveWE: false }) })
	handleNudgeEvent(state, { type: 'mount:updated', state: mountState({ id: 'other', canMoveNS: false }) })

	expect(state.state?.canMoveWE).toBeFalse()
	expect(nudgeDirectionSupported(state.state, 'N')).toBeTrue()
	expect(nudgeDirectionSupported(state.state, 'E')).toBeFalse()
	expect(nudgeDirectionSupported(state.state, 'NE')).toBeFalse()
	expect(nudgeDirectionSupported(undefined, 'N')).toBeFalse()

	handleNudgeEvent(state, { type: 'connection:close', id: 'c' })
	expect(state.state).toBeUndefined()
})

test('describes abnormal ends only', () => {
	expect(nudgeEndProblem(session({ phase: 'stopped', stopConfirmed: true }))).toBeUndefined()
	expect(nudgeEndProblem(session({ phase: 'failed', reason: 'disconnected', stopConfirmed: false }))).toBe('Stopped: the mount disconnected. The mount was not observed to stop.')
	expect(nudgeEndProblem(session({ phase: 'failed', reason: 'commandFailed', error: 'transport closed' }))).toBe('transport closed')
})

test('following another mount releases the press held on the previous one, which keeps its own target', async () => {
	const state = newState()
	const { request, requests } = fakeFetch((url, init) => (url.endsWith('/nudge') ? started(init) : url.endsWith('/mounts/m2') ? Response.json(mountState({ id: 'm2' })) : new Response(null, { status: 204 })))

	await pressNudge(state, 'N', request)
	const token = state.press!.token
	watchNudgeMount(state, { connectionId: 'c', id: 'm2' }, request)
	await Bun.sleep(0)

	expect(requests.some((r) => r.url === `/api/mounts/nudges/${token}/stop`)).toBeTrue()
	expect(state.press).toBeUndefined()
	expect(state.target).toEqual({ connectionId: 'c', id: 'm2' })
	expect(requests.filter((r) => r.url === '/api/connections/c/mounts/m/nudge')).toHaveLength(1)
})
