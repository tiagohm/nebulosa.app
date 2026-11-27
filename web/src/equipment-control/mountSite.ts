import type { MountState } from 'api'
import { EARTH_RADIUS_KM } from 'nebulosa/src/core/constants'
import { sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'

// Comparison of the site a mount reports with the observing site of the profile: a mount converts coordinates with its
// own site, so a mount that never received the active site points and reports altitude for another place.

// Largest difference of latitude or longitude, in degrees, still read as the same site; about 1 km on the ground,
// above the rounding drivers apply when they store a site.
const SITE_TOLERANCE = 0.01

// Returns whether the site a mount reports (latitude and longitude in radians) is another place than the observing
// site (latitude and longitude in degrees); the longitude difference is taken across the antimeridian.
export function mountSiteDiffers(site: Pick<MountState['site'], 'latitude' | 'longitude'>, observer: { readonly latitude: number; readonly longitude: number }): boolean {
	const longitude = Math.abs(((((toDeg(site.longitude) - observer.longitude) % 360) + 540) % 360) - 180)
	return Math.abs(toDeg(site.latitude) - observer.latitude) > SITE_TOLERANCE || longitude > SITE_TOLERANCE
}

// Returns the distance in kilometers along the ground between the site a mount reports (latitude and longitude in
// radians) and the observing site (latitude and longitude in degrees), on a sphere of the Earth's equatorial radius,
// which is within 0.5 % of the geodesic; elevations are ignored.
export function mountSiteDistance(site: Pick<MountState['site'], 'latitude' | 'longitude'>, observer: { readonly latitude: number; readonly longitude: number }): number {
	return sphericalSeparation(site.longitude, site.latitude, deg(observer.longitude), deg(observer.latitude)) * EARTH_RADIUS_KM
}
