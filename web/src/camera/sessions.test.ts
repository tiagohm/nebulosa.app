import { describe, expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { jsonInit } from '../http'
import { SnapshotRefreshes } from '../refresh'
import { acceptSession, applySession, type CameraSessionKind, type CameraSessionRecords, type CameraSessionSummary, loadSessionRecord, refreshSessionRecords, sendSessionCommand, sessionKey } from './sessions'

interface Summary extends CameraSessionSummary {
	readonly revision: number
	readonly frames: number
	readonly endedAt?: number
}

interface Record extends Summary {
	readonly items: readonly number[]
}

const KEY = 'c:cam'

function summary(patch: Partial<Summary> = {}): Summary {
	return { sessionId: 's1', camera: { connectionId: 'c', deviceId: 'cam' }, startedAt: 1000, revision: 1, frames: 0, ...patch }
}

function record(patch: Partial<Record> = {}): Record {
	return { ...summary(), items: [], ...patch }
}

function newState() {
	return proxy<CameraSessionRecords<Summary, Record>>({ sessions: {}, details: {}, pending: {}, errors: {} })
}

function kind(patch: Partial<CameraSessionKind<Summary, Record>> = {}): CameraSessionKind<Summary, Record> {
	return { url: '/api/kind', refreshes: new SnapshotRefreshes(), stale: (session, _, details) => details?.frames !== session.frames, ...patch }
}

// Fetch fake answering each URL with the response its handler builds, recording the URLs.
function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
	const urls: string[] = []
	const request = ((url: string, init?: RequestInit) => {
		urls.push(url)
		return Promise.resolve(handler(url, init))
	}) as typeof fetch
	return { request, urls }
}

describe('events', () => {
	test('a summary of an older session, or an earlier revision, never replaces the one known', () => {
		const state = newState()
		const refreshes = new SnapshotRefreshes()

		expect(acceptSession(state, refreshes, summary({ revision: 5 }))).toEqual({ known: undefined })
		expect(acceptSession(state, refreshes, summary({ revision: 4 }))).toBeUndefined()
		expect(acceptSession(state, refreshes, summary({ revision: 5 }))).toBeUndefined()
		expect(acceptSession(state, refreshes, summary({ sessionId: 's0', startedAt: 500, revision: 9 }))).toBeUndefined()
		expect(state.sessions[KEY].revision).toBe(5)

		const accepted = acceptSession(state, refreshes, summary({ sessionId: 's2', startedAt: 2000 }))
		expect(accepted?.known?.sessionId).toBe('s1')
		expect(state.sessions[KEY].sessionId).toBe('s2')
		expect(sessionKey(state.sessions[KEY])).toBe(KEY)
	})

	test('a kind without revisions takes every summary of the same session', () => {
		const state = proxy<CameraSessionRecords<CameraSessionSummary, Record>>({ sessions: {}, details: {}, pending: {}, errors: {} })
		const refreshes = new SnapshotRefreshes()
		const unrevised = { sessionId: 's1', camera: { connectionId: 'c', deviceId: 'cam' }, startedAt: 1000 }

		expect(acceptSession(state, refreshes, unrevised)).toBeDefined()
		expect(acceptSession(state, refreshes, { ...unrevised })).toBeDefined()
	})

	test('a new session forgets the records of the others, and a stale record is fetched again', async () => {
		const state = newState()
		state.details.s1 = record()
		const { request, urls } = fakeFetch(() => Response.json(record({ sessionId: 's2', startedAt: 2000, frames: 1 })))

		applySession(state, kind(), summary({ sessionId: 's2', startedAt: 2000, frames: 1 }), request)
		expect(state.details.s1).toBeUndefined()
		await Bun.sleep(0)
		expect(urls).toEqual(['/api/kind/s2'])
		expect(state.details.s2.frames).toBe(1)

		applySession(state, kind(), summary({ sessionId: 's2', startedAt: 2000, frames: 1, revision: 2 }), request)
		await Bun.sleep(0)
		expect(urls).toHaveLength(1)
	})
})

