import { expect, test } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AppDatabase } from './database'
import { celestrakUrl, parseCelestrakSourceKey } from './satellites.celestrak'
import { SatelliteStore } from './satellites.store'
import { GP_INTERVAL_MS, MAX_BLOCK_MS, SATCAT_INTERVAL_MS, SatelliteRefreshError, SatelliteSync } from './satellites.sync'

const HOUR = 3_600_000

function gp(noradId: number, name = `OBJECT ${noradId}`) {
	return {
		OBJECT_NAME: name,
		OBJECT_ID: '1998-067A',
		EPOCH: '2023-08-19T12:25:27.896736',
		MEAN_MOTION: 15.4947758,
		ECCENTRICITY: 0.0003559,
		INCLINATION: 51.6415,
		RA_OF_ASC_NODE: 14.7889,
		ARG_OF_PERICENTER: 325.3396,
		MEAN_ANOMALY: 149.4637,
		EPHEMERIS_TYPE: 0,
		NORAD_CAT_ID: noradId,
		ELEMENT_SET_NO: 999,
		BSTAR: 0.00025837,
		MEAN_MOTION_DOT: 0.0001405,
		MEAN_MOTION_DDOT: 0,
	}
}

interface Reply {
	readonly status?: number
	readonly body?: string
	readonly headers?: Record<string, string>
	readonly error?: boolean
}

// CelesTrak replaced by queued replies, recording each request.
function fakeCelestrak(...replies: Reply[]) {
	const requests: { url: string; init: RequestInit }[] = []
	const fetch = (url: string, init: RequestInit) => {
		requests.push({ url, init })
		const reply = replies.shift()
		if (!reply) throw new Error(`unexpected request to ${url}`)
		if (reply.error) return Promise.reject(new TypeError('offline'))
		return Promise.resolve(new Response(reply.body ?? '', { status: reply.status ?? 200, headers: reply.headers }))
	}
	return { fetch, requests, pending: () => replies.length }
}

function setup(replies: Reply[], database = AppDatabase.memory(), start = 1_800_000_000_000) {
	const clock = { now: start }
	const celestrak = fakeCelestrak(...replies)
	const store = new SatelliteStore(database)
	let changes = 0
	const sync = new SatelliteSync(store, () => changes++, { fetch: celestrak.fetch, now: () => clock.now })
	return { clock, celestrak, store, sync, changes: () => changes }
}

async function refused(promise: Promise<unknown>) {
	try {
		await promise
	} catch (error) {
		if (error instanceof SatelliteRefreshError) return error
		throw error
	}

	throw new Error('the download was not refused')
}

const json = (records: unknown[]) => ({ body: JSON.stringify(records), headers: { 'Content-Type': 'application/json' } })

test('only allowlisted queries are made, as JSON from celestrak.org', () => {
	expect(parseCelestrakSourceKey('gp:GROUP:stations')).toEqual({ sourceKey: 'gp:GROUP:STATIONS', provider: 'gp', type: 'GROUP', value: 'STATIONS', large: false })
	expect(parseCelestrakSourceKey('gp:GROUP:STARLINK')?.large).toBeTrue()
	expect(parseCelestrakSourceKey('satcat:CATNR:270001')?.value).toBe('270001')
	for (const key of ['gp:GROUP:EVERYTHING', 'gp:NAME:ISS', 'gp:CATNR:025544', 'gp:CATNR:1234567890', 'supgp:GROUP:STATIONS', 'gp:GROUP:STATIONS:x', 'gp:GROUP:']) {
		expect(parseCelestrakSourceKey(key)).toBeUndefined()
	}
	expect(celestrakUrl(parseCelestrakSourceKey('gp:GROUP:STATIONS')!)).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=STATIONS&FORMAT=JSON')
	expect(celestrakUrl(parseCelestrakSourceKey('satcat:CATNR:25544')!)).toBe('https://celestrak.org/satcat/records.php?CATNR=25544&FORMAT=JSON')
})

