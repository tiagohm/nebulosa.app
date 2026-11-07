import { describe, expect, test } from 'bun:test'
import type { JupiterEvent, JupiterGrsResponse, JupiterTrack, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { skyClock } from '../../sky/clock'
import type { PlannerIo } from '../planetary/planetary'
import { createJupiterPlannerState, handleJupiterGrsEvent, interpolateTrack, type JupiterGrsState, keepTheirGrs, listedEvents, loadEvents, loadState, play, saveJupiterGrs, saveMineGrs, selectEvent } from './jupiter'

const HOUR = 3_600_000
const DAY = 24 * HOUR

function json(body: unknown, status: number = 200) {
	return new Response(JSON.stringify(body), { status })
}

// A fake IO answering each request with the next queued responder, recording the requests.
function fakeIo(...responders: ((url: string, init?: RequestInit) => Promise<Response> | Response)[]) {
	const requests: { url: string; body?: unknown; method?: string }[] = []
	const io: PlannerIo = {
		fetch: (url, init) => {
			requests.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined })
			const next = responders.shift()
			return Promise.resolve(next ? next(url, init) : json({}))
		},
		time: () => Date.UTC(2026, 11, 1, 22),
	}
	return { io, requests }
}

// A promise resolved from outside.
function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

function event(id: string, kind: JupiterEvent['kind'], maximum: number, moons: JupiterEvent['moons'] = ['io']): JupiterEvent {
	return { id, kind, moons, start: maximum - HOUR, maximum, end: maximum + HOUR, contacts: {}, startsBeforeRange: false, endsAfterRange: false, grazing: false, overlaps: [], visibility: { status: 'unknownNoSite', windows: [], longestMs: 0, reasons: [] } }
}

function grs(revision: number, longitude: number = 1): JupiterGrsResponse {
	return { model: { longitude, referenceTime: 0, drift: 0 }, revision, status: { quality: 'current', revision, referenceAgeDays: 1 } }
}

describe('requests', () => {
	test('a superseded view never replaces a newer one', async () => {
		const state = proxy(createJupiterPlannerState())
		const first = deferred<Response>()
		const { io } = fakeIo(
			() => first.promise,
			() => json({ time: 2 }),
		)

		state.time = 1
		const older = loadState(state, io)
		state.time = 2
		const newer = loadState(state, io)
		await newer
		first.resolve(json({ time: 1 }))
		await older

		expect(state.state?.time).toBe(2)
	})

	test('events are asked for whole, with the site, and a 503 is the kernels refusing', async () => {
		const state = proxy(createJupiterPlannerState())
		const { io, requests } = fakeIo(() => json({ error: 'The SPICE kernels cannot give the Jovian states (noKernel)', code: 'missingDependency' }, 503))
		const site = { name: 'São Paulo', latitude: -23.55, longitude: -46.633, elevation: 760, timeZone: 'America/Sao_Paulo' }
		await loadEvents(state, { start: 0, end: DAY }, site, io)

		expect(requests[0]).toMatchObject({ url: '/api/jupiter/events', method: 'POST', body: { start: 0, end: DAY, site } })
		expect(requests[0].body).not.toHaveProperty('kinds')
		expect(state.kernelsRefused).toBeTrue()
		expect(state.eventsError).toContain('SPICE kernels')
		expect(state.eventsLoading).toBeFalse()
	})
})

describe('clock', () => {
	test('selecting an event moves only the tool clock to its maximum', () => {
		const state = proxy(createJupiterPlannerState())
		state.playing = true
		const sky = { ...skyClock }
		selectEvent(state, event('a', 'satelliteTransit', 12345))
		expect(state.selected).toBe('a')
		expect(state.time).toBe(12345)
		expect(state.playing).toBeFalse()
		expect({ ...skyClock }).toEqual(sky)
	})

	test('playing advances the clock at its rate and asks for the exact view at intervals', async () => {
		const state = proxy(createJupiterPlannerState())
		state.time = 0
		state.rate = 600
		state.playing = true
		const frames: ((now: number) => void)[] = []
		const { io, requests } = fakeIo()
		const stop = play(
			state,
			false,
			io,
			(run) => frames.push(run),
			() => undefined,
		)

		frames.shift()!(1000)
		frames.shift()!(2000)
		expect(state.time).toBe(600_000)
		frames.shift()!(2500)
		expect(state.time).toBe(900_000)
		expect(requests.filter((e) => e.url === '/api/jupiter/state')).toHaveLength(2)

		state.playing = false
		frames.shift()!(3000)
		expect(frames).toHaveLength(0)
		stop()
		await Bun.sleep(0)
	})

	test('with reduced motion the clock jumps once a second', () => {
		const state = proxy(createJupiterPlannerState())
		state.time = 0
		state.rate = 60
		state.playing = true
		const frames: ((now: number) => void)[] = []
		play(
			state,
			true,
			fakeIo().io,
			(run) => frames.push(run),
			() => undefined,
		)
		frames.shift()!(0)
		frames.shift()!(400)
		expect(state.time).toBe(0)
		frames.shift()!(1000)
		expect(state.time).toBe(60_000)
		state.playing = false
	})
})

