import { describe, expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { panZoomViewBox } from './PanZoom'
import { adjacentEvent, equatorOffset, eveningOf, inputInstant, interpolateTrack, localInput, periodRange, type PlannerClock, playClock, screenOffset, setTime } from './planetary'

const HOUR = 3_600_000
const DAY = 24 * HOUR

describe('dates and periods', () => {
	test('the evening of an instant is the date twelve hours earlier in the zone', () => {
		// 01:00 in São Paulo on December 2 belongs to the evening of December 1.
		expect(eveningOf(Date.UTC(2026, 11, 2, 4), 'America/Sao_Paulo')).toBe('2026-12-01')
		expect(eveningOf(Date.UTC(2026, 11, 2, 0), 'America/Sao_Paulo')).toBe('2026-12-01')
		expect(eveningOf(Date.UTC(2026, 11, 2, 16), 'America/Sao_Paulo')).toBe('2026-12-02')
	})

	test('a period starts at local noon of its evening and lasts its days', () => {
		const range = periodRange('2026-12-01', 3, 'America/New_York')
		expect(range.start).toBe(Date.UTC(2026, 11, 1, 17))
		expect(range.end - range.start).toBe(3 * DAY)
		// Across the end of daylight time, noon is still local noon.
		expect(periodRange('2026-11-01', 1, 'America/New_York').start).toBe(Date.UTC(2026, 10, 1, 17))
		expect(periodRange('2026-10-31', 1, 'America/New_York').start).toBe(Date.UTC(2026, 9, 31, 16))
	})

	test('datetime inputs read and write wall times of a zone', () => {
		const time = Date.UTC(2026, 11, 1, 23, 30)
		expect(localInput(time, 'America/Sao_Paulo')).toBe('2026-12-01T20:30')
		expect(inputInstant('2026-12-01T20:30', 'America/Sao_Paulo')).toBe(time)
		expect(inputInstant('', 'UTC')).toBeUndefined()
	})
})

describe('clock', () => {
	test('setting the time stops playing', () => {
		const clock = proxy<PlannerClock>({ time: 0, playing: true, rate: 60 })
		setTime(clock, 5)
		expect(clock).toEqual({ time: 5, playing: false, rate: 60 })
	})

	test('playing advances the clock at its rate and loads at intervals', () => {
		const clock = proxy<PlannerClock>({ time: 0, playing: true, rate: 600 })
		const frames: ((now: number) => void)[] = []
		let loads = 0
		playClock(
			clock,
			false,
			() => {
				loads++
				return Promise.resolve()
			},
			(run) => frames.push(run),
			() => undefined,
		)

		frames.shift()!(1000)
		frames.shift()!(2000)
		expect(clock.time).toBe(600_000)
		frames.shift()!(2500)
		expect(clock.time).toBe(900_000)
		expect(loads).toBe(2)
		clock.playing = false
		frames.shift()!(3000)
		expect(frames).toHaveLength(0)
	})
})

describe('helpers', () => {
	test('tracks of any moons are interpolated linearly for display, and not outside them', () => {
		const series = (values: number[]) => ({ east: values, north: values.map((v) => -v), depth: values })
		const track = { times: [0, 60_000, 120_000], moons: { mimas: series([0, 2, 4]), titan: series([5, 3, 1]), iapetus: series([1, 1, 1]) } }
		const at = interpolateTrack(track, 90_000, ['mimas', 'titan', 'iapetus'])!
		expect(at.mimas).toEqual({ east: 3, north: -3, depth: 3 })
		expect(at.titan.east).toBe(2)
		expect(Object.keys(interpolateTrack(track, 0, ['titan'])!)).toEqual(['titan'])
		expect(interpolateTrack(track, 120_001, ['mimas'])).toBeUndefined()
		expect(interpolateTrack(undefined, 0, ['mimas'])).toBeUndefined()
	})

	test('the adjacent events skip the one at the clock', () => {
		const events = [
			{ id: 'a', maximum: 10_000 },
			{ id: 'b', maximum: 20_000 },
			{ id: 'c', maximum: 30_000 },
		]
		expect(adjacentEvent(events, 20_000, 1)?.id).toBe('c')
		expect(adjacentEvent(events, 20_000, -1)?.id).toBe('a')
		expect(adjacentEvent(events, 30_000, 1)).toBeUndefined()
	})

	test('orientations place east and north on the screen', () => {
		expect(screenOffset(1, 1, 'north')).toEqual([-1, -1])
		expect(screenOffset(1, 1, 'south')).toEqual([1, 1])
		expect(screenOffset(1, 1, 'mirrored')).toEqual([1, -1])
		// With the pole turned 90° east, the equator runs north-south.
		expect(equatorOffset(0, -2, Math.PI / 2)).toBeCloseTo(2, 12)
		expect(equatorOffset(3, 0, 0)).toBe(3)
	})
})

describe('pan and zoom', () => {
	test('the whole system fills the width at zoom 1, centred on the planet', () => {
		expect(panZoomViewBox({ x: 0, y: 0, k: 1 }, 30, 2, 600)).toEqual({ x: -30, y: -15, width: 60, height: 30 })
	})

	test('zooming narrows the box and a pan moves its centre the other way', () => {
		// At zoom 10 the half-width is 3 radii; 600 pixels span 60 radii at zoom 1, so 10 px per radius at zoom 1 and
		// 100 px per radius at zoom 10: a pan of 200 px to the right shows the point 2 radii to the left in the centre.
		const box = panZoomViewBox({ x: 200, y: -100, k: 10 }, 30, 2, 600)
		expect(box.width).toBeCloseTo(6, 12)
		expect(box.height).toBeCloseTo(3, 12)
		expect(box.x + box.width / 2).toBeCloseTo(-2, 12)
		expect(box.y + box.height / 2).toBeCloseTo(1, 12)
	})
})
