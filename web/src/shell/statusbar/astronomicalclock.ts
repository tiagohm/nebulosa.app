import type { AstronomicalTimeReference, SkyObserver } from 'api'
import { formatAngle, formatHMS, normalizeAngle } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { fetchJson, jsonInit } from '../../http'
import type { AstronomicalClockPreferences, AstronomicalClockReading } from '../../profile/schema'
import { createRequestGuard } from '../../sky/selection'

// Real-time clock of the status bar. The server samples its current time and sidereal times (/api/astronomical-time/
// reference), and between samples the bar moves them on by the time elapsed on the monotonic clock of the tab, at the rate
// the server gave: rate arithmetic only, so no astronomy runs here. The sample belongs to the tab and is never persisted,
// and nothing here reads the Sky simulation clock. A reading too old to trust is marked, then withdrawn.

// One sample of the server, with the moment the tab took it.
export interface ClockSample {
	// Answer of the server.
	readonly reference: AstronomicalTimeReference
	// Monotonic clock of the tab at the midpoint of the request, in milliseconds.
	readonly sampledAt: number
	// Wall clock of the tab at the same moment, Unix milliseconds, to notice a jump of either clock.
	readonly wallAt: number
}

// Clock of the tab.
export interface AstronomicalClockRuntime {
	// Latest sample; absent before the first one, or after the observer changed.
	sample?: ClockSample
	// Observer the sample was taken for.
	observerKey?: string
}

// Clock of the tab.
export const astronomicalClockRuntime = proxy<AstronomicalClockRuntime>({})

// Browser services of the clock, replaced in tests.
export interface AstronomicalClockIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Monotonic clock in milliseconds.
	readonly monotonic: () => number
	// Wall clock in Unix milliseconds.
	readonly wall: () => number
	// Whether the page is visible; a hidden page asks for nothing.
	readonly visible: () => boolean
	// Calls listener when the page is shown or hidden; returns the function that stops it.
	readonly onVisibility: (listener: () => void) => () => void
}

// Browser implementation of AstronomicalClockIo.
const browserClockIo: AstronomicalClockIo = {
	fetch: (input, init) => fetch(input, init),
	monotonic: () => performance.now(),
	wall: () => Date.now(),
	visible: () => document.visibilityState === 'visible',
	onVisibility: (listener) => {
		document.addEventListener('visibilitychange', listener)
		return () => document.removeEventListener('visibilitychange', listener)
	},
}

// Age from which a sample is renewed, in milliseconds. The rate of sidereal time is stable, so the error this bounds comes
// from the clock of the tab, not from the extrapolation.
const SAMPLE_INTERVAL_MS = 60_000

// Interval at which a sample is checked for age and clock jumps, in milliseconds.
const CHECK_INTERVAL_MS = 5000

// Disagreement between the wall and monotonic clocks since a sample that means one of them jumped, as after a sleep or
// a change of the system time, in milliseconds.
const CLOCK_JUMP_MS = 2000

// Age from which a reading is marked as stale, in milliseconds, for a server that stopped answering.
const STALE_AGE_MS = 300_000

// Age from which a reading is withdrawn, in milliseconds.
const EXPIRED_AGE_MS = 1_800_000

// Decimals of a Julian date in the bar: 1e-5 day is 0.86 s, about the resolution of a clock updated once per second.
const JULIAN_DECIMALS = 5

// Name of each reading.
export const ASTRONOMICAL_CLOCK_READING_LABELS: Readonly<Record<AstronomicalClockReading, string>> = { last: 'LAST (Apparent Sidereal)', lmst: 'LMST (Mean Sidereal)', jd: 'JD (UTC)', mjd: 'MJD (UTC)', utc: 'UTC', local: 'Local Time' }

