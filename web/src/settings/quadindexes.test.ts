import { expect, test } from 'bun:test'
import type { QuadIndexDownloadsSnapshot } from 'api'
import { arcmin, deg } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { bandsForField, changeQuadIndex, formatBandAngle, formatBandRange, handleQuadIndexEvent, type QuadIndexesState, refreshQuadIndexes } from './quadindexes'

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

test('a field is suited by the bands whose range of shorter sides holds its shorter side', () => {
	const bands = [
		{ id: 'a', bestShortSide: [deg(1), deg(2)] as const },
		{ id: 'b', bestShortSide: [deg(1.4), deg(2.8)] as const },
		{ id: 'c', bestShortSide: [deg(2), deg(4)] as const },
	]

	expect(bandsForField(bands, deg(2.75), deg(1.87)).map(({ id }) => id)).toEqual(['a', 'b'])
	expect(bandsForField(bands, deg(3), deg(5)).map(({ id }) => id)).toEqual(['c'])
	expect(bandsForField(bands, deg(0.5), deg(0.4))).toEqual([])
})

test('band angles read in arcminutes below a degree and without a trailing zero', () => {
	expect(formatBandAngle(arcmin(20))).toBe('20′')
	expect(formatBandAngle(arcmin(11.31))).toBe('11.3′')
	expect(formatBandAngle(arcmin(59.99))).toBe('1°')
	expect(formatBandAngle(deg(1.87))).toBe('1.9°')
	expect(formatBandRange(arcmin(40), deg(1.33))).toBe('40′–1.3°')
})
