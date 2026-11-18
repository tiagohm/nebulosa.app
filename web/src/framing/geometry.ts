import type { FramingSensor } from 'api'
import { pixelScale, sensorDiagonalFov } from 'nebulosa/src/astronomy/formulas'

// Field of view of an imaging setup: the optical configuration a framing resolves to, the angular size and image scale
// it gives, and the outline of the sensor on the sky. The sensor is flat, so its outline is the gnomonic (tangent-plane)
// projection of a rectangle around the center; its edges are great-circle arcs and the outline stays correct for wide
// fields. The tangent plane at a center has ξ towards east and η towards north, in units of the plane's distance, so a
// view of it with north up has east on the left, as the sky is seen.
//
// Orientation: the rotation is the position angle of the sensor's top edge (+Y), measured from celestial north towards
// east, as plate solvers report it for an image that is not mirrored. Mirrored images are not modeled.

// Size of the sensor, given either by its pixels or by its physical dimensions. Only one of the two is stored, so the
// dimensions never contradict each other.
export type SensorGeometry = FramingSensor

// Optical configuration of an imaging setup.
export interface OpticalConfiguration {
	// Native focal length of the telescope or lens in millimeters.
	readonly focalLength: number
	// Factor of a reducer (below 1) or Barlow (above 1) applied once to the native focal length; 1 without.
	readonly focalMultiplier: number
	// Aperture in millimeters, informative only; 0 when unknown.
	readonly aperture: number
	// Size of the sensor.
	readonly sensor: SensorGeometry
	// Position angle of the sensor's top edge in degrees, from north towards east, [0, 360).
	readonly rotation: number
}

// Field of view of an optical configuration.
export interface Framing {
	// Focal length with the reducer or Barlow applied, in millimeters.
	readonly effectiveFocalLength: number
	// Sensor width in millimeters.
	readonly sensorWidth: number
	// Sensor height in millimeters.
	readonly sensorHeight: number
	// Angular width in radians.
	readonly width: number
	// Angular height in radians.
	readonly height: number
	// Image scale in arcseconds per pixel; absent when the sensor is given by its physical size.
	readonly scale?: number
	// Focal ratio of the effective focal length; absent when the aperture is unknown.
	readonly focalRatio?: number
}

// Parameters of an optical configuration that are missing or invalid, by display name.
export interface MissingFraming {
	readonly missing: readonly string[]
}

// Equatorial coordinates in radians.
export interface FramePoint {
	// Right ascension in radians, [0, 2π).
	readonly rightAscension: number
	// Declination in radians, [-π/2, π/2].
	readonly declination: number
}

// Point of the tangent plane at a center: ξ towards east and η towards north, in units of the plane's distance.
export interface TangentPoint {
	// Eastward coordinate.
	readonly xi: number
	// Northward coordinate.
	readonly eta: number
}

// Telescope or lens of a profile's Equipment Setup, which no device reports.
export interface TelescopeOptics {
	// Native focal length in millimeters; 0 when not entered yet.
	readonly focalLength: number
	// Factor of a reducer (below 1) or Barlow (above 1) applied once to the native focal length; 1 without.
	readonly focalMultiplier: number
	// Aperture in millimeters, informative only; 0 when unknown.
	readonly aperture: number
	// Id of the telescope of the Equipment Catalog these optics refer to, whose declared aperture and focal length replace
	// the ones above (web/src/equipment/telescopes.ts); absent when entered by hand.
	readonly telescopeId?: string
}

// Telescope optics of a profile that has not entered any.
export const DEFAULT_TELESCOPE: TelescopeOptics = { focalLength: 0, focalMultiplier: 1, aperture: 0 }

// Telescope and guide telescope optics of a profile's Equipment Setup; each absent until entered.
export interface EquipmentTelescopes {
	// Optics of the Main Camera.
	readonly telescope?: TelescopeOptics
	// Optics of the Guide Camera; with an off-axis guider they repeat the telescope's.
	readonly guideTelescope?: TelescopeOptics
}

// Optical configuration of a new framing: a 600 mm telescope with an APS-C camera of 3.76 µm pixels.
export const DEFAULT_OPTICS: OpticalConfiguration = { focalLength: 600, focalMultiplier: 1, aperture: 0, sensor: { kind: 'pixels', width: 6248, height: 4176, pixelSize: 3.76 }, rotation: 0 }

// Whether a value is a finite positive number.
function positive(value: number) {
	return Number.isFinite(value) && value > 0
}

// Computes the field of view of an optical configuration, or lists what is missing to compute it. The
// angular size along each axis is 2·atan(d / 2F) for a sensor dimension d and effective focal length F.
export function resolveFraming(optics: OpticalConfiguration): Framing | MissingFraming {
	const { focalLength, focalMultiplier, sensor, aperture } = optics
	const missing: string[] = []

	if (!positive(focalLength)) missing.push('Focal length')
	if (!positive(focalMultiplier)) missing.push('Reducer / Barlow factor')
	if (!positive(sensor.width)) missing.push(sensor.kind === 'pixels' ? 'Width in pixels' : 'Sensor width')
	if (!positive(sensor.height)) missing.push(sensor.kind === 'pixels' ? 'Height in pixels' : 'Sensor height')
	if (sensor.kind === 'pixels' && !positive(sensor.pixelSize)) missing.push('Pixel size')
	if (missing.length > 0) return { missing }

	const effectiveFocalLength = focalLength * focalMultiplier
	const sensorWidth = sensor.kind === 'pixels' ? (sensor.width * sensor.pixelSize) / 1000 : sensor.width
	const sensorHeight = sensor.kind === 'pixels' ? (sensor.height * sensor.pixelSize) / 1000 : sensor.height

	return {
		effectiveFocalLength,
		sensorWidth,
		sensorHeight,
		width: sensorDiagonalFov(sensorWidth, effectiveFocalLength),
		height: sensorDiagonalFov(sensorHeight, effectiveFocalLength),
		scale: sensor.kind === 'pixels' ? pixelScale(sensor.pixelSize, effectiveFocalLength) : undefined,
		focalRatio: positive(aperture) ? effectiveFocalLength / aperture : undefined,
	}
}