test('a download publishes the group, and another inside the GP interval is refused without a request', async () => {
	const { clock, celestrak, store, sync, changes } = setup([json([gp(25544, 'ISS (ZARYA)'), gp(48274), { ...gp(3), ECCENTRICITY: 2 }])])
	sync.identify('1.2.3')

	const result = await sync.refresh('gp:GROUP:stations')
	expect(result).toMatchObject({ records: 2, rejected: 1 })
	expect(result.source).toMatchObject({ sourceKey: 'gp:GROUP:STATIONS', provider: 'gp', query: 'GROUP=STATIONS', lastSuccessAt: clock.now, nextAllowedAt: clock.now + GP_INTERVAL_MS, failures: 0, recordCount: 2, rejectedCount: 1, revision: 1 })
	expect(changes()).toBe(1)
	expect(store.members('gp:GROUP:STATIONS')).toEqual(['25544', '48274'])
	expect(store.elements('25544')?.omm.NORAD_CAT_ID).toBe('25544')
	expect(celestrak.requests[0].url).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=STATIONS&FORMAT=JSON')
	expect(celestrak.requests[0].init.redirect).toBe('manual')
	expect(new Headers(celestrak.requests[0].init.headers).get('User-Agent')).toBe('Nebulosa/1.2.3 (+https://github.com/tiagohm/nebulosa.app)')

	clock.now += GP_INTERVAL_MS - 1
	const cooldown = await refused(sync.refresh('gp:GROUP:STATIONS'))
	expect(cooldown.code).toBe('sourceCooldown')
	expect(cooldown.source?.nextAllowedAt).toBe(result.source.nextAllowedAt)
	expect(celestrak.requests).toHaveLength(1)
	expect((await refused(sync.refresh('gp:GROUP:NOPE'))).code).toBe('notFound')
})

test('concurrent refreshes of a source share one download', async () => {
	const { celestrak, sync } = setup([json([gp(25544)])])
	const [a, b] = await Promise.all([sync.refresh('gp:CATNR:25544'), sync.refresh('gp:CATNR:25544')])
	expect(a).toBe(b)
	expect(celestrak.requests).toHaveLength(1)
})

test('downloads run one at a time for the process', async () => {
	let resolveFirst!: (response: Response) => void
	const order: string[] = []
	const fetch = (url: string) => {
		order.push(url)
		if (order.length === 1)
			return new Promise<Response>((resolve) => {
				resolveFirst = resolve
			})
		return Promise.resolve(new Response(JSON.stringify([gp(5)])))
	}
	const sync = new SatelliteSync(new SatelliteStore(AppDatabase.memory()), () => undefined, { fetch })
	const first = sync.refresh('gp:CATNR:25544')
	const second = sync.refresh('gp:CATNR:5')
	await Bun.sleep(10)
	expect(order).toHaveLength(1)
	resolveFirst(new Response(JSON.stringify([gp(25544)])))
	await Promise.all([first, second])
	expect(order).toHaveLength(2)
})

test('the interval holds across a restart, even after a crash during the request', async () => {
	const file = join(tmpdir(), `satellites-sync-${Bun.randomUUIDv7()}.sqlite`)

	try {
		const database = new AppDatabase(file, false)
		const { sync } = setup([{ error: true }], database)
		// The download fails without an answer; the attempt was recorded before the request.
		expect((await refused(sync.refresh('satcat:GROUP:STATIONS'))).code).toBe('upstreamUnavailable')
		database.close()

		const reopened = setup([], new AppDatabase(file, false), 1_800_000_000_000 + HOUR)
		const blocked = await refused(reopened.sync.refresh('satcat:GROUP:STATIONS'))
		expect(blocked.code).toBe('sourceBlocked')
		expect(blocked.source?.nextAllowedAt).toBe(1_800_000_000_000 + SATCAT_INTERVAL_MS)
		expect(reopened.celestrak.requests).toHaveLength(0)
		reopened.store.database.close()
	} finally {
		for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true })
	}
})

