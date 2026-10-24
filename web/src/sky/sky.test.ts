import { expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { changeSkyObserver, clearSkySelection, loadSkyMapData, REALTIME_REFRESH, refreshSkySelection, selectSkyObject, type SkyIo, type SkyState } from './sky'

// Fake API whose responses are released by the test, in any order.
function fakeApi() {
	const pending: { url: string; body: unknown; resolve: (value: unknown, status?: number) => void }[] = []

	const io: SkyIo = {
		time: () => 1_000,
		fetch: (input, init) =>
			new Promise<Response>((resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
				pending.push({ url: input, body: init?.body ? JSON.parse(init.body as string) : undefined, resolve: (value, status = 200) => resolve(Response.json(value, { status })) })
			}),
	}

	const release = async (match: (url: string, body: unknown) => boolean, value: unknown, status?: number) => {
		const index = pending.findIndex((e) => match(e.url, e.body))
		expect(index).toBeGreaterThanOrEqual(0)
		pending.splice(index, 1)[0].resolve(value, status)
		await Bun.sleep(0)
	}

	return { io, pending, release }
}

const position = (ra: number) => ({ time: 1_000, source: 'local', center: 'geocentric', rightAscension: ra, declination: 0, rightAscensionJ2000: ra, declinationJ2000: 0, constellation: 'ORI' })

test('a late response of a previous selection is discarded', async () => {
	const state = proxy<SkyState>({ panel: 'observer' })
	const { io, release } = fakeApi()

	selectSkyObject(state, { ref: { kind: 'catalog', id: 1 }, source: 'map', name: 'A' }, undefined, io)
	expect(state.panel).toBe('inspector')
	selectSkyObject(state, { ref: { kind: 'body', code: '499' }, source: 'search', name: 'Mars', category: 'solarSystem' }, undefined, io)

	await release((url, body) => url === '/api/sky/position' && (body as { target: { kind: string } }).target.kind === 'body', { position: position(2) })
	await release((url) => url === '/api/sky/objects/1', { name: 'Sirius' }).catch(() => undefined)

	expect(state.selection?.name).toBe('Mars')
	expect(state.selection?.position?.rightAscension).toBe(2)
	expect(state.selection?.catalog).toBeUndefined()
	expect(state.selection?.loading).toBe(false)
})

test('catalog details and position of a selection', async () => {
	const state = proxy<SkyState>({ panel: 'inspector' })
	const { io, release } = fakeApi()
	const observer = { latitude: -23.5, longitude: -46.6, elevation: 760 }

	selectSkyObject(state, { ref: { kind: 'catalog', id: 32263 }, source: 'map', name: 'Star 32263' }, observer, io)
	expect(state.selection?.loading).toBe(true)

	await release((url) => url === '/api/sky/objects/32263', { name: 'Sirius', category: 'star' })
	expect(state.selection?.name).toBe('Sirius')
	expect(state.selection?.category).toBe('star')

	await release((url, body) => url === '/api/sky/position' && (body as { observer: unknown }).observer !== undefined, { position: position(1.77), events: { state: 'normal', transit: 5 } })
	expect(state.selection?.events?.transit).toBe(5)
	expect(state.selection?.loading).toBe(false)
})

test('a failed position keeps the catalog data', async () => {
	const state = proxy<SkyState>({ panel: 'inspector' })
	const { io, release } = fakeApi()

	selectSkyObject(state, { ref: { kind: 'catalog', id: 7 }, source: 'search', name: 'X' }, undefined, io)
	await release((url) => url === '/api/sky/objects/7', { name: 'Seven' })
	await release((url) => url === '/api/sky/position', { error: 'Horizons is unavailable (network)' }, 503)

	expect(state.selection?.name).toBe('Seven')
	expect(state.selection?.positionError).toBe('Horizons is unavailable (network)')
	expect(state.selection?.loading).toBe(false)
})

test('changing the observer drops the previous position', async () => {
	const state = proxy<SkyState>({ panel: 'inspector' })
	const { io, release } = fakeApi()

	selectSkyObject(state, { ref: { kind: 'body', code: '10' }, source: 'map', name: 'Sun' }, undefined, io)
	await release((url) => url === '/api/sky/position', { position: position(3) })
	expect(state.selection?.position).toBeDefined()

	void changeSkyObserver(state, { latitude: 0, longitude: 0, elevation: 0 }, io)
	expect(state.selection?.position).toBeUndefined()
	await release((url, body) => url === '/api/sky/position' && (body as { observer: unknown }).observer !== undefined, { position: position(4), events: { state: 'circumpolar' } })
	expect(state.selection?.position?.rightAscension).toBe(4)

	clearSkySelection(state)
	expect(state.selection).toBeUndefined()
})

test('a refresh skips a fresh or loading selection', async () => {
	const state = proxy<SkyState>({ panel: 'inspector' })
	const { io, pending, release } = fakeApi()

	selectSkyObject(state, { ref: { kind: 'body', code: '10' }, source: 'map', name: 'Sun' }, undefined, io)
	await refreshSkySelection(state, undefined, REALTIME_REFRESH, io)
	expect(pending).toHaveLength(1)

	await release((url) => url === '/api/sky/position', { position: position(3) })
	await refreshSkySelection(state, undefined, REALTIME_REFRESH, io)
	expect(pending).toHaveLength(0)
})

test('constellation details', async () => {
	const state = proxy<SkyState>({ panel: 'inspector' })
	const { io, release } = fakeApi()

	selectSkyObject(state, { ref: { kind: 'constellation', code: 'ORI' }, source: 'map', name: 'Orion' }, undefined, io)
	await release((url) => url === '/api/sky/constellations/ORI', { code: 'ORI', abbreviation: 'Ori', name: 'Orion', genitive: 'Orionis', rightAscension: 1.45, declination: 0.05 })
	expect(state.selection?.constellation?.genitive).toBe('Orionis')
})

test('positions are computed for the instant shown', async () => {
	const state = proxy<SkyState>({ panel: 'inspector' })
	const { io, pending, release } = fakeApi()
	let time = 5_000_000
	const clocked: SkyIo = { ...io, time: () => time }

	selectSkyObject(state, { ref: { kind: 'body', code: '301' }, source: 'map', name: 'Moon' }, undefined, clocked)
	expect((pending[0].body as { time: number }).time).toBe(5_000_000)
	await release((url) => url === '/api/sky/position', { position: { ...position(1), time: 5_000_000 }, events: { state: 'normal', rise: 1 } })

	// The same instant is never asked twice, even for a fixed clock refreshed often.
	await refreshSkySelection(state, undefined, { tolerance: 0, mode: 'accurate' }, clocked)
	expect(pending).toHaveLength(0)

	// A fast position of another instant keeps the selection and replaces its events with the same instant's.
	time = 9_000_000
	void refreshSkySelection(state, undefined, { tolerance: 0, mode: 'fast' }, clocked)
	expect(pending[0].body).toMatchObject({ time: 9_000_000, mode: 'fast' })
	await release((url) => url === '/api/sky/position', { position: { ...position(2), time: 9_000_000 }, events: { state: 'normal', rise: 2 } })

	expect(state.selection?.name).toBe('Moon')
	expect(state.selection?.position?.time).toBe(9_000_000)
	expect(state.selection?.events?.rise).toBe(2)

	// The instant of the map's update is asked, whatever the clock reads meanwhile.
	void refreshSkySelection(state, undefined, { tolerance: 0, mode: 'accurate' }, clocked, 12_000_000)
	expect(pending[0].body).toMatchObject({ time: 12_000_000, mode: 'accurate' })
})

test('map data is downloaded again only for an instant more than a year away', async () => {
	const { io, pending, release } = fakeApi()
	let time = Date.UTC(2026, 0, 1)
	const clocked: SkyIo = { ...io, time: () => time }
	const answer = async () => {
		await release((url) => url.startsWith('/api/sky/catalog/stars'), {})
		await release((url) => url.startsWith('/api/sky/catalog/dsos'), {})
		await release((url) => url.startsWith('/api/sky/constellations'), {})
	}

	const first = loadSkyMapData(clocked)
	expect(pending).toHaveLength(3)
	await answer()
	expect((await first).time).toBe(time)

	time = Date.UTC(2026, 11, 1)
	expect(loadSkyMapData(clocked)).toBe(first)
	expect(pending).toHaveLength(0)

	time = Date.UTC(2028, 0, 1)
	const second = loadSkyMapData(clocked)
	expect(pending[0].url).toContain(`time=${time}`)
	await answer()
	expect((await second).time).toBe(time)
})
