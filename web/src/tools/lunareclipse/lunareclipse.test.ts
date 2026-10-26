import { expect, test } from 'bun:test'
import type { LunarEclipseSummary } from 'api'
import { proxy } from 'valtio'
import type { EclipseIo } from '../eclipse/eclipse'
import { findEclipse, findEclipseFrom, initialLunarEclipseState, type LunarEclipseState, nextEclipse, openLunarEclipseMap, phaseDurations, selectEvent, selectPlace, setViewSettings } from './lunareclipse'

// Fake API whose responses are released by the test, in any order.
function fakeApi() {
	const pending: { url: string; resolve: (value: unknown, status?: number) => void }[] = []
	const requested: string[] = []

	const io: EclipseIo = {
		time: () => Date.UTC(2026, 0, 1),
		fetch: (input, init) =>
			new Promise<Response>((resolve, reject) => {
				requested.push(input)
				init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
				pending.push({ url: input, resolve: (value, status = 200) => resolve(Response.json(value, { status })) })
			}),
	}

	const release = async (match: (url: string) => boolean, value: unknown, status?: number) => {
		const index = pending.findIndex((e) => match(e.url))
		expect(index).toBeGreaterThanOrEqual(0)
		pending.splice(index, 1)[0].resolve(value, status)
		await Bun.sleep(0)
	}

	return { io, pending, requested, release }
}

function summary(maximum: number, type: LunarEclipseSummary['type'] = 'TOTAL'): LunarEclipseSummary {
	const kinds = type === 'TOTAL' ? (['P1', 'U1', 'U2', 'MAX', 'U3', 'U4', 'P4'] as const) : type === 'PARTIAL' ? (['P1', 'U1', 'MAX', 'U4', 'P4'] as const) : (['P1', 'MAX', 'P4'] as const)
	const contacts = kinds.map((kind, i) => ({ kind, time: maximum + (i - kinds.indexOf('MAX')) * 1800_000 }))
	return { id: `${maximum}`, type, maximum, magnitude: 1.2, lunation: 1, contacts }
}

function mapOf(eclipse: LunarEclipseSummary) {
	return { eclipse, events: [], lines: {}, fills: {} }
}

function localOf(eclipse: LunarEclipseSummary, longitude: number) {
	return { eclipseId: eclipse.id, location: { longitude, latitude: 0 }, visibility: { kind: 'completelyVisible', text: 'Entire eclipse visible', hasObservableEclipse: true }, details: {}, events: [], view: { width: 300, height: 300, shapes: [] } }
}

const A = summary(Date.UTC(2026, 2, 3, 11, 33))
const B = summary(Date.UTC(2026, 7, 28, 4, 12), 'PARTIAL')

function newState(): LunarEclipseState {
	return proxy<LunarEclipseState>(initialLunarEclipseState())
}

test('opens on the next eclipse after now, with the Sky observer as the place', async () => {
	const state = newState()
	const { io, release } = fakeApi()

	openLunarEclipseMap(state, { name: 'Home', latitude: -23.5, longitude: -46.6, elevation: 760, timeZone: 'America/Sao_Paulo' }, io)
	expect(state.place).toEqual({ source: 'observer', longitude: -46.6, latitude: -23.5, name: 'Home', timeZone: 'America/Sao_Paulo' })
	expect(state.loading).toBe(true)

	await release((url) => url === `/api/eclipses/lunar?time=${Date.UTC(2026, 0, 1)}&direction=next`, A)
	expect(state.eclipse).toEqual(A)

	await release((url) => url.startsWith(`/api/eclipses/lunar/${A.id}/local?longitude=-46.6&latitude=-23.5&event=MAX`), localOf(A, -46.6))
	await release((url) => url === `/api/eclipses/lunar/${A.id}/map`, mapOf(A))
	expect(state.map?.eclipse).toEqual(A)
	expect(state.local?.eclipseId).toBe(A.id)
	expect(state.loading).toBe(false)

	// Opening again keeps what is shown.
	const { io: again, requested } = fakeApi()
	openLunarEclipseMap(state, undefined, again)
	expect(requested).toEqual([])
})

