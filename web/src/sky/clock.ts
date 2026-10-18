import { proxy } from 'valtio'

// Simulation clock of the tab's Sky workspace and the wall-clock conversions of its time zone. The clock
// decides which instant the star map, the selection's position, and its events show: the real current
// time (now), an instant chosen by the user (fixed), or an instant that advances at a rate (playing). It
// is presentation state only, kept per tab and never persisted. Equipment operations never read it: a
// physical command resolves its target for the real current time, whatever instant the map shows.

// How the simulated instant is decided.
export type SkyClockMode = 'now' | 'fixed' | 'playing'

// Simulation clock state.
export interface SkyClock {
	// How the simulated instant is decided.
	mode: SkyClockMode
	// Fixed instant, or the instant playing started from; Unix milliseconds (UTC). Unused in `now`.
	anchor: number
	// Real time when playing started from the anchor, Unix milliseconds (UTC). Used in `playing` only.
	startedAt: number
	// Simulated seconds per real second; negative runs backwards. Kept while paused to resume at it.
	rate: number
}

// Wall-clock reading of an instant in a time zone. Months are 1-12.
export interface WallTime {
	// Calendar year.
	readonly year: number
	// Month, 1-12.
	readonly month: number
	// Day of the month, 1-31.
	readonly day: number
	// Hour, 0-23.
	readonly hour: number
	// Minute, 0-59.
	readonly minute: number
	// Second, 0-59.
	readonly second: number
}

// Speeds offered while playing, in simulated seconds per real second: real time, 10×, one minute, ten
// minutes, one hour, and one day per second.
export const SKY_TIME_RATES = [1, 10, 60, 600, 3600, 86400] as const

// Milliseconds in one day.
const DAY_MS = 86_400_000

// Simulation clock of the tab.
export const skyClock = proxy<SkyClock>({ mode: 'now', anchor: 0, startedAt: 0, rate: 1 })

// Returns the simulated instant in Unix milliseconds (UTC) for a real time in Unix milliseconds.
export function skyTime(clock: Readonly<SkyClock>, realNow: number): number {
	if (clock.mode === 'now') return realNow
	if (clock.mode === 'fixed') return clock.anchor
	return clock.anchor + (realNow - clock.startedAt) * clock.rate
}

// Follows the real current time again.
export function setSkyTimeNow(clock: SkyClock) {
	clock.mode = 'now'
}

// Shows an instant (Unix milliseconds, UTC). While playing, the clock keeps playing from it.
export function setSkyTime(clock: SkyClock, time: number, realNow: number = Date.now()) {
	clock.anchor = time
	clock.startedAt = realNow
	if (clock.mode !== 'playing') clock.mode = 'fixed'
}

// Moves the simulated instant by an amount in milliseconds, negative to go back.
export function stepSkyTime(clock: SkyClock, delta: number, realNow: number = Date.now()) {
	setSkyTime(clock, skyTime(clock, realNow) + delta, realNow)
}

// Plays the clock at a rate (simulated seconds per real second) from the instant shown now.
export function playSkyTime(clock: SkyClock, rate: number, realNow: number = Date.now()) {
	clock.anchor = skyTime(clock, realNow)
	clock.startedAt = realNow
	clock.rate = rate
	clock.mode = 'playing'
}

// Stops playing and keeps the instant reached.
export function pauseSkyTime(clock: SkyClock, realNow: number = Date.now()) {
	if (clock.mode !== 'playing') return
	clock.anchor = skyTime(clock, realNow)
	clock.mode = 'fixed'
}

// Formatters of wall-clock parts by time zone; undefined is the browser's zone.
const partFormatters = new Map<string | undefined, Intl.DateTimeFormat>()

// Returns the wall-clock reading of an instant (Unix milliseconds) in a time zone, or in the browser's
// zone when absent. Seconds are truncated.
export function zonedWallTime(time: number, timeZone?: string): WallTime {
	let formatter = partFormatters.get(timeZone)

	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
		partFormatters.set(timeZone, formatter)
	}

	const parts: Record<string, number> = {}
	for (const part of formatter.formatToParts(time)) if (part.type !== 'literal') parts[part.type] = +part.value
	return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second }
}

// Returns the offset of a time zone from UTC at an instant, in milliseconds (east positive).
function zoneOffset(time: number, timeZone?: string) {
	const whole = Math.floor(time / 1000) * 1000
	const wall = zonedWallTime(whole, timeZone)
	return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - whole
}

// Returns the instant (Unix milliseconds) at which the clocks of a time zone, or of the browser when
// absent, read a wall time. A reading that happens twice when the clocks go back gives the first one; a
// reading skipped when they go forward is moved forward by the gap, as clocks would show it.
export function zonedWallTimeToUtc(wall: WallTime, timeZone?: string): number {
	const local = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
	const before = local - zoneOffset(local - DAY_MS, timeZone)
	const after = local - zoneOffset(local + DAY_MS, timeZone)
	const valid = [before, after].filter((time) => time + zoneOffset(time, timeZone) === local)
	return valid.length > 0 ? Math.min(...valid) : before
}
