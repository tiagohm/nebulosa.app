import { meteorSolarLongitude } from 'nebulosa/src/astronomy/meteors/solar'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { normalizeAngle } from 'nebulosa/src/math/units/angle'
import { LruCache } from './lrucache'

// Solar longitudes of the Meteor Showers catalog: the instants at which the geometric geocentric solar longitude of the
// toolkit (meteorSolarLongitude, J2000 ecliptic, VSOP87E) reaches a value, for every shower of a year at once. Solving
// each longitude by root search costs about 3 ms, about 10 s for the whole IAU catalog, so each civil UTC year is sampled
// once a day (about 0.25 s, once) and inverted on the cubic through the four samples around the crossing. The longitude
// is smooth on the scale of a day (its rate changes by 3% over a year), so the cubic errs by far less than a second of
// time, below the precision of any published shower date. A civil year is shorter than the orbit, so a fraction of a
// degree of longitude at its turn never occurs in it (see meteorSolarLongitudeCrossingTimes of the toolkit); its crossing
// is then undefined, as there.

// Spacing of the samples, milliseconds: one day, so every sample is a civil day boundary.
const SAMPLE_SPACING_MS = 86400000

// Years kept sampled: the calendar of a year reads the previous, the same, and the next one.
const YEAR_CACHE_LIMIT = 6

// Samples of one civil UTC year: the unwrapped longitude, increasing, at each day from the day before its first instant
// to the day after the first instant of the next year, so the cubic always has a sample on both sides.
interface YearSamples {
	// Instant of the first sample, the day before the year, Unix milliseconds (UTC).
	readonly origin: number
	// Unwrapped geometric solar longitude at each sample, radians, increasing.
	readonly longitudes: Float64Array
	// Index of the sample at the first instant of the year.
	readonly first: number
	// Index of the sample at the first instant of the next year.
	readonly last: number
}

// Value at u of the cubic through (−1, a), (0, b), (1, c), (2, d).
function cubic(a: number, b: number, c: number, d: number, u: number) {
	return (-a * u * (u - 1) * (u - 2)) / 6 + (b * (u + 1) * (u - 1) * (u - 2)) / 2 - (c * (u + 1) * u * (u - 2)) / 2 + (d * (u + 1) * u * (u - 1)) / 6
}

// Instants of solar longitudes, by civil UTC year.
export class MeteorSolarLongitudeTable {
	readonly #years = new LruCache<YearSamples>(YEAR_CACHE_LIMIT)

	// Instant, Unix milliseconds (UTC), at which the solar longitude (radians, any turn) is reached in the civil UTC year,
	// or undefined when the year never reaches it.
	crossing(year: number, longitude: number): number | undefined {
		const { origin, longitudes, first, last } = this.#samples(year)
		let target = normalizeAngle(longitude)
		if (target < longitudes[first]) target += 2 * Math.PI
		if (target >= longitudes[last]) return undefined

		let low = first
		let high = last
		while (high - low > 1) {
			const middle = (low + high) >> 1
			if (longitudes[middle] <= target) low = middle
			else high = middle
		}

		const [a, b, c, d] = [longitudes[low - 1], longitudes[low], longitudes[low + 1], longitudes[low + 2]]
		let u = (target - b) / (c - b)
		// Newton on the cubic from the linear guess; the cubic is nearly linear, so a few steps reach double precision.
		for (let i = 0; i < 4; i++) {
			const value = cubic(a, b, c, d, u) - target
			const slope = (cubic(a, b, c, d, u + 1e-6) - cubic(a, b, c, d, u - 1e-6)) / 2e-6
			u -= value / slope
		}

		return origin + (low + Math.min(1, Math.max(0, u))) * SAMPLE_SPACING_MS
	}

	// Crossing of the solar longitude nearest to the instant among the previous, same, and next civil year of it, Unix
	// milliseconds (UTC).
	nearest(time: number, longitude: number): number {
		const year = new Date(time).getUTCFullYear()
		let best: number | undefined
		for (let civilYear = year - 1; civilYear <= year + 1; civilYear++) {
			const crossing = this.crossing(civilYear, longitude)
			if (crossing !== undefined && (best === undefined || Math.abs(crossing - time) < Math.abs(best - time))) best = crossing
		}
		// Every longitude occurs within a year of any instant, so one of the three years reaches it.
		return best!
	}

	// First crossing of the solar longitude strictly after the instant, Unix milliseconds (UTC).
	after(time: number, longitude: number): number {
		const year = new Date(time).getUTCFullYear()
		for (let civilYear = year; ; civilYear++) {
			const crossing = this.crossing(civilYear, longitude)
			if (crossing !== undefined && crossing > time) return crossing
		}
	}

	// Samples of a civil year, computed on first use.
	#samples(year: number): YearSamples {
		const key = String(year)
		const cached = this.#years.get(key)
		if (cached) return cached

		const origin = Date.UTC(year, 0, 0)
		const days = Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / SAMPLE_SPACING_MS)
		const longitudes = new Float64Array(days + 3)
		let turns = 0
		let previous = Number.NEGATIVE_INFINITY

		for (let i = 0; i < longitudes.length; i++) {
			const raw = meteorSolarLongitude(timeUnix((origin + i * SAMPLE_SPACING_MS) / 1000, true))
			if (raw + turns < previous) turns += 2 * Math.PI
			previous = raw + turns
			longitudes[i] = previous
		}

		// The first sample of the year is taken modulo 2π, so a crossing below it is on the next turn.
		const shift = longitudes[1] - normalizeAngle(longitudes[1])
		for (let i = 0; i < longitudes.length; i++) longitudes[i] -= shift

		const samples = { origin, longitudes, first: 1, last: days + 1 }
		this.#years.set(key, samples)
		return samples
	}
}
