import type { PlanetVisibilityStatus } from 'api'
import { wallTimeToInstant, zonedWallTime } from '../../location/zone'
import { navigate, type RouteState, routeState } from '../../shell/route'
import type { StatusTone } from '../../ui/StatusBadge'

// Pieces shared by the planetary satellite planners (Jupiter, Saturn): the tool-local clock that plays independently of
// the Sky clock, the periods and evening dates, the datetime-local conversions, the viewer orientations, the
// interpolation of sampled moon tracks for display, the contact and visibility labels, and the way to the SPICE Kernel
// Library. Every position, contact, and classification comes from the server; these helpers only move a clock, format,
// and interpolate for display. Times are Unix milliseconds (UTC).

// Requests of a planner, replaced in tests.
export interface PlannerIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Real current time, Unix milliseconds (UTC).
	readonly time: () => number
}

// Browser implementation of PlannerIo.
export const browserPlannerIo: PlannerIo = { fetch: (input, init) => fetch(input, init), time: () => Date.now() }

// The clock of a planner: its instant, whether it plays, and its rate.
export interface PlannerClock {
	// Instant of the clock; absent until the tool opens.
	time?: number
	// Whether the clock plays.
	playing: boolean
	// Rate of the clock while it plays, in simulated seconds per real second.
	rate: number
}

// Days a period may span.
export type PlanetPeriod = 1 | 3 | 7 | 14

// Every period, in days.
export const PLANET_PERIODS: readonly PlanetPeriod[] = [1, 3, 7, 14]

// Clock rates while playing, in simulated seconds per real second.
export type PlanetRate = 60 | 600 | 3600

// Every rate.
export const PLANET_RATES: readonly PlanetRate[] = [60, 600, 3600]

// Label of each rate.
export const RATE_LABELS: Readonly<Record<PlanetRate, string>> = { 60: '1 min/s', 600: '10 min/s', 3600: '1 h/s' }

// How a viewer is oriented: north up with east left as the naked eye sees it, south up as an inverting telescope shows
// it, or north up with east right as a star diagonal shows it.
export type PlanetOrientation = 'north' | 'south' | 'mirrored'

// Every orientation.
export const PLANET_ORIENTATIONS: readonly PlanetOrientation[] = ['north', 'south', 'mirrored']

// Label of each orientation.
export const ORIENTATION_LABELS: Readonly<Record<PlanetOrientation, string>> = { north: 'North up, east left', south: 'South up (inverting)', mirrored: 'North up, east right (diagonal)' }

// Step of the step buttons, in milliseconds (10 minutes).
export const STEP_MS = 600_000

// Label of each contact of a satellite phenomenon or mutual event.
export const CONTACT_LABELS: Readonly<Record<string, string>> = {
	external1: 'First external contact',
	internal1: 'First internal contact',
	center1: 'Centre on the edge (ingress)',
	center2: 'Centre on the edge (egress)',
	internal2: 'Last internal contact',
	external2: 'Last external contact',
	visibleStart: 'Shadow centre starts facing the Earth',
	visibleEnd: 'Shadow centre stops facing the Earth',
}

// Order the contacts are listed in.
export const CONTACT_ORDER = ['external1', 'internal1', 'center1', 'visibleStart', 'visibleEnd', 'center2', 'internal2', 'external2'] as const

// Label and tone of each visibility status shared by the planners.
export const VISIBILITY_LABELS: Readonly<Record<PlanetVisibilityStatus, { readonly label: string; readonly tone: StatusTone }>> = {
	observable: { label: 'Observable', tone: 'success' },
	partial: { label: 'Partly observable', tone: 'warning' },
	notObservable: { label: 'Not observable here', tone: 'danger' },
	unknownNoSite: { label: 'No site', tone: 'muted' },
}

// Milliseconds per day.
const DAY_MS = 86_400_000

// Milliseconds per hour.
const HOUR_MS = 3_600_000

// Delay between the last change of the clock and the request of the exact view, in milliseconds.
const STATE_DELAY_MS = 120

// Shortest wait between two requests of the exact view while the clock plays, in milliseconds.
const PLAY_STATE_INTERVAL_MS = 750

// Returns whether a failure is the abort of a superseded request.
export function aborted(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError'
}

// Returns the message of a failure.
export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

