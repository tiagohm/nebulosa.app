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

	sessions.adopt('cam', first)
	sessions.adopt('other', other)
	sessions.adopt('cam', second)

	expect(sessions.of('cam')).toBe(second)
	expect(sessions.find('s1')).toBeUndefined()
	expect(sessions.find('s2')).toBe(second)
	expect(sessions.summaries().map(({ sessionId }) => sessionId)).toEqual(['s2', 's3'])
	expect(sessions.latest(first)).toBeFalse()
	expect(sessions.latest(second)).toBeTrue()
})

test('a change is published with the next revision only while the session is the latest of its camera', () => {
	const { sessions, published } = registry()
	const first = session('s1')
	sessions.adopt('cam', first)

	sessions.update(first, { state: 'stopping' })
	expect(published).toEqual([{ sessionId: 's1', operationId: '', revision: 1, state: 'stopping' }])

	sessions.adopt('cam', session('s2'))
	sessions.replace(first, { ...first.summary, state: 'stopped' })
	expect(first.summary).toMatchObject({ revision: 2, state: 'stopped' })
	expect(published).toHaveLength(1)

	const unadopted = session('s0')
	sessions.update(unadopted, { state: 'stopped' })
	expect(unadopted.summary.revision).toBe(1)
	expect(published).toHaveLength(1)
})

test('a repeated start token answers its session until a newer one replaces it', () => {
	const { sessions } = registry({ t1: 'o1', t2: 'o2' })
	const first = session('s1')
	sessions.adopt('cam', first)
	sessions.update(first, { operationId: 'o1' })
	sessions.track('o1', first)

	expect(sessions.repeated('t1')).toBe(first)
	expect(sessions.repeated('unknown')).toBeUndefined()

	const second = session('s2')
	sessions.adopt('cam', second)
	sessions.track('o2', second)
	expect(sessions.repeated('t1')).toBeUndefined()
	expect(sessions.repeated('t2')).toBe(second)
})