describe('records', () => {
	test('a late record never replaces a newer one, and a session the server forgot is forgotten', async () => {
		const state = newState()
		state.details.s1 = record({ revision: 3 })

		await loadSessionRecord(state, kind(), 's1', fakeFetch(() => Response.json(record({ revision: 2 }))).request)
		expect(state.details.s1.revision).toBe(3)

		await loadSessionRecord(state, kind(), 's1', fakeFetch(() => Response.json(record({ revision: 4 }))).request)
		expect(state.details.s1.revision).toBe(4)

		await loadSessionRecord(state, kind(), 's1', fakeFetch(() => new Response(null, { status: 404 })).request)
		expect(state.details.s1).toBeUndefined()
	})

	test('a kind may order its records by its own rule', async () => {
		const state = newState()
		state.details.s1 = record({ items: [1, 2] })
		const byItems = kind({ newer: (loaded, known) => loaded.items.length > known.items.length })

		await loadSessionRecord(state, byItems, 's1', fakeFetch(() => Response.json(record({ items: [1], revision: 9 }))).request)
		expect(state.details.s1.items).toEqual([1, 2])
	})
})

describe('refresh', () => {
	test('replaces the sessions, forgets the records of those gone, and fetches the others', async () => {
		const state = newState()
		state.sessions.gone = summary({ sessionId: 'gone', camera: { connectionId: 'c', deviceId: 'gone' } })
		state.details.gone = record({ sessionId: 'gone' })
		const { request, urls } = fakeFetch((url) => (url === '/api/kind' ? Response.json({ sessions: [summary()] }) : Response.json(record())))

		await refreshSessionRecords(state, kind(), request)
		await Bun.sleep(0)

		expect(Object.keys(state.sessions)).toEqual([KEY])
		expect(state.details.gone).toBeUndefined()
		expect(urls).toEqual(['/api/kind', '/api/kind/s1'])
		expect(state.details.s1).toBeDefined()
	})

	test('leaves a session an event ended during its request, and drops a superseded response', async () => {
		const state = newState()
		const source = kind()
		const first = Promise.withResolvers<Response>()
		const second = Promise.withResolvers<Response>()
		const snapshots = [first.promise, second.promise]
		const request = ((url: string) => (url === '/api/kind' ? snapshots.shift()! : Promise.resolve(Response.json(record())))) as typeof fetch

		const earlier = refreshSessionRecords(state, source, request)
		const later = refreshSessionRecords(state, source, request)
		applySession(state, source, summary({ endedAt: 5000, revision: 2 }), request)
		second.resolve(Response.json({ sessions: [summary()] }))
		await later
		first.resolve(Response.json({ sessions: [] }))
		await earlier

		expect(state.sessions[KEY].endedAt).toBe(5000)
	})
})

describe('commands', () => {
	test('one command of a camera at a time, its refusal kept, and its accepted response returned unread', async () => {
		const state = newState()
		const answer = Promise.withResolvers<Response>()
		const { request } = fakeFetch(() => answer.promise)
		const refresh = () => Promise.resolve()

		const sending = sendSessionCommand(state, KEY, '/api/start', jsonInit('POST', { token: 't' }), refresh, request)
		expect(state.pending[KEY]).toBeTrue()
		expect(await sendSessionCommand(state, KEY, '/api/start', jsonInit('POST'), refresh, request)).toBeUndefined()
		answer.resolve(Response.json({ sessionId: 's1' }, { status: 202 }))
		expect(((await (await sending)!.json()) as { sessionId: string }).sessionId).toBe('s1')
		expect(state.pending[KEY]).toBeUndefined()

		await sendSessionCommand(state, KEY, '/api/start', jsonInit('POST'), refresh, fakeFetch(() => Response.json({ error: 'The camera is busy', code: 'busy' }, { status: 409 })).request)
		expect(state.errors[KEY]).toBe('The camera is busy')
	})

	test('an unreachable server refreshes the snapshot, since the command may have been applied', async () => {
		const state = newState()
		let refreshed = 0

		const response = await sendSessionCommand(
			state,
			KEY,
			'/api/start',
			jsonInit('POST'),
			() => Promise.resolve(refreshed++),
			() => Promise.reject(new Error('offline')),
		)
		expect(response).toBeUndefined()
		expect(refreshed).toBe(1)
		expect(state.errors[KEY]).toBe('Unable to reach the server.')
	})
})
