import { expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { changeSkyObserver, clearSkySelection, selectSkyObject, type SkyIo, type SkyState } from './sky'

// Fake API whose responses are released by the test, in any order.
function fakeApi() {
	const pending: { url: string; body: unknown; resolve: (value: unknown, status?: number) => void }[] = []

	const io: SkyIo = {
		now: () => 1_000,
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