test('a refusal blocks the source with a doubling block, and keeps its data', async () => {
	const { clock, celestrak, store, sync } = setup([json([gp(25544), gp(5)]), { status: 404, body: 'Not found' }, { status: 404 }])
	const success = await sync.refresh('gp:GROUP:VISUAL')

	clock.now = success.source.nextAllowedAt
	const first = await refused(sync.refresh('gp:GROUP:VISUAL'))
	expect(first.code).toBe('upstreamUnavailable')
	expect(first.source).toMatchObject({ failures: 1, lastStatus: 404, lastError: 'Not found', nextAllowedAt: clock.now + GP_INTERVAL_MS, lastSuccessAt: success.source.lastSuccessAt, revision: 1 })
	expect(store.members('gp:GROUP:VISUAL')).toEqual(['5', '25544'])

	// A 404 concerns this query only.
	expect(sync.nextAllowedAt('gp:GROUP:STATIONS')).toBe(0)

	clock.now = first.source!.nextAllowedAt
	const second = await refused(sync.refresh('gp:GROUP:VISUAL'))
	expect(second.source).toMatchObject({ failures: 2, nextAllowedAt: clock.now + 2 * GP_INTERVAL_MS })
	expect(celestrak.pending()).toBe(0)
})

test('a 403, 429, 301, or 5xx blocks every source, at least for its Retry-After', async () => {
	for (const reply of [{ status: 403, body: 'Data is updated once every 2 hours.' }, { status: 301 }, { status: 503 }]) {
		const { clock, celestrak, sync } = setup([reply])
		const error = await refused(sync.refresh('gp:GROUP:STATIONS'))
		expect(error.source?.lastStatus).toBe(reply.status)
		expect(sync.nextAllowedAt('gp:CATNR:25544')).toBe(clock.now + GP_INTERVAL_MS)
		expect((await refused(sync.refresh('satcat:GROUP:GEO'))).code).toBe('sourceBlocked')
		expect(celestrak.requests).toHaveLength(1)
	}

	const { clock, sync } = setup([{ status: 429, headers: { 'Retry-After': `${12 * 3600}` } }])
	await refused(sync.refresh('gp:GROUP:STATIONS'))
	expect(sync.nextAllowedAt('gp:GROUP:GEO')).toBe(clock.now + 12 * HOUR)
})

test('the block never exceeds a day, whatever the failures', async () => {
	const { clock, sync, store } = setup([{ status: 500 }])
	store.saveSource({ sourceKey: 'satcat:GROUP:GEO', provider: 'satcat', query: 'GROUP=GEO', nextAllowedAt: 0, failures: 5, revision: 0 })
	await refused(sync.refresh('satcat:GROUP:GEO'))
	expect(store.source('satcat:GROUP:GEO')?.nextAllowedAt).toBe(clock.now + MAX_BLOCK_MS)
})

test('an unreadable or suspiciously empty answer replaces nothing', async () => {
	const { clock, store, sync } = setup([json([gp(25544)]), { body: '<html>maintenance</html>' }, json([]), { body: 'No GP data found' }])
	await sync.refresh('gp:GROUP:STATIONS')

	clock.now += GP_INTERVAL_MS
	expect((await refused(sync.refresh('gp:GROUP:STATIONS'))).code).toBe('invalidResponse')
	clock.now = store.source('gp:GROUP:STATIONS')!.nextAllowedAt
	expect((await refused(sync.refresh('gp:GROUP:STATIONS'))).code).toBe('invalidResponse')
	expect(store.members('gp:GROUP:STATIONS')).toEqual(['25544'])

	// A single object without GP data is a valid empty answer.
	expect(await sync.refresh('gp:CATNR:99999')).toMatchObject({ records: 0, rejected: 0 })
})

test('SATCAT downloads publish the metadata of the group', async () => {
	const { store, sync } = setup([json([{ OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544, OBJECT_TYPE: 'PAY', OPS_STATUS_CODE: '+', PERIOD: 92.9 }])])
	const result = await sync.refresh('satcat:GROUP:STATIONS')
	expect(result.source.nextAllowedAt - result.source.lastAttemptAt!).toBe(SATCAT_INTERVAL_MS)
	expect(store.object('25544')).toMatchObject({ name: 'ISS (ZARYA)', objectType: 'payload', opsStatus: '+', periodMinutes: 92.9, elementKind: undefined })
})
