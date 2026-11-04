import type { SatelliteGroundTrack } from 'api'
import { DEG2RAD, RAD2DEG } from 'nebulosa/src/core/constants'
import { interpolateTrack } from '../../sky/satellites.track'
import { type GeoPoint, splitAtAntimeridian } from '../../ui/worldmap.geometry'

// Ground track of a satellite on the world map, from the samples of the server: the point of an instant between two
// samples, the runs of the line before and after an instant and in and out of the Earth's shadow, and whether an
// observer sees the satellite. Interpolation only places points between the server's samples; it is not a new
// prediction. Times are Unix milliseconds (UTC); the server's angles are radians, the map's degrees.

// Illumination of a satellite by the Sun.
export type GroundTrackShadow = SatelliteGroundTrack['shadow'][number]

// Ground track at an instant, in degrees.
export interface GroundTrackPoint {
	// Instant, Unix milliseconds (UTC).
	readonly time: number
	// Point below the satellite, degrees (longitude in (−180, 180]).
	readonly subpoint: GeoPoint
	// Height above the ellipsoid, km.
	readonly heightKm: number
	// Angular radius of the region that sees the satellite above the horizon, degrees (spherical Earth, ideal horizon).
	readonly footprint: number
	// Illumination at the nearer sample.
	readonly shadow: GroundTrackShadow
	// Point below the Sun, degrees (longitude in (−180, 180]).
	readonly subsolar: GeoPoint
}

// Part of the track with one illumination, wholly before or after an instant, cut at the antimeridian.
export interface GroundTrackRun {
	// Whether the run is before the instant.
	readonly past: boolean
	// Illumination along the run.
	readonly shadow: GroundTrackShadow
	// Pieces of the run, each within the map, meeting at ±180°.
	readonly pieces: readonly (readonly GeoPoint[])[]
}

// Point of the map of a latitude and a longitude in radians, the longitude in (−180°, 180°].
function geoPoint(latitude: number, longitude: number): GeoPoint {
	const degrees = longitude * RAD2DEG
	return { longitude: degrees > 180 ? degrees - 360 : degrees, latitude: latitude * RAD2DEG }
}

// Returns the point between two samples on the great circle through them, radians; the interpolation of the Sky's tracks.
function slerp(times: readonly number[], latitude: readonly number[], longitude: readonly number[], time: number): GeoPoint | undefined {
	const point = interpolateTrack({ times, rightAscension: longitude, declination: latitude, sunlit: [] }, time)
	return point && geoPoint(point.declination, point.rightAscension)
}

// Returns the ground track at an instant between two samples: the subpoint and the subsolar point on great circles, the
// height and footprint linearly, and the illumination of the nearer sample; undefined outside the samples.
export function groundTrackAt(track: SatelliteGroundTrack, time: number): GroundTrackPoint | undefined {
	const { times } = track
	const subpoint = slerp(times, track.latitude, track.longitude, time)
	const subsolar = slerp(times, track.sunLatitude, track.sunLongitude, time)
	if (!subpoint || !subsolar) return undefined

	let i = 0
	let j = times.length - 1

	while (j - i > 1) {
		const k = (i + j) >> 1
		if (times[k] <= time) i = k
		else j = k
	}

	const f = times[j] === times[i] ? 0 : (time - times[i]) / (times[j] - times[i])
	const linear = (values: readonly number[]) => values[i] + (values[j] - values[i]) * f
	return { time, subpoint, heightKm: linear(track.heightKm), footprint: linear(track.footprint) * RAD2DEG, shadow: track.shadow[f < 0.5 ? i : j], subsolar }
}

// Returns the runs of the track: a new run where the illumination changes, at the sample where it does, and at the
// instant `cursor` (absent for none), where the point of that instant ends one run and starts the next. A segment
// between two samples has the illumination of its first sample.
export function groundTrackRuns(track: SatelliteGroundTrack, cursor?: number): GroundTrackRun[] {
	const runs: { past: boolean; shadow: GroundTrackShadow; points: GeoPoint[] }[] = []
	const { times } = track
	const at = cursor === undefined ? undefined : groundTrackAt(track, cursor)

	for (let i = 0; i < times.length - 1; i++) {
		const start = geoPoint(track.latitude[i], track.longitude[i])
		const end = geoPoint(track.latitude[i + 1], track.longitude[i + 1])
		const shadow = track.shadow[i]
		const parts: [boolean, GeoPoint, GeoPoint][] = []

		if (at && cursor! > times[i] && cursor! < times[i + 1]) parts.push([true, start, at.subpoint], [false, at.subpoint, end])
		else parts.push([cursor !== undefined && times[i + 1] <= cursor, start, end])

		for (const [past, from, to] of parts) {
			const run = runs.at(-1)
			if (run && run.past === past && run.shadow === shadow) run.points.push(to)
			else runs.push({ past, shadow, points: [from, to] })
		}
	}

	return runs.map(({ past, shadow, points }) => ({ past, shadow, pieces: splitAtAntimeridian(points) }))
}

// Whether an observer (degrees) is within the footprint of a ground track point: the great-circle distance to the
// subpoint at most the footprint's radius, on a spherical Earth with an ideal horizon.
export function observerInFootprint(observer: { readonly latitude: number; readonly longitude: number }, point: GroundTrackPoint) {
	const a = observer.latitude * DEG2RAD
	const b = point.subpoint.latitude * DEG2RAD
	const cosine = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((observer.longitude - point.subpoint.longitude) * DEG2RAD)
	return Math.acos(Math.max(-1, Math.min(1, cosine))) * RAD2DEG <= point.footprint
}
