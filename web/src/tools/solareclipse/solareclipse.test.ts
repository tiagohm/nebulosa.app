import { expect, test } from 'bun:test'
import type { SolarEclipseSummary } from 'api'
import { proxy } from 'valtio'
import type { EclipseIo } from '../eclipse/eclipse'
import { contactName, findEclipse, findEclipseFrom, initialSolarEclipseState, limitName, nextEclipse, openSolarEclipseMap, selectEvent, selectPlace, setLayer, setViewSettings, type SolarEclipseState } from './solareclipse'

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

function summary(maximum: number, type: SolarEclipseSummary['type'] = 'total'): SolarEclipseSummary {
	return { id: `${maximum}`, type, maximum, magnitude: 1.05, gamma: 0.34, central: type !== 'partial', lunation: 1 }
}

function mapOf(eclipse: SolarEclipseSummary) {
	return { eclipse, deltaT: 69, points: {}, paths: {} }
}

function localOf(eclipse: SolarEclipseSummary, longitude: number) {
	return {
		eclipseId: eclipse.id,
		location: { longitude, latitude: 0 },
		visibility: { kind: 'partialOnlyVisible', text: 'Only the partial phase is visible', hasGeometricEclipse: true, hasObservableEclipse: true, hasCentralPhase: false, centralPhaseKind: 'none', sunMotion: 'none', completeness: { partialContactsComplete: true, centralContactsComplete: true } },
		details: {},
		events: [],
		view: { width: 450, height: 160, shapes: [] },
	}
}

const A = summary(Date.UTC(2026, 7, 12, 17, 46))
const B = summary(Date.UTC(2027, 1, 6, 16, 0), 'annular')

function newState(): SolarEclipseState {
	return proxy<SolarEclipseState>(initialSolarEclipseState())
}

test('opens on the next eclipse after now, with the Sky observer as the place', async () => {
	const state = newState()
	const { io, release } = fakeApi()

	openSolarEclipseMap(state, { name: 'Home', latitude: -23.5, longitude: -46.6, elevation: 760, timeZone: 'America/Sao_Paulo' }, io)
	expect(state.place).toEqual({ source: 'observer', longitude: -46.6, latitude: -23.5, name: 'Home', timeZone: 'America/Sao_Paulo' })
	expect(state.loading).toBe(true)

	await release((url) => url === `/api/eclipses/solar?time=${Date.UTC(2026, 0, 1)}&direction=next`, A)
	expect(state.eclipse).toEqual(A)

	await release((url) => url.startsWith(`/api/eclipses/solar/${A.id}/local?longitude=-46.6&latitude=-23.5&event=MAX`), localOf(A, -46.6))
	await release((url) => url === `/api/eclipses/solar/${A.id}/map`, mapOf(A))
	expect(state.map?.eclipse).toEqual(A)
	expect(state.local?.eclipseId).toBe(A.id)
	expect(state.loading).toBe(false)

	// Opening again keeps what is shown.
	const { io: again, requested } = fakeApi()
	openSolarEclipseMap(state, undefined, again)
	expect(requested).toEqual([])
})

test('a late answer of a superseded search is discarded', async () => {
	const state = newState()
	const { io, release } = fakeApi()

	void findEclipse(state, 0, 'next', io)
	void findEclipseFrom(state, '2027-01-01', io)

	await release((url) => url === `/api/eclipses/solar?time=${Date.UTC(2027, 0, 1) - 1}&direction=next`, B)
	await release((url) => url === '/api/eclipses/solar?time=0&direction=next', A).catch(() => undefined)
	await release((url) => url === `/api/eclipses/solar/${B.id}/map`, mapOf(B))

	expect(state.eclipse).toEqual(B)
	expect(state.map?.eclipse).toEqual(B)
})

test('a click on the map asks only for the local circumstances, and a contact or layer never for the map', async () => {
	const state = newState()
	state.eclipse = A
	state.map = mapOf(A)
	const { io, requested, release } = fakeApi()

	void selectPlace(state, { source: 'map', longitude: 10, latitude: 20 }, io)
	expect(requested).toEqual([`/api/eclipses/solar/${A.id}/local?longitude=10&latitude=20&event=MAX&orientation=zenith&handedness=eastRight&ghosts=true`])

	void selectEvent(state, 'C2', io)
	void setViewSettings(state, { orientation: 'north', ghosts: false }, io)
	setLayer(state, 'riseSet', true)
	setLayer(state, 'centralLine', false)
	expect(requested.at(-1)).toBe(`/api/eclipses/solar/${A.id}/local?longitude=10&latitude=20&event=C2&orientation=north&handedness=eastRight&ghosts=false`)
	expect(requested.length).toBe(3)
	expect(requested.every((url) => url.includes('/local?'))).toBe(true)
	expect(state.layers).toEqual({ centralLine: false, umbralLimits: true, penumbralLimits: true, riseSet: true, points: true })

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
	await release((url) => url === `/api/eclipses/solar?time=${A.maximum}&direction=next&longitude=10&latitude=80`, { error: 'No solar eclipse visible here within 48 eclipses', code: 'notFound' }, 404)

	expect(state.eclipse).toEqual(A)
	expect(state.notice).toBe('No solar eclipse visible here within 48 eclipses')
	expect(state.error).toBeUndefined()
	expect(state.loading).toBe(false)
})

test('a failed map is reported as an error', async () => {
	const state = newState()
	const { io, release } = fakeApi()

	void findEclipse(state, 0, 'next', io)
	await release((url) => url.startsWith('/api/eclipses/solar?'), A)
	await release((url) => url.endsWith('/map'), { error: 'The solar eclipse map did not finish within 30 s', code: 'computationFailed' }, 500)

	expect(state.error).toBe('The solar eclipse map did not finish within 30 s')
	expect(state.notice).toBeUndefined()
	expect(state.loading).toBe(false)
})

test('names local contacts by the central phase of the place, and limits by the eclipse type', () => {
	expect(contactName('C1', 'none')).toBe('Partial eclipse begins')
	expect(contactName('C2', 'total')).toBe('Total eclipse begins')
	expect(contactName('C3', 'annular')).toBe('Annular eclipse ends')
	expect(contactName('C4', 'annular')).toBe('Partial eclipse ends')
	expect(limitName('total')).toBe('Limits of totality')
	expect(limitName('annular')).toBe('Limits of annularity')
	expect(limitName('hybrid')).toBe('Limits of the central path')
})