// Civil date of the evening holding an instant in a zone: the date of twelve hours earlier, so the small hours belong
// to the evening before. Only the default of the date picker; the server names each event's night itself.
export function eveningOf(time: number, timeZone: string) {
	const { year, month, day } = zonedWallTime(time - 12 * HOUR_MS, timeZone)
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// The period of an evening date: from its local noon in the zone, for `days` days. A noon the clocks skip falls back to
// UTC noon of the date.
export function periodRange(eveningDate: string, days: number, timeZone: string) {
	const [year, month, day] = eveningDate.split('-').map(Number)
	const instant = wallTimeToInstant({ year, month, day, hour: 12, minute: 0, second: 0 }, timeZone)
	const start = instant.kind === 'exact' ? instant.time : instant.kind === 'ambiguous' ? instant.earlier : Date.UTC(year, month - 1, day, 12)
	return { start, end: start + days * DAY_MS }
}

// Value of a datetime-local input for an instant in a zone.
export function localInput(time: number, timeZone: string) {
	const { year, month, day, hour, minute } = zonedWallTime(time, timeZone)
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

// Instant of a datetime-local input in a zone: the earlier of a repeated reading, undefined for an empty value or one
// the clocks skip.
export function inputInstant(value: string, timeZone: string) {
	const [date, clock] = value.split('T')
	if (!date || !clock) return undefined
	const [year, month, day] = date.split('-').map(Number)
	const [hour, minute] = clock.split(':').map(Number)
	const instant = wallTimeToInstant({ year, month, day, hour, minute, second: 0 }, timeZone)
	return instant.kind === 'exact' ? instant.time : instant.kind === 'ambiguous' ? instant.earlier : undefined
}

// Sets a clock to an instant and stops playing.
export function setTime(clock: PlannerClock, time: number) {
	clock.time = time
	clock.playing = false
}

// The event whose maximum is the next after (direction 1) or the last before (direction −1) an instant.
export function adjacentEvent<E extends { readonly maximum: number }>(events: readonly E[], time: number, direction: 1 | -1) {
	let best: E | undefined

	for (const event of events) {
		if (direction > 0 ? event.maximum > time + 1000 : event.maximum < time - 1000) {
			if (!best || (direction > 0 ? event.maximum < best.maximum : event.maximum > best.maximum)) best = event
		}
	}

	return best
}

// A moon's sky offsets at an instant, from the tracks: east, north, and depth in planet radii.
export interface MoonPosition {
	readonly east: number
	readonly north: number
	readonly depth: number
}

// The samples of a moon in a track.
interface TrackSamples {
	readonly east: readonly number[]
	readonly north: readonly number[]
	readonly depth: readonly number[]
}

// A sampled track of moons.
export interface SampledTrack<M extends string> {
	readonly times: readonly number[]
	readonly moons: Readonly<Record<M, TrackSamples>>
}

// Positions of `moons` at an instant by linear interpolation between the samples of the track, for display only;
// undefined outside the track.
export function interpolateTrack<M extends string>(track: SampledTrack<M> | undefined, time: number, moons: readonly M[]): Record<M, MoonPosition> | undefined {
	if (!track || track.times.length < 2) return undefined
	const { times } = track
	if (time < times[0] || time > times.at(-1)!) return undefined

	let low = 0
	let high = times.length - 1

	while (high - low > 1) {
		const middle = (low + high) >> 1
		if (times[middle] <= time) low = middle
		else high = middle
	}

	const f = (time - times[low]) / (times[high] - times[low])
	const at = (values: readonly number[]) => values[low] + (values[high] - values[low]) * f
	const out = {} as Record<M, MoonPosition>
	for (const moon of moons) out[moon] = { east: at(track.moons[moon].east), north: at(track.moons[moon].north), depth: at(track.moons[moon].depth) }
	return out
}

// Offset along the planet's equator toward the east (in planet radii) of a sky offset, given the position angle of the
// projected pole.
export function equatorOffset(east: number, north: number, poleAngle: number) {
	return east * Math.cos(poleAngle) - north * Math.sin(poleAngle)
}

// Screen offsets (x to the right, y down, in planet radii) of a sky offset in an orientation.
export function screenOffset(east: number, north: number, orientation: PlanetOrientation): readonly [number, number] {
	if (orientation === 'south') return [east, north]
	if (orientation === 'mirrored') return [east, -north]
	return [-east, -north]
}

// Schedules `load` (the request of the exact view) after the clock settles, returning its cancellation.
export function scheduleLoad(load: () => Promise<void>, delay: number = STATE_DELAY_MS) {
	const timer = setTimeout(() => void load(), delay)
	return () => clearTimeout(timer)
}

// Advances a playing clock by the real time elapsed, at its rate; `load` asks for the exact view at most every
// PLAY_STATE_INTERVAL_MS. With reduced motion the clock jumps once a second instead of gliding. Returns the stop of the loop.
export function playClock(clock: PlannerClock, reducedMotion: boolean, load: () => Promise<void>, frame: (run: (now: number) => void) => number = requestAnimationFrame, cancel: (id: number) => void = cancelAnimationFrame) {
	let last: number | undefined
	let lastState = 0
	let id = 0

	const tick = (now: number) => {
		if (!clock.playing || clock.time === undefined) return

		if (last === undefined || !reducedMotion || now - last >= 1000) {
			if (last !== undefined) clock.time += (now - last) * clock.rate
			last = now
		}

		if (now - lastState >= PLAY_STATE_INTERVAL_MS) {
			lastState = now
			void load()
		}

		id = frame(tick)
	}

	id = frame(tick)
	return () => cancel(id)
}

// Opens the SPICE Kernel Library, where the operator adds or enables a kernel; nothing is downloaded here.
export function openKernelLibrary(route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	navigate(route, { workspace: 'tools', tool: 'spice-kernel-library' }, history)
}
