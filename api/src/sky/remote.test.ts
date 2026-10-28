import { expect, test } from 'bun:test'
import { fetchUpstream, RemoteCache, type UpstreamFetch, UpstreamUnavailableError } from './remote'

function respond(body: BodyInit, init: ResponseInit = {}): UpstreamFetch {
	return () => Promise.resolve(new Response(body, { headers: { 'Content-Type': 'image/jpeg', 'Last-Modified': 'Wed, 28 Oct 2026 11:40:06 GMT' }, ...init }))
}

test('downloads a body with its last modification', async () => {
	const { bytes, lastModified } = await fetchUpstream(respond(new Uint8Array([1, 2, 3])), 'https://example.org/a.jpg', 'image/jpeg', 1000, 10)
	expect([...bytes]).toEqual([1, 2, 3])
	expect(lastModified).toBe(Date.UTC(2026, 9, 28, 11, 40, 6))
})

test('refuses error statuses, wrong types, large bodies, and network failures', async () => {
	const url = 'https://example.org/a.jpg'
	await expect(fetchUpstream(respond('missing', { status: 404 }), url, 'image/jpeg', 1000, 10)).rejects.toBeInstanceOf(UpstreamUnavailableError)
	await expect(fetchUpstream(respond('<html>', { headers: { 'Content-Type': 'text/html' } }), url, 'image/jpeg', 1000, 10)).rejects.toBeInstanceOf(UpstreamUnavailableError)
	await expect(fetchUpstream(respond(new Uint8Array(11)), url, 'image/jpeg', 1000, 10)).rejects.toBeInstanceOf(UpstreamUnavailableError)
	await expect(fetchUpstream(() => Promise.reject(new TypeError('offline')), url, 'image/jpeg', 1000, 10)).rejects.toBeInstanceOf(UpstreamUnavailableError)
})

test('a slow source times out', async () => {
	const slow: UpstreamFetch = (_, { signal }) =>
		new Promise((_, reject) => {
			signal.addEventListener('abort', () => reject(new Error('aborted')))
		})
	await expect(fetchUpstream(slow, 'https://example.org/a.jpg', 'image/jpeg', 10, 10)).rejects.toThrow('timed out')
})

test('values are fresh for the time to live and shared while loading', async () => {
	let now = 0
	let loads = 0
	const cache = new RemoteCache<number>(1000, () => now)
	const load = () => Promise.resolve(++loads)

	const [a, b] = await Promise.all([cache.get('k', load), cache.get('k', load)])
	expect(a).toEqual({ value: 1, fetchedAt: 0, stale: false })
	expect(b).toEqual(a)
	expect(loads).toBe(1)

	now = 999
	expect((await cache.get('k', load)).value).toBe(1)

	now = 1000
	expect(await cache.get('k', load)).toEqual({ value: 2, fetchedAt: 1000, stale: false })
	expect((await cache.get('other', load)).value).toBe(3)
})

test('a failed download answers the last value as stale, or rejects without one', async () => {
	let now = 0
	let fail = false
	let loads = 0
	const cache = new RemoteCache<number>(1000, () => now)
	const load = () => (++loads, fail ? Promise.reject(new UpstreamUnavailableError('down')) : Promise.resolve(loads))

	await expect(cache.get('empty', () => Promise.reject(new UpstreamUnavailableError('down')))).rejects.toBeInstanceOf(UpstreamUnavailableError)

	await cache.get('k', load)
	fail = true
	now = 5000
	expect(await cache.get('k', load)).toEqual({ value: 1, fetchedAt: 0, stale: true })
	expect(loads).toBe(2)

	// Within a minute of the failure the stale value is answered without downloading again.
	now = 30_000
	expect((await cache.get('k', load)).stale).toBeTrue()
	expect(loads).toBe(2)

	fail = false
	now = 70_000
	expect(await cache.get('k', load)).toEqual({ value: 3, fetchedAt: 70_000, stale: false })
})