test('a late answer of a superseded search is discarded', async () => {
	const state = newState()
	const { io, release } = fakeApi()

	void findEclipse(state, 0, 'next', io)
	void findEclipseFrom(state, '2026-08-01', io)

	await release((url) => url === `/api/eclipses/lunar?time=${Date.UTC(2026, 7, 1) - 1}&direction=next`, B)
	await release((url) => url === '/api/eclipses/lunar?time=0&direction=next', A).catch(() => undefined)
	await release((url) => url === `/api/eclipses/lunar/${B.id}/map`, mapOf(B))

	expect(state.eclipse).toEqual(B)
	expect(state.map?.eclipse).toEqual(B)
})

test('steps from the eclipse shown and keeps a contact it has, falling back to MAX otherwise', async () => {
	const state = newState()
	Object.assign(state, { eclipse: A, selectedEvent: 'U2' })
	const { io, release } = fakeApi()

	void nextEclipse(state, io)
	await release((url) => url === `/api/eclipses/lunar?time=${A.maximum}&direction=next`, B)
	expect(state.selectedEvent).toBe('MAX')
})

test('a click on the map asks only for the local circumstances, and a contact only redraws them', async () => {
	const state = newState()
	state.eclipse = A
	state.map = mapOf(A)
	const { io, requested, release } = fakeApi()

	void selectPlace(state, { source: 'map', longitude: 10, latitude: 20 }, io)
	expect(requested).toEqual([`/api/eclipses/lunar/${A.id}/local?longitude=10&latitude=20&event=MAX&orientation=zenith&handedness=eastRight&ghosts=true`])

	void selectEvent(state, 'U1', io)
	void setViewSettings(state, { orientation: 'north', ghosts: false }, io)
	expect(requested.at(-1)).toBe(`/api/eclipses/lunar/${A.id}/local?longitude=10&latitude=20&event=U1&orientation=north&handedness=eastRight&ghosts=false`)
	expect(requested.every((url) => url.includes('/local?'))).toBe(true)

	await release((url) => url.includes('ghosts=false'), localOf(A, 10))
	await release((url) => url.includes('event=MAX'), localOf(A, 99)).catch(() => undefined)
	expect(state.local?.location.longitude).toBe(10)
	expect(state.localLoading).toBe(false)
})

test('a visible-only search that finds nothing keeps the eclipse shown and says why', async () => {
	const state = newState()
	state.eclipse = A
	state.place = { source: 'manual', longitude: 10, latitude: 80 }
	state.visibleOnly = true
	const { io, release } = fakeApi()

	void nextEclipse(state, io)
	await release((url) => url === `/api/eclipses/lunar?time=${A.maximum}&direction=next&longitude=10&latitude=80`, { error: 'No lunar eclipse visible here within 24 eclipses', code: 'notFound' }, 404)

	expect(state.eclipse).toEqual(A)
	expect(state.notice).toBe('No lunar eclipse visible here within 24 eclipses')
	expect(state.error).toBeUndefined()
	expect(state.loading).toBe(false)
})

test('a failed map is reported as an error', async () => {
	const state = newState()
	const { io, release } = fakeApi()

	void findEclipse(state, 0, 'next', io)
	await release((url) => url.startsWith('/api/eclipses/lunar?'), A)
	await release((url) => url.endsWith('/map'), { error: 'Lunar eclipse not found', code: 'notFound' }, 404)

	expect(state.error).toBe('Lunar eclipse not found')
	expect(state.notice).toBeUndefined()
	expect(state.loading).toBe(false)
})

test('durations of the phases come from the contacts', () => {
	expect(phaseDurations(A)).toEqual({ penumbral: 6 * 1800, partial: 4 * 1800, total: 2 * 1800 })
	expect(phaseDurations(summary(0, 'PENUMBRAL'))).toEqual({ penumbral: 2 * 1800, partial: undefined, total: undefined })
})