// Whether a resolution is a computed field of view rather than a list of what is missing.
export function isFraming(value: Framing | MissingFraming): value is Framing {
	return !('missing' in value)
}

// Converts a point of the tangent plane at a center (right ascension ra0 in radians, and the sine and cosine of its
// declination) into equatorial coordinates in radians (inverse gnomonic projection).
export function fromTangentPlane(ra0: number, sinDec0: number, cosDec0: number, xi: number, eta: number): FramePoint {
	const rho = Math.hypot(xi, eta)
	const c = Math.atan(rho)
	const sinC = Math.sin(c)
	const cosC = Math.cos(c)
	const declination = rho === 0 ? Math.asin(sinDec0) : Math.asin(cosC * sinDec0 + (eta * sinC * cosDec0) / rho)
	const ra = ra0 + Math.atan2(xi * sinC, rho * cosDec0 * cosC - eta * sinDec0 * sinC)
	return { rightAscension: ((ra % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), declination }
}

// Projects equatorial coordinates (radians) on the tangent plane at a center (gnomonic projection); undefined for a point
// 90° or more from the center, which the plane cannot show.
export function toTangentPlane(center: FramePoint, point: FramePoint): TangentPoint | undefined {
	const sinDec0 = Math.sin(center.declination)
	const cosDec0 = Math.cos(center.declination)
	const sinDec = Math.sin(point.declination)
	const cosDec = Math.cos(point.declination)
	const deltaRa = point.rightAscension - center.rightAscension
	const cosDeltaRa = Math.cos(deltaRa)
	const cosC = sinDec0 * sinDec + cosDec0 * cosDec * cosDeltaRa
	if (!(cosC > 1e-9)) return undefined
	return { xi: (cosDec * Math.sin(deltaRa)) / cosC, eta: (cosDec0 * sinDec - sinDec0 * cosDec * cosDeltaRa) / cosC }
}

// Returns the closed outline of a sensor on the sky: `4 × samplesPerEdge + 1` points in radians, starting
// and ending at the top-left corner. The frame is centered at a right ascension and declination (radians)
// with an angular width and height (radians, below π) and a position angle (radians) of its top edge.
export function framePolygon(center: FramePoint, width: number, height: number, rotation: number, samplesPerEdge: number): FramePoint[] {
	const sinDec0 = Math.sin(center.declination)
	const cosDec0 = Math.cos(center.declination)
	return frameOutline(width, height, rotation, samplesPerEdge).map(({ xi, eta }) => fromTangentPlane(center.rightAscension, sinDec0, cosDec0, xi, eta))
}

// Returns the closed outline of a sensor on the tangent plane at its center: `4 × samplesPerEdge + 1` points, starting and
// ending at the top-left corner, for an angular width and height (radians, below π) and a position angle (radians) of its
// top edge. The sides are straight on the plane, so samplesPerEdge only matters once the outline leaves it.
export function frameOutline(width: number, height: number, rotation: number, samplesPerEdge: number): TangentPoint[] {
	const halfWidth = Math.tan(width / 2)
	const halfHeight = Math.tan(height / 2)
	// Directions of the sensor's top (+Y) and right (+X) on the tangent plane (east, north); with north up,
	// east is on the left of an image that is not mirrored, so +X points west at rotation 0.
	const upXi = Math.sin(rotation)
	const upEta = Math.cos(rotation)
	const rightXi = -Math.cos(rotation)
	const rightEta = Math.sin(rotation)
	const corners = [
		[-halfWidth, halfHeight],
		[halfWidth, halfHeight],
		[halfWidth, -halfHeight],
		[-halfWidth, -halfHeight],
	] as const
	const points: TangentPoint[] = []

	for (let i = 0; i < 4; i++) {
		const [x0, y0] = corners[i]
		const [x1, y1] = corners[(i + 1) % 4]

		for (let k = 0; k < samplesPerEdge; k++) {
			const t = k / samplesPerEdge
			const x = x0 + (x1 - x0) * t
			const y = y0 + (y1 - y0) * t
			points.push({ xi: x * rightXi + y * upXi, eta: x * rightEta + y * upEta })
		}
	}

	points.push(points[0])
	return points
}

// Returns the half extents, towards east and north on the tangent plane, of the box that holds a sensor of an angular
// width and height (radians, below π) turned by a position angle (radians) around its center.
export function frameHalfExtent(width: number, height: number, rotation: number): TangentPoint {
	const halfWidth = Math.tan(width / 2)
	const halfHeight = Math.tan(height / 2)
	const cos = Math.abs(Math.cos(rotation))
	const sin = Math.abs(Math.sin(rotation))
	return { xi: halfWidth * cos + halfHeight * sin, eta: halfWidth * sin + halfHeight * cos }
}
