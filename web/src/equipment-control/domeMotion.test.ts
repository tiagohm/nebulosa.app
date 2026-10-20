import { expect, test } from 'bun:test'
import type { DomeMotionSession } from 'api'
import { proxy } from 'valtio'
import { domeKey, domeMotionEndProblem, type DomeMotionRuntime, handleDomeMotionEvent, pressDomeMotion, refreshDomeMotions, releaseDomeMotion } from './domeMotion'

function session(patch: Partial<DomeMotionSession> = {}): DomeMotionSession {
	return { token: 't', operationId: 'o', connectionId: 'c', deviceId: 'd', direction: 'CLOCKWISE', phase: 'moving', startedAt: 1000, ...patch }
}

// Fetch fake answering each request with the response its handler builds, recording the requests.
function fakeFetch(respond: (url: string, init?: RequestInit) => Response) {
	const requests: { url: string; init?: RequestInit }[] = []
	const request = ((url: string, init?: RequestInit) => {
		requests.push({ url, init })
		return Promise.resolve(respond(url, init))
	}) as typeof fetch
	return { requests, request }
}

test('a press starts with its own token and is released by it', async () => {
	const runtime = proxy<DomeMotionRuntime>({ sessions: {} })
	let token = ''
	const { requests, request } = fakeFetch((url, init) => {
		if (url.endsWith('/motion')) {
			token = (JSON.parse(init?.body as string) as { token: string }).token
			return Response.json({ session: session({ token }), heartbeatInterval: 60000, leaseTimeout: 120000 }, { status: 202 })
		}
		return new Response(null, { status: 204 })
	})

	await pressDomeMotion(runtime, 'c', 'd', 'COUNTER_CLOCKWISE', request)
	expect(requests[0].url).toBe('/api/connections/c/domes/d/motion')
	expect(JSON.parse(requests[0].init?.body as string)).toMatchObject({ direction: 'COUNTER_CLOCKWISE' })
	expect(runtime.press).toMatchObject({ token, deviceId: 'd', phase: 'moving' })

	await pressDomeMotion(runtime, 'c', 'd', 'CLOCKWISE', request)
	expect(requests).toHaveLength(1)

	await releaseDomeMotion(runtime, request)
	expect(requests[1].url).toBe(`/api/domes/motions/${token}/stop`)
	expect(runtime.press).toBeUndefined()
})

test('events follow the press and keep why it ended abnormally', () => {
	const runtime = proxy<DomeMotionRuntime>({ sessions: {}, press: { token: 't', connectionId: 'c', deviceId: 'd', direction: 'CLOCKWISE', phase: 'starting' } })

	handleDomeMotionEvent(runtime, { type: 'dome:motion', session: session() })
	expect(runtime.press?.phase).toBe('moving')
	expect(runtime.sessions[domeKey('c', 'd')]).toEqual(session())

	handleDomeMotionEvent(runtime, { type: 'dome:motion', session: session({ token: 'old', startedAt: 10, phase: 'stopped' }) })
	expect(runtime.sessions[domeKey('c', 'd')].token).toBe('t')

	handleDomeMotionEvent(runtime, { type: 'dome:motion', session: session({ phase: 'failed', reason: 'timeout', stopConfirmed: true }) })
	expect(runtime.press).toBeUndefined()
	expect(runtime.error).toBe('Stopped: control of the rotation was lost.')
	expect(domeMotionEndProblem(session({ phase: 'stopped', stopConfirmed: false }))).toBe('The dome was not observed to stop.')
	expect(domeMotionEndProblem(session({ phase: 'stopped', stopConfirmed: true }))).toBeUndefined()
})

test('a socket reopen forgets a press the server no longer runs', async () => {
	const runtime = proxy<DomeMotionRuntime>({ sessions: { [domeKey('c', 'd')]: session() }, press: { token: 't', connectionId: 'c', deviceId: 'd', direction: 'CLOCKWISE', phase: 'moving' } })

	await refreshDomeMotions(runtime, fakeFetch(() => Response.json([])).request)
	expect(runtime.press).toBeUndefined()
	expect(runtime.sessions).toEqual({})
})
