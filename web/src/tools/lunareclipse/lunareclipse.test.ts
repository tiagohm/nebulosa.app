import { expect, test } from 'bun:test'
import type { LunarEclipseSummary } from 'api'
import { proxy } from 'valtio'
import type { EclipseIo } from '../eclipse/eclipse'
import {
	equatorCrossings,
	findEclipse,
	findEclipseFrom,
	initialLunarEclipseState,
	isStaleLocal,
	type LunarEclipseState,
	moonUpBounds,
	nextEclipse,
	openLunarEclipseMap,
	phaseAt,
	phaseDurations,
	selectEvent,
	selectMapPlace,
	setViewFraction,
	setViewSettings,
	showLunarEclipse,
	syncPlace,
	visibilityHeadline,
} from './lunareclipse'

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

test('opens on the next eclipse after now, from the active site', async () => {
	const state = newState()
	const { io, release } = fakeApi()
	const home = { name: 'Home', latitude: -23.5, longitude: -46.6, elevation: 760, timeZone: 'America/Sao_Paulo' }

	openLunarEclipseMap(state, home, io)
	expect(state.location).toEqual({ mode: 'active' })
	expect(state.place).toEqual({ longitude: -46.6, latitude: -23.5 })
	expect(state.loading).toBe(true)

	await release((url) => url === `/api/eclipses/lunar?time=${Date.UTC(2026, 0, 1)}&direction=next`, A)
	expect(state.eclipse).toEqual(A)

	await release((url) => url.startsWith(`/api/eclipses/lunar/${A.id}/local?longitude=-46.6&latitude=-23.5&event=MAX`), localOf(A, -46.6))
	await release((url) => url === `/api/eclipses/lunar/${A.id}/map`, mapOf(A))
	expect(state.map?.eclipse).toEqual(A)
	expect(state.local?.eclipseId).toBe(A.id)
	expect(state.loading).toBe(false)

	// Opening again keeps what is shown, and a location chosen.
	state.location = { mode: 'saved', siteId: 'other' }
	const { io: again, requested } = fakeApi()
	openLunarEclipseMap(state, home, again)
	expect(requested).toEqual([])
	expect(state.location).toEqual({ mode: 'saved', siteId: 'other' })
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

test('a linked eclipse replaces the one shown, with its local circumstances, keeping a contact it has', async () => {
	const state = newState()
	Object.assign(state, { eclipse: A, map: mapOf(A), selectedEvent: 'U2', place: { longitude: 10, latitude: 20 } })
	const { io, requested, release } = fakeApi()

	void showLunarEclipse(state, B.id, io)
	expect(requested).toEqual([`/api/eclipses/lunar/${B.id}/map`])
	expect(state.eclipse).toBeUndefined()
	expect(state.map).toBeUndefined()
	expect(state.loading).toBe(true)

	await release((url) => url.endsWith('/map'), mapOf(B))
	expect(state.eclipse).toEqual(B)
	expect(state.map?.eclipse).toEqual(B)
	expect(state.loading).toBe(false)
	expect(state.selectedEvent).toBe('MAX')
	expect(requested.at(-1)).toStartWith(`/api/eclipses/lunar/${B.id}/local?longitude=10&latitude=20&event=MAX`)
})

test('the linked eclipse already shown is not loaded again', () => {
	const state = newState()
	state.eclipse = A
	state.map = mapOf(A)
	const { io, requested } = fakeApi()

	void showLunarEclipse(state, A.id, io)
	expect(requested).toEqual([])
})

test('a linked eclipse supersedes a search in progress, and an unknown id is an error', async () => {
	const state = newState()
	const { io, release } = fakeApi()

	void findEclipse(state, 0, 'next', io)
	void showLunarEclipse(state, '42', io)
	await release((url) => url.startsWith('/api/eclipses/lunar?'), A).catch(() => undefined)
	await release((url) => url === '/api/eclipses/lunar/42/map', { error: 'Lunar eclipse not found', code: 'notFound' }, 404)

	expect(state.eclipse).toBeUndefined()
	expect(state.map).toBeUndefined()
	expect(state.error).toBe('Lunar eclipse not found')
	expect(state.unknownLink).toBe(true)
	expect(state.loading).toBe(false)
})

test('a click on the map asks only for the local circumstances, and a contact only redraws them', async () => {
	const state = newState()
	state.eclipse = A
	state.map = mapOf(A)
	const { io, requested, release } = fakeApi()

	void selectMapPlace(state, { longitude: 10, latitude: 20 }, io)
	expect(state.location).toEqual({ mode: 'manual', latitude: 20, longitude: 10, elevation: 0, timeZone: 'UTC' })
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
	state.place = { longitude: 10, latitude: 80 }
	state.visibleOnly = true
	const { io, release } = fakeApi()

	void nextEclipse(state, io)
	await release((url) => url === `/api/eclipses/lunar?time=${A.maximum}&direction=next&longitude=10&latitude=80`, { error: 'No lunar eclipse visible here within 24 eclipses', code: 'notFound' }, 404)

	expect(state.eclipse).toEqual(A)
	expect(state.notice).toBe('No lunar eclipse visible here within 24 eclipses')
	expect(state.error).toBeUndefined()
	expect(state.loading).toBe(false)
})

test('the Local View draws a fraction of the eclipse until a contact is chosen, and keeps it for another place', () => {
	const state = newState()
	state.eclipse = A
	const { io, requested } = fakeApi()

	void syncPlace(state, { latitude: 0, longitude: 10, elevation: 0 }, io)
	void setViewFraction(state, 0.25, io)
	expect(requested.at(-1)).toContain('&event=0.25&')
	void setViewFraction(state, 0.25, io)
	expect(requested.length).toBe(2)

	void selectMapPlace(state, { longitude: 30, latitude: 0 }, io)
	expect(requested.at(-1)).toContain('longitude=30&latitude=0&event=0.25&')

	void selectEvent(state, state.selectedEvent, io)
	expect(state.viewFraction).toBeUndefined()
	expect(requested.at(-1)).toContain(`&event=${state.selectedEvent}&`)
	void selectEvent(state, 'U1', io)
	expect(requested.at(-1)).toContain('&event=U1&')
})

test('a new place keeps the circumstances shown until its own arrive, and drops them if those fail', async () => {
	const state = newState()
	state.eclipse = A
	const { io, release } = fakeApi()

	void syncPlace(state, { latitude: 0, longitude: 10, elevation: 0 }, io)
	await release((url) => url.includes('longitude=10&latitude=0'), localOf(A, 10))
	expect(isStaleLocal(state.local, state.place)).toBe(false)

	void selectMapPlace(state, { longitude: 30, latitude: 0 }, io)
	expect(state.local?.location.longitude).toBe(10)
	expect(isStaleLocal(state.local, state.place)).toBe(true)
	await release((url) => url.includes('longitude=30&latitude=0'), localOf(A, 30))
	expect(state.local?.location.longitude).toBe(30)
	expect(isStaleLocal(state.local, state.place)).toBe(false)

	void selectMapPlace(state, { longitude: 50, latitude: 0 }, io)
	await release((url) => url.includes('longitude=50&latitude=0'), { error: 'The circumstances failed', code: 'computationFailed' }, 500)
	expect(state.local).toBeUndefined()
	expect(state.localError).toBe('The circumstances failed')
})

test('a new elevation, name, or zone of the same place, or a zone of the times, asks for nothing; a new place asks again', async () => {
	const state = newState()
	state.eclipse = A
	state.map = mapOf(A)
	const { io, requested, release } = fakeApi()

	void syncPlace(state, { latitude: 20, longitude: 10, elevation: 0 }, io)
	await release((url) => url.includes('longitude=10&latitude=20'), localOf(A, 10))
	expect(requested.length).toBe(1)

	state.location = { mode: 'manual', latitude: 20, longitude: 10, elevation: 500, timeZone: 'Asia/Tokyo' }
	void syncPlace(state, { latitude: 20, longitude: 10, elevation: 500 }, io)
	state.zone = { mode: 'zone', zone: 'Europe/Berlin' }
	expect(requested.length).toBe(1)
	expect(state.local?.location.longitude).toBe(10)

	// A click keeps the zone of the coordinates entered.
	void selectMapPlace(state, { longitude: 30, latitude: 20 }, io)
	expect(state.location).toEqual({ mode: 'manual', latitude: 20, longitude: 30, elevation: 0, timeZone: 'Asia/Tokyo' })
	expect(state.local?.location.longitude).toBe(10)
	expect(requested.at(-1)).toStartWith(`/api/eclipses/lunar/${A.id}/local?longitude=30&latitude=20`)

	// A location that gives no place, such as a deleted site, drops the request and the circumstances.
	void syncPlace(state, undefined, io)
	expect(state.place).toBeUndefined()
	expect(state.local).toBeUndefined()
	expect(state.localLoading).toBe(false)
	expect(requested.length).toBe(2)
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

test('names the phase of an instant from the contacts', () => {
	const at = (kind: string) => A.contacts.find((contact) => contact.kind === kind)!.time
	expect(phaseAt(A, at('P1') + 1)).toBe('penumbral')
	expect(phaseAt(A, at('U1') + 1)).toBe('partial')
	expect(phaseAt(A, at('MAX'))).toBe('total')
	expect(phaseAt(A, at('U3') + 1)).toBe('partial')
	expect(phaseAt(A, at('P4') - 1)).toBe('penumbral')
	expect(phaseAt(B, B.maximum)).toBe('partial')
	expect(phaseAt(summary(0, 'PENUMBRAL'), 0)).toBe('penumbral')
})

test('a penumbral eclipse seen in part never reads as its penumbral phase only', () => {
	const part = { kind: 'penumbralOnlyVisible', text: 'Only the penumbral phase visible', hasObservableEclipse: true } as const
	expect(visibilityHeadline('PENUMBRAL', part)).toBe('Part of the eclipse visible')
	expect(visibilityHeadline('TOTAL', part)).toBe('Only the penumbral phase visible')
	expect(visibilityHeadline('PENUMBRAL', { kind: 'completelyVisible', text: 'Entire eclipse visible', hasObservableEclipse: true })).toBe('Entire eclipse visible')
})

test('frames the hemisphere of the Moon at greatest eclipse, widened to the place on its nearer side', () => {
	const map = { ...mapOf(A), events: [{ kind: 'MAX' as const, time: A.maximum, sublunar: { longitude: 170, latitude: -5 } }] }
	expect(moonUpBounds(map)).toEqual({ west: 80, east: 260, south: -90, north: 90 })
	// Inside the hemisphere, across the antimeridian: nothing changes.
	expect(moonUpBounds(map, { longitude: -120, latitude: 10 })).toEqual({ west: 80, east: 260, south: -90, north: 90 })
	// Just east of it: the eastern edge moves; just west of it: the western one.
	expect(moonUpBounds(map, { longitude: -90, latitude: 0 })).toEqual({ west: 80, east: 270, south: -90, north: 90 })
	expect(moonUpBounds(map, { longitude: 60, latitude: 0 })).toEqual({ west: 60, east: 260, south: -90, north: 90 })
	expect(moonUpBounds(mapOf(A))).toBeUndefined()
})

test('finds where a line of the map crosses the equator, once per crossing', () => {
	// A circle around (0°, 0°) of 30° on the degree plane: x = longitude + 180, y = 90 − latitude.
	expect(equatorCrossings('M180 60L210 90L180 120L150 90L180 60')).toEqual([30, -30])
	// Split at the antimeridian: a jump between pieces (M) is no crossing; the one at two thirds of 350 → 360 is.
	const split = equatorCrossings('M350 80L360 95M0 95L10 100')
	expect(split).toHaveLength(1)
	expect(split[0]).toBeCloseTo(176.667, 3)
	expect(equatorCrossings('M10 10L20 20')).toEqual([])
})

test('durations of the phases come from the contacts', () => {
	expect(phaseDurations(A)).toEqual({ penumbral: 6 * 1800, partial: 4 * 1800, total: 2 * 1800 })
	expect(phaseDurations(summary(0, 'PENUMBRAL'))).toEqual({ penumbral: 2 * 1800, partial: undefined, total: undefined })
})
