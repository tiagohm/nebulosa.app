import type { PointingModelDetail, PointingPlanRecord, PointingRevision, PointingSampleRecord } from 'api'
import { DEG2RAD, RAD2DEG } from 'nebulosa/src/core/constants'

// Pure geometry and summaries of the Pointing Map: a polar plot of the local sky with the zenith at the center, north up
// and east to the right, as a dome is seen from above, where the distance from the center is the zenith distance. Waypoints
// are fixed on the local sky, so a sample is drawn at its waypoint whatever the time it was taken. An error is measured on
// the sky, east and north in radians, and is carried through the hour angle and declination of its waypoint to reach the
// map, so its arrow keeps the sense it has on the sky however far from the zenith it is. Every measure is computed by the
// server; nothing here judges a model.

// Largest zenith distance the map shows, in degrees: the horizon.
const HORIZON_DISTANCE = 90

// A point of the map, in the units of the radius given.
export interface MapPoint {
	// Horizontal position from the center, positive to the east.
	readonly x: number
	// Vertical position from the center, positive to the south, as an SVG coordinate grows.
	readonly y: number
}

// What is known of a waypoint:
// - planned: not visited yet.
// - current: the session is on it.
// - accepted: it has a sample a fit can use.
// - rejected: its last attempt gave no usable sample.
export type WaypointStatus = 'planned' | 'current' | 'accepted' | 'rejected'

// A waypoint as the map draws it.
export interface MapWaypoint {
	// Position in the plan.
	readonly index: number
	// Position on the map, in units of the radius.
	readonly point: MapPoint
	// What is known of it.
	readonly status: WaypointStatus
	// Whether it is withheld from the fit.
	readonly heldOut: boolean
	// Latest sample of the waypoint, if any.
	readonly sample?: PointingSampleRecord
}

// Measures of the errors of a sample set, in radians, absent when there is no error to measure.
export interface ErrorDistribution {
	// Errors measured.
	readonly count: number
	// Root mean square.
	readonly rms?: number
	// Median.
	readonly median?: number
	// 95th percentile.
	readonly p95?: number
}

// Returns the point of an azimuth and altitude, in radians, on a map of a radius. Azimuth runs north through east.
export function mapPoint(azimuth: number, altitude: number, radius: number): MapPoint {
	const distance = ((HORIZON_DISTANCE - altitude * RAD2DEG) / HORIZON_DISTANCE) * radius
	return { x: distance * Math.sin(azimuth), y: -distance * Math.cos(azimuth) }
}

// Returns the azimuth and altitude of an hour angle and declination at a latitude, all in radians.
export function horizontalOfHourAngle(hourAngle: number, declination: number, latitude: number): readonly [azimuth: number, altitude: number] {
	const sinLatitude = Math.sin(latitude)
	const cosLatitude = Math.cos(latitude)
	const sinDeclination = Math.sin(declination)
	const cosDeclination = Math.cos(declination)
	const cosHourAngle = Math.cos(hourAngle)
	const altitude = Math.asin(Math.min(1, Math.max(-1, sinLatitude * sinDeclination + cosLatitude * cosDeclination * cosHourAngle)))
	const azimuth = Math.atan2(-cosDeclination * Math.sin(hourAngle), cosLatitude * sinDeclination - sinLatitude * cosDeclination * cosHourAngle)
	return [azimuth, altitude]
}

// Returns where an error of a waypoint ends on a map, magnified by a factor: an east error lowers the hour angle, on the
// small circle of its declination. Errors are east and north, in radians.
export function errorArrowEnd({ hourAngle, declination }: Pick<PointingPlanRecord['waypoints'][number], 'hourAngle' | 'declination'>, dx: number, dy: number, latitude: number, magnification: number, radius: number): MapPoint {
	const east = (dx * magnification) / Math.max(Math.cos(declination), 1e-3)
	return mapPoint(...horizontalOfHourAngle(hourAngle - east, declination + dy * magnification, latitude), radius)
}

// Returns the map of a plan: the waypoints with what is known of them from the samples, the latest attempt of each standing.
export function mapWaypoints(plan: Pick<PointingPlanRecord, 'waypoints'>, samples: readonly PointingSampleRecord[], current: number | undefined, radius: number): MapWaypoint[] {
	const latest = new Map<number, PointingSampleRecord>()

	for (const sample of samples) {
		const known = latest.get(sample.waypoint)
		if (known?.status !== 'accepted') latest.set(sample.waypoint, sample)
	}

	return plan.waypoints.map(({ index, azimuth, altitude, role }) => {
		const sample = latest.get(index)
		const status: WaypointStatus = index === current ? 'current' : sample ? sample.status : 'planned'
		return { index, point: mapPoint(azimuth, altitude, radius), status, heldOut: role === 'heldOut', ...(sample && { sample }) }
	})
}

// Returns the rings of the map, as altitudes in radians, from the horizon up.
export function mapRings() {
	return [0, 30, 60].map((altitude) => altitude * DEG2RAD)
}

// Returns the magnification that makes the largest error of a set a tenth of the radius on the map, or 1 without errors.
export function errorMagnification(errors: readonly number[], radius: number) {
	const largest = Math.max(0, ...errors)
	if (largest <= 0) return 1
	// A radian on the sky is 2/π of the radius on the map.
	return radius / 10 / (largest * (radius / (Math.PI / 2)))
}

// Returns the distribution of a set of error magnitudes.
export function errorDistribution(errors: readonly number[]): ErrorDistribution {
	if (errors.length === 0) return { count: 0 }
	const sorted = errors.toSorted((a, b) => a - b)
	const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
	return { count: sorted.length, rms: Math.sqrt(sorted.reduce((sum, error) => sum + error * error, 0) / sorted.length), median: at(0.5), p95: at(0.95) }
}

// Returns how many samples each reason rejected, most common first.
export function rejectionReasons(samples: readonly PointingSampleRecord[]): readonly (readonly [reason: string, count: number])[] {
	const reasons = new Map<string, number>()

	for (const { status, reason } of samples) {
		if (status === 'rejected') reasons.set(reason ?? 'Unknown', (reasons.get(reason ?? 'Unknown') ?? 0) + 1)
	}

	return [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

// Returns the revision a view shows: the one asked for when it exists, else the latest.
export function shownRevision(model: Pick<PointingModelDetail, 'revisions'>, revisionId?: string): PointingRevision | undefined {
	return model.revisions.find((revision) => revision.revisionId === revisionId) ?? model.revisions.at(-1)
}
