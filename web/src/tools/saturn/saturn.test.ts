import { describe, expect, test } from 'bun:test'
import type { SaturnElongations, SaturnRingTimeline, SaturnSignature } from 'api'
import { proxy } from 'valtio'
import { skyClock } from '../../sky/clock'
import type { PlannerIo } from '../planetary/planetary'
import { createSaturnPlannerState, describeSource, historyRange, listedEvents, listedId, loadState, selectEvent } from './saturn'
import { annulusPath, farHalfSign } from './SaturnViewer'

const DAY = 86_400_000

function json(body: unknown, status: number = 200) {
	return new Response(JSON.stringify(body), { status })
}

// A fake IO answering each request with the next queued responder, recording the requests.
function fakeIo(...responders: ((url: string) => Promise<Response> | Response)[]) {
	const requests: string[] = []
	const io: PlannerIo = {
		fetch: (url) => {
			requests.push(url)
			const next = responders.shift()
			return Promise.resolve(next ? next(url) : json({}))
		},
		time: () => Date.UTC(2026, 10, 1),
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

const signature = (source: SaturnSignature['source']): SaturnSignature => ({ modelVersion: 1, ringModelVersion: 1, scope: 'moons', source, policy: 'automatic', generation: 3 })

describe('requests', () => {
	test('a superseded view never replaces a newer one', async () => {
		const state = proxy(createSaturnPlannerState())
		const first = deferred<Response>()
		const { io } = fakeIo(
			() => first.promise,
			() => json({ time: 2, moons: [] }),
		)

		state.time = 1
		const older = loadState(state, io)
		state.time = 2
		const newer = loadState(state, io)
		await newer
		first.resolve(json({ time: 1, moons: [] }))
		await older

		expect(state.moonsState?.time).toBe(2)
	})

	test('refused moons read the rings on their own', async () => {
		const state = proxy(createSaturnPlannerState())
		state.time = 5
		const { io, requests } = fakeIo(
			() => json({ error: 'The SPICE kernels cannot give the Saturnian states (targetMissing)', code: 'missingDependency' }, 503),
			() => json({ time: 5, rings: { earthOpening: 0.1 } }),
		)
		await loadState(state, io)

		expect(requests).toEqual(['/api/saturn/moons/state', '/api/saturn/rings/state'])
		expect(state.moonsRefused).toBeTrue()
		expect(state.moonsState).toBeUndefined()
		expect(state.ringState?.time).toBe(5)
	})
})

describe('events', () => {
	const timeline = {
		events: [
			{ kind: 'earthPlaneCrossing', time: 10 * DAY, earthOpening: 0, solarOpening: 0.01 },
			{ kind: 'openingMaximum', time: 40 * DAY, earthOpening: 0.1, solarOpening: 0.05 },
		],
	} as unknown as SaturnRingTimeline
	const elongations = {
		elongations: [
			{ moon: 'titan', time: 12 * DAY, separation: 0.001, positionAngle: 1.5 },
			{ moon: 'iapetus', time: 11 * DAY, separation: 0.003, positionAngle: -1.6 },
		],
	} as unknown as SaturnElongations

	test('the period lists its ring events and the separations of the moons drawn, chronologically', () => {
		const listed = listedEvents(timeline, elongations, { start: 0, end: 20 * DAY }, ['titan'])
		expect(listed.map(listedId)).toEqual([`ring|earthPlaneCrossing|${10 * DAY}`, `separation|titan|${12 * DAY}`])
	})

	test('selecting an event moves only the tool clock', () => {
		const state = proxy(createSaturnPlannerState())
		state.playing = true
		const sky = { ...skyClock }
		const [event] = listedEvents(timeline, undefined, { start: 0, end: 20 * DAY }, [])
		selectEvent(state, event)
		expect(state.time).toBe(10 * DAY)
		expect(state.playing).toBeFalse()
		expect(state.selected).toBe(listedId(event))
		expect({ ...skyClock }).toEqual(sky)
	})
})

describe('helpers', () => {
	test('the history spans a year, a decade, or a Saturnian year around the instant', () => {
		const time = Date.UTC(2026, 10, 1)
		expect(historyRange('year', time)).toEqual({ start: Date.UTC(2026, 0, 1), end: Date.UTC(2027, 0, 1) })
		const decade = historyRange('decade', time)
		expect((decade.end - decade.start) / (365.25 * DAY)).toBeCloseTo(10, 1)
		const season = historyRange('season', time)
		expect((season.end - season.start) / (365.25 * DAY)).toBeCloseTo(29.46, 1)
		expect(season.start % DAY).toBe(0)
	})

	test('the far half of the rings follows the sign of the Earth opening', () => {
		expect(farHalfSign(0.1)).toBe(-1)
		expect(farHalfSign(-0.1)).toBe(1)
		expect(annulusPath(2, 0.5, 1, 0.25)).toBe('M-2,0A2,0.5 0 1 0 2,0A2,0.5 0 1 0 -2,0ZM-1,0A1,0.25 0 1 0 1,0A1,0.25 0 1 0 -1,0Z')
	})

	test('the source names the theories of the scope and why the kernels were not used', () => {
		expect(describeSource(signature({ kind: 'analytical', planetary: 'VSOP87E', fallbackReason: 'noKernel' }))).toBe('VSOP87E, because no SPICE kernel is enabled')
		expect(describeSource(signature({ kind: 'analytical', planetary: 'VSOP87E', satellites: 'TASS1.7', fallbackReason: 'targetMissing' }))).toBe('VSOP87E + TASS 1.7, because no enabled kernel has every body needed')
		expect(describeSource(signature({ kind: 'spk', kernels: { saturn: ['a'], titan: ['a', 'b'] } }))).toBe('SPICE kernels (2 files, generation 3)')
	})
})