describe('helpers', () => {
	test('tracks are interpolated linearly for display, and not outside them', () => {
		const series = (values: number[]) => ({ east: values, north: values.map((v) => -v), depth: values, disk: values.map(() => 'clear' as const), eclipse: values.map(() => 'none' as const) })
		const track: Pick<JupiterTrack, 'times' | 'moons'> = { times: [0, 60_000, 120_000], moons: { io: series([0, 2, 4]), europa: series([1, 1, 1]), ganymede: series([0, 0, 0]), callisto: series([5, 3, 1]) } }
		const at = interpolateTrack(track, 90_000)!
		expect(at.io).toEqual({ east: 3, north: -3, depth: 3 })
		expect(at.callisto.east).toBe(2)
		expect(interpolateTrack(track, 120_001)).toBeUndefined()
		expect(interpolateTrack(undefined, 0)).toBeUndefined()
	})

	test('listing filters by kind and by moon, keeping Great Red Spot transits', () => {
		const events = [event('a', 'satelliteTransit', 1), event('b', 'mutualEclipse', 2, ['europa', 'ganymede']), event('c', 'grsTransit', 3, [])]
		expect(listedEvents(events, ['satelliteTransit', 'mutualEclipse', 'grsTransit'], ['ganymede']).map((e) => e.id)).toEqual(['b', 'c'])
		expect(listedEvents(events, ['satelliteTransit'], ['io']).map((e) => e.id)).toEqual(['a'])
	})
})

describe('Great Red Spot model', () => {
	test('a refused save keeps the model and saves it over the other tab when asked', async () => {
		const state = proxy<JupiterGrsState>({ grs: grs(1), saving: false })
		const model = { longitude: 2, referenceTime: 0, drift: 0 }
		const { io, requests } = fakeIo(
			() => json({ error: 'changed', code: 'conflict', grs: grs(2, 3) }, 409),
			() => json(grs(3, 2)),
		)

		await saveJupiterGrs(state, model, io)
		expect(requests[0].body).toEqual({ model, revision: 1 })
		expect(state.conflict?.revision).toBe(2)
		expect(state.pending).toEqual(model)

		await saveMineGrs(state, io)
		expect(requests[1].body).toEqual({ model, revision: 2 })
		expect(state.grs?.revision).toBe(3)
		expect(state.conflict).toBeUndefined()
	})

	test('keeping theirs drops the refused save', () => {
		const state = proxy<JupiterGrsState>({ grs: grs(1), saving: false, conflict: grs(2, 3), pending: { longitude: 2, referenceTime: 0, drift: 0 } })
		keepTheirGrs(state)
		expect(state.grs?.revision).toBe(2)
		expect(state.pending).toBeUndefined()
	})

	test('only a newer revision of an event reads the model again', async () => {
		const state = proxy<JupiterGrsState>({ grs: grs(2), saving: false })
		const { io, requests } = fakeIo(() => json(grs(3)))
		const updated = (revision: number) => ({ type: 'jupiter:grsUpdated', grs: { revision } }) as ServerEvent
		handleJupiterGrsEvent(state, updated(2), io)
		expect(requests).toHaveLength(0)
		handleJupiterGrsEvent(state, updated(3), io)
		await Bun.sleep(0)
		expect(requests[0].url).toBe('/api/jupiter/grs')
		expect(state.grs?.revision).toBe(3)
	})
})