// Short name of each reading in the bar, naming the scale of the Julian dates.
const READING_NAMES: Readonly<Record<AstronomicalClockReading, string>> = { last: 'LAST', lmst: 'LMST', jd: 'JD(UTC)', mjd: 'MJD(UTC)', utc: 'UTC', local: 'Local' }

// Julian date of the origin of Modified Julian Dates, in days.
const MJD_ORIGIN = 2400000.5

// Age of a sample:
// - none: there is no sample.
// - fresh: recent.
// - stale: the server stopped answering, but the reading still holds well enough to show, marked.
// - expired: too old to show.
export type ClockFreshness = 'none' | 'fresh' | 'stale' | 'expired'

// A sample moved on to the present.
export interface LiveClock {
	// Current time, Unix milliseconds.
	readonly unixMillis: number
	// Julian date (UTC).
	readonly jd: number
	// Local mean sidereal time in radians, with an observer.
	readonly lmst?: number
	// Local apparent sidereal time in radians, with an observer.
	readonly last?: number
}

// One reading as the bar shows it.
export interface ClockReadingText {
	// Name of the reading, naming its scale.
	readonly label: string
	// Value, or -- while there is none to show.
	readonly value: string
}

// Formatters of the time of day, by time zone and precision.
const timeFormatters = new Map<string, Intl.DateTimeFormat>()

// Returns how old a sample is at a moment of the monotonic clock.
export function clockFreshness(sample: Pick<ClockSample, 'sampledAt'> | undefined, now: number): ClockFreshness {
	if (!sample) return 'none'
	const age = now - sample.sampledAt
	return age >= EXPIRED_AGE_MS ? 'expired' : age >= STALE_AGE_MS ? 'stale' : 'fresh'
}

// Moves a sample on to a moment of the monotonic clock, at the rate of sidereal time the server gave.
export function liveClock({ reference, sampledAt }: Pick<ClockSample, 'reference' | 'sampledAt'>, now: number): LiveClock {
	const elapsed = (now - sampledAt) / 1000
	const advance = reference.siderealRate * elapsed
	return { unixMillis: reference.unixMillis + elapsed * 1000, jd: reference.jd + elapsed / 86400, lmst: reference.lmst === undefined ? undefined : normalizeAngle(reference.lmst + advance), last: reference.last === undefined ? undefined : normalizeAngle(reference.last + advance) }
}

// Returns the readings the bar shows, in order: none while disabled; without an observer, the Julian Date (UTC) stands for
// a primary sidereal reading and a secondary one is left out. The preference itself is never changed.
export function effectiveReadings({ enabled, primary, secondary }: Pick<AstronomicalClockPreferences, 'enabled' | 'primary' | 'secondary'>, located: boolean): AstronomicalClockReading[] {
	if (!enabled) return []
	const sidereal = (reading: AstronomicalClockReading) => reading === 'last' || reading === 'lmst'
	const first = sidereal(primary) && !located ? 'jd' : primary
	return secondary === 'none' || secondary === first || (sidereal(secondary) && !located) ? [first] : [first, secondary]
}

// Returns a time of day of an instant in a time zone, on 24 hours.
function timeOfDay(time: number, timeZone: string, seconds: boolean) {
	const key = `${timeZone}|${seconds}`
	let formatter = timeFormatters.get(key)

	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined })
		timeFormatters.set(key, formatter)
	}

	return formatter.format(time)
}

// Returns a sidereal time, in hours and minutes, or with its seconds.
function siderealText(angle: number, seconds: boolean) {
	return seconds ? formatHMS(angle, false) : formatAngle(angle, { isHour: true, separators: ':', noSign: true, noSecond: true })
}

