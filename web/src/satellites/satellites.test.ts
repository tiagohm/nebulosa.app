import { expect, test } from 'bun:test'
import type { SatelliteSourcesSnapshot } from 'api'
import { proxy } from 'valtio'
import { downloadSatelliteSource, handleSatelliteEvent, refreshSatelliteCatalog, type SatelliteCatalogState } from './satellites'

function snapshot(revision: number, members = 0): SatelliteSourcesSnapshot {
	return { revision, groups: [{ group: 'STATIONS', label: 'Space stations', large: false, members, gpAllowedAt: 0, satcatAllowedAt: 0 }], sources: [], imported: 0, objects: members }
}

function state() {
	return proxy<SatelliteCatalogState>({ revision: 0, downloading: {}, errors: {} })
}

// A fetch that answers each request with the next queued response once released, in any order.
function deferredFetch() {
	const pending: { url: string; init?: RequestInit; resolve: (response: Response) => void }[] = []
	const request = (url: string, init?: RequestInit) =>
		new Promise<Response>((resolve) => {
			pending.push({ url, init, resolve })
		})
	return { request: request as unknown as typeof fetch, pending }
}

test('an older snapshot never replaces a newer one', async () => {
	const catalog = state()
	const { request, pending } = deferredFetch()
	const first = refreshSatelliteCatalog(catalog, request)
	const second = refreshSatelliteCatalog(catalog, request)
	pending[1].resolve(Response.json(snapshot(2, 20)))
	await second
	pending[0].resolve(Response.json(snapshot(1, 0)))
	await first
	expect(catalog.snapshot?.groups[0].members).toBe(20)
})

test('a change of the catalog sets its revision and reads the sources again', async () => {
	const catalog = state()
	const { request, pending } = deferredFetch()
	handleSatelliteEvent(catalog, { type: 'satellites:changed', revision: 3 }, request)
	handleSatelliteEvent(catalog, { type: 'operation:updated' } as never, request)
	expect(catalog.revision).toBe(3)
	expect(pending.map((entry) => entry.url)).toEqual(['/api/satellites/sources'])
	pending[0].resolve(Response.json(snapshot(3, 2)))
	await Bun.sleep(0)
	expect(catalog.snapshot?.objects).toBe(2)
})

test('a download applies the snapshot it answers, and a refusal keeps the server reason', async () => {
	const catalog = state()
	const ok = (url: string) => Promise.resolve(url.endsWith('/refresh') ? Response.json({ results: [], snapshot: snapshot(4, 20) }) : Response.json(snapshot(4, 20)))
	expect(await downloadSatelliteSource(catalog, 'gp:GROUP:STATIONS', ok as unknown as typeof fetch)).toBeTrue()
	expect(catalog).toMatchObject({ revision: 4, downloading: {}, errors: {}, snapshot: { objects: 20 } })

	const urls: string[] = []
	const refused = (url: string) => {
		urls.push(url)
		return Promise.resolve(url.endsWith('/refresh') ? Response.json({ error: 'downloaded at 10:00; CelesTrak updates it every 2 hours', code: 'sourceCooldown' }, { status: 409 }) : Response.json(snapshot(4, 20)))
	}
	expect(await downloadSatelliteSource(catalog, 'gp:GROUP:STATIONS', refused as unknown as typeof fetch)).toBeFalse()
	expect(catalog.errors['gp:GROUP:STATIONS']).toBe('downloaded at 10:00; CelesTrak updates it every 2 hours')
	expect(urls).toEqual(['/api/satellites/sources/gp%3AGROUP%3ASTATIONS/refresh', '/api/satellites/sources'])

	const offline = () => Promise.reject(new TypeError('offline'))
	expect(await downloadSatelliteSource(catalog, 'gp:GROUP:STATIONS', offline as unknown as typeof fetch)).toBeFalse()
	expect(catalog.errors['gp:GROUP:STATIONS']).toBe('The server could not be reached')
	expect(catalog.downloading).toEqual({})
})
