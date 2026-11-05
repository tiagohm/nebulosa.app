import { proxy } from 'valtio'

// Simulation clock of the tab's Sky workspace. The clock decides which instant the star map, the selection's position,
// and its events show: the real current time (now), an instant chosen by the user (fixed), or an instant that advances
// at a rate (playing). It is presentation state only, kept per tab and never persisted; the zone its instant is read in
// is location/zone.ts's. Equipment operations never read it: a physical command resolves its target for the real
// current time, whatever instant the map shows.

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

// Speeds offered while playing, in simulated seconds per real second: real time, 10×, one minute, ten
// minutes, one hour, and one day per second.
export const SKY_TIME_RATES = [1, 10, 60, 600, 3600, 86400] as const

// Interval in milliseconds at which the star map and the selection's position and events are updated
// together while the clock follows the real time (15 s, about 4′ of sidereal motion on the sky).
export const SKY_REALTIME_TICK_MS = 15_000

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