// Returns a reading as text: `value` is -- without a live clock or, for a sidereal time, without an observer. A sidereal time
// computed with UT1 taken as UTC starts with ~.
export function clockReadingText(reading: AstronomicalClockReading, live: LiveClock | undefined, timeZone: string, showSeconds: boolean, approximate: boolean = false): ClockReadingText {
	const label = READING_NAMES[reading]
	if (!live) return { label, value: '--' }

	switch (reading) {
		case 'last':
		case 'lmst': {
			const angle = live[reading]
			return { label, value: angle === undefined ? '--' : `${approximate ? '~' : ''}${siderealText(angle, showSeconds)}` }
		}
		case 'jd':
			return { label, value: live.jd.toFixed(JULIAN_DECIMALS) }
		case 'mjd':
			return { label, value: (live.jd - MJD_ORIGIN).toFixed(JULIAN_DECIMALS) }
		case 'utc':
			return { label, value: timeOfDay(live.unixMillis, 'UTC', showSeconds) }
		case 'local':
			return { label, value: timeOfDay(live.unixMillis, timeZone, showSeconds) }
	}
}

// Returns the full readout of the clock, one line each: every reading, the site, why a reading may be off, and where the
// clock leads. `site` is absent without an observer, whose sidereal times are then left out.
export function clockTitle(live: LiveClock | undefined, timeZone: string, site: string | undefined, notes: readonly string[], approximate: boolean) {
	const readings: readonly AstronomicalClockReading[] = site === undefined ? ['utc', 'local', 'jd', 'mjd'] : ['utc', 'local', 'jd', 'mjd', 'last', 'lmst']
	const lines = readings.map((reading) => {
		const { label, value } = clockReadingText(reading, live, timeZone, true, approximate)
		return `${label} ${value}${reading === 'local' ? ` (${timeZone})` : ''}`
	})
	return [...lines, ...(site === undefined ? [] : [`Site ${site}`]), ...notes, 'Open Astronomical Time Converter'].join('\n')
}

// Whether a sample's sidereal times take UT1 as UTC.
export function clockApproximate(sample: Pick<ClockSample, 'reference'> | undefined) {
	return sample !== undefined && sample.reference.quality.eop.status !== 'covered'
}

// Returns the key of an observer, which tells whether a sample was taken for it.
function observerKey(observer: SkyObserver | undefined) {
	return observer ? `${observer.latitude}|${observer.longitude}|${observer.elevation}` : ''
}

// Keeps the sample of the tab current for an observer: at once, every SAMPLE_INTERVAL_MS, when the page is shown again, and
// when the wall and monotonic clocks disagree. A hidden page asks for nothing, and a failed request keeps the old sample, to
// age. A sample of another observer is dropped at once. Returns the function that stops it.
export function watchAstronomicalClock(state: AstronomicalClockRuntime, observer: SkyObserver | undefined, io: AstronomicalClockIo = browserClockIo): () => void {
	const guard = createRequestGuard()
	const key = observerKey(observer)
	let sampling = false

	if (state.observerKey !== key) {
		state.observerKey = key
		state.sample = undefined
	}

	async function sample() {
		if (sampling) return
		sampling = true
		const own = guard.begin()
		const started = io.monotonic()

		try {
			const reference = await fetchJson<AstronomicalTimeReference>(io, '/api/astronomical-time/reference', jsonInit('POST', { observer }, own.signal))
			if (own.current()) state.sample = { reference, sampledAt: (started + io.monotonic()) / 2, wallAt: io.wall() }
		} catch {
			// The sample in hand keeps aging, which the bar shows.
		} finally {
			sampling = false
		}
	}

	function check() {
		if (!io.visible()) return
		const current = state.sample
		const elapsed = current && io.monotonic() - current.sampledAt
		const drift = current && Math.abs(io.wall() - current.wallAt - elapsed!)
		if (!current || elapsed! >= SAMPLE_INTERVAL_MS || drift! > CLOCK_JUMP_MS) void sample()
	}

	if (io.visible()) void sample()
	const timer = setInterval(check, CHECK_INTERVAL_MS)
	const stopListening = io.onVisibility(check)

	return () => {
		clearInterval(timer)
		stopListening()
		guard.cancel()
	}
}
