import { expect, test } from 'bun:test'
import type { QuadIndexDownloadsSnapshot } from 'api'
import { proxy } from 'valtio'
import { changeQuadIndex, handleQuadIndexEvent, type QuadIndexesState, refreshQuadIndexes } from './quadindexes'

function snapshot(revision: number): QuadIndexDownloadsSnapshot {
	return { revision, directory: '/home/nebulosa/quad-indexes', searched: true, sources: [], bands: [] }
}

function newState(): QuadIndexesState {
	return proxy<QuadIndexesState>({ pending: {}, errors: {} })
}

test('keeps the latest snapshot of the events and the responses', async () => {
	const state = newState()
	handleQuadIndexEvent(state, { type: 'quadIndexes:updated', snapshot: snapshot(5) })
	await refreshQuadIndexes(state, () => Promise.resolve(Response.json(snapshot(3))))

	expect(state.snapshot?.revision).toBe(5)

	handleQuadIndexEvent(state, { type: 'quadIndexes:updated', snapshot: snapshot(6) })
	expect(state.snapshot?.revision).toBe(6)
})

test('sends the request of a band and keeps why it failed', async () => {
	const state = newState()
	const requests: string[] = []
	const request = (url: string, init?: RequestInit) => {
		requests.push(`${init?.method} ${url}`)
		return Promise.resolve(url.endsWith('/download') ? Response.json({ error: 'This band is not shared yet.', code: 'notPublished' }, { status: 409 }) : Response.json(snapshot(1)))
	}

	await changeQuadIndex(state, 'astap-d20-480', 'download', request)
	expect(state.errors['astap-d20-480']).toBe('This band is not shared yet.')
	expect(state.pending['astap-d20-480']).toBeUndefined()

	await changeQuadIndex(state, 'astap-d20-480', 'remove', request)
	expect(state.errors['astap-d20-480']).toBeUndefined()
	expect(state.snapshot?.revision).toBe(1)
	expect(requests).toEqual(['POST /api/settings/external-tools/nebulosa/indexes/astap-d20-480/download', 'DELETE /api/settings/external-tools/nebulosa/indexes/astap-d20-480'])
})
