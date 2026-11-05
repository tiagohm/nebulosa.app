import { expect, test } from 'bun:test'
import { type CameraSession, CameraSessionRegistry } from './camerasessions'
import type { OperationRecord } from './operations'

interface Summary {
	readonly sessionId: string
	readonly operationId: string
	readonly revision: number
	readonly state: string
}

type Session = CameraSession<Summary>

function session(sessionId: string): Session {
	return { summary: { sessionId, operationId: '', revision: 0, state: 'running' } }
}

function registry(tokens: Record<string, string> = {}) {
	const published: Summary[] = []
	const operations = { started: (token: string) => (tokens[token] ? ({ operationId: tokens[token] } as OperationRecord) : undefined) }
	return { sessions: new CameraSessionRegistry<Summary, Session>(operations, (summary) => published.push(summary)), published }
}

test('keeps the latest session of each camera, and finds only those', () => {
	const { sessions } = registry()
	const first = session('s1')
	const second = session('s2')
	const other = session('s3')

	sessions.adopt('cam', first, 'o1')
	sessions.adopt('other', other, 'o3')
	sessions.adopt('cam', second, 'o2')

	expect(sessions.of('cam')).toBe(second)
	expect(sessions.find('s1')).toBeUndefined()
	expect(sessions.find('s2')).toBe(second)
	expect(sessions.summaries().map(({ sessionId }) => sessionId)).toEqual(['s2', 's3'])
	expect(sessions.latest(first)).toBeFalse()
	expect(sessions.latest(second)).toBeTrue()
})

test('a session is published from its adoption on, with its operation and the changes made before it, and only while it is the latest of its camera', () => {
	const { sessions, published } = registry()
	const first = session('s1')
	sessions.update(first, { state: 'starting' })
	expect(published).toEqual([])

	sessions.adopt('cam', first, 'o1')
	sessions.update(first, { state: 'stopping' })
	expect(published).toEqual([
		{ sessionId: 's1', operationId: 'o1', revision: 2, state: 'starting' },
		{ sessionId: 's1', operationId: 'o1', revision: 3, state: 'stopping' },
	])

	sessions.adopt('cam', session('s2'), 'o2')
	published.length = 0
	sessions.replace(first, { ...first.summary, state: 'stopped' })
	expect(first.summary).toMatchObject({ revision: 4, state: 'stopped' })
	expect(published).toEqual([])

	const unadopted = session('s0')
	sessions.update(unadopted, { state: 'stopped' })
	expect(unadopted.summary.revision).toBe(1)
	expect(published).toEqual([])
})

test('a repeated start token answers its session, even once a newer one replaced it', () => {
	const { sessions } = registry({ t1: 'o1', t2: 'o2' })
	const first = session('s1')
	sessions.adopt('cam', first, 'o1')

	expect(sessions.repeated('t1')).toBe(first)
	expect(sessions.repeated('unknown')).toBeUndefined()

	const second = session('s2')
	sessions.adopt('cam', second, 'o2')
	expect(sessions.repeated('t1')).toBe(first)
	expect(sessions.repeated('t2')).toBe(second)
	expect(sessions.find('s1')).toBeUndefined()
})
