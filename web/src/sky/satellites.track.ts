import type { SatelliteTrack } from 'api'

// Sampled satellite tracks of the Sky map: which window of samples to ask the server for at an instant of the Sky clock,
// and the position between two samples. Interpolation only places the marker between the server's samples; it is not a
// new prediction. Times are Unix milliseconds (UTC), angles radians (RA/Dec of date, geometric).

// Samples asked for in a window; the step is the window's length divided by this.
export const TRACK_SAMPLES = 60

// Shortest window, in milliseconds, at real-time rate: ten minutes in 10 s steps, along which the great-circle
// interpolation of a low orbit stays within a few arcseconds of SGP4.
export const TRACK_MIN_SPAN_MS = 600_000

// Longest window, in milliseconds, at the fastest play rates.
export const TRACK_MAX_SPAN_MS = 6 * 3_600_000

// Window of samples: its start and end (Unix milliseconds) and the step between samples (milliseconds).
export interface TrackWindow {
	readonly start: number
	readonly end: number
	readonly step: number
}

// Interpolated position of a satellite.
export interface TrackPoint {
	// Right ascension in [0, 2π) and declination, of date, radians.
	readonly rightAscension: number
	readonly declination: number
	// Geometric altitude, radians; absent without an observer.
	readonly altitude?: number
	// Whether the satellite is sunlit at the nearer sample.
	readonly sunlit: boolean
}

// Returns the window to ask for at an instant and a clock rate (simulated seconds per second, 1 for real time): a
// window that lasts about ten real minutes at that rate, between TRACK_MIN_SPAN_MS and TRACK_MAX_SPAN_MS, starting a
// tenth of it before the instant so a small step back stays inside, aligned to its step so neighboring requests repeat.
export function trackWindow(time: number, rate: number): TrackWindow {
	const span = Math.min(TRACK_MAX_SPAN_MS, Math.max(TRACK_MIN_SPAN_MS, TRACK_MIN_SPAN_MS * Math.abs(rate)))
	const step = Math.ceil(span / TRACK_SAMPLES / 1000) * 1000
	const start = Math.floor((time - span / 10) / step) * step
	return { start, end: start + step * TRACK_SAMPLES, step }
}

// Whether a window still serves an instant: it holds the instant with at least a step ahead, in the direction of play.
export function windowServes(window: TrackWindow | undefined, time: number, rate: number) {
	if (!window) return false
	return rate >= 0 ? time >= window.start && time <= window.end - window.step : time >= window.start + window.step && time <= window.end
}

// Unit vector of an RA/Dec, radians.
function unit(rightAscension: number, declination: number): [number, number, number] {
	const cosDec = Math.cos(declination)
	return [cosDec * Math.cos(rightAscension), cosDec * Math.sin(rightAscension), Math.sin(declination)]
}

// Returns the position at an instant between two samples of a track, by spherical linear interpolation of the
// directions (exact on a great circle, through the RA wrap at 0/2π and the poles), and linear interpolation of the
// altitude; undefined outside the samples.
export function interpolateTrack(track: SatelliteTrack, time: number): TrackPoint | undefined {
	const { times } = track
	if (times.length === 0 || time < times[0] || time > times.at(-1)!) return undefined

	let i = 0
	let j = times.length - 1

	while (j - i > 1) {
		const k = (i + j) >> 1
		if (times[k] <= time) i = k
		else j = k
	}

	if (times.length === 1 || times[j] === times[i]) return { rightAscension: track.rightAscension[i], declination: track.declination[i], altitude: track.altitude?.[i], sunlit: track.sunlit[i] }

	const f = (time - times[i]) / (times[j] - times[i])
	const a = unit(track.rightAscension[i], track.declination[i])
	const b = unit(track.rightAscension[j], track.declination[j])
	const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
	const angle = Math.acos(dot)
	// Nearly equal directions interpolate linearly, where the sine of the angle would lose its precision.
	const [wa, wb] = angle < 1e-9 ? [1 - f, f] : [Math.sin((1 - f) * angle) / Math.sin(angle), Math.sin(f * angle) / Math.sin(angle)]
	const x = wa * a[0] + wb * b[0]
	const y = wa * a[1] + wb * b[1]
	const z = wa * a[2] + wb * b[2]
	const rightAscension = Math.atan2(y, x)
	const altitude = track.altitude && track.altitude[i] + (track.altitude[j] - track.altitude[i]) * f

	return { rightAscension: rightAscension < 0 ? rightAscension + 2 * Math.PI : rightAscension, declination: Math.atan2(z, Math.hypot(x, y)), altitude, sunlit: f < 0.5 ? track.sunlit[i] : track.sunlit[j] }
}
