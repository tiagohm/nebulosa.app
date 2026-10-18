import { DEG2RAD, PIOVERTWO } from 'nebulosa/src/core/constants'
import { type NumberArray, clamp } from 'nebulosa/src/math/numerical/math'
import { localSiderealTime } from './time'
import type { ObserverLocation, ProjectionType, ViewTransform } from './types'

// Allocation-free spherical geometry of the star map: unit vectors, the equatorial-to-horizontal rotation,
// view matrices, the azimuthal projections and their inverses, and screen transforms. Vectors and matrices
// are written into caller-provided arrays; 3x3 matrices are row-major. Angles are radians and screen values
// are pixels.

// Altitude tolerance (sine) for horizon visibility; higher hides near-horizon geometry sooner, lower shows
// floating-point noise.
export const HORIZON_EPSILON = 1e-7

// Declination tolerance in radians for the pole singularity; higher merges points near the poles sooner.
const POLE_EPSILON = 1e-10

// Screen padding in pixels around finite projection disks; higher shrinks the sky disk.
const PROJECTION_PADDING = 10

// Scratch storage for writeViewMatrix: the forward vector then the right vector.
const WRITE_VIEW_MATRIX_WORK = new Float32Array(6)

// Returns whether a value is a finite number.
export function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

// Writes the unit vector of a right ascension and declination (radians) at `out[offset..offset+2]`.
export function writeRaDecUnitVector(ra: number, dec: number, out: NumberArray, offset = 0) {
	if (Math.abs(Math.abs(dec) - PIOVERTWO) <= POLE_EPSILON) {
		out[offset] = 0
		out[offset + 1] = 0
		out[offset + 2] = dec < 0 ? -1 : 1
		return
	}

	const cosDec = Math.cos(dec)
	out[offset] = cosDec * Math.cos(ra)
	out[offset + 1] = cosDec * Math.sin(ra)
	out[offset + 2] = Math.sin(dec)
}

// Writes the unit vector of an azimuth (north 0, east π/2) and altitude in radians at `out[offset..offset+2]`,
// with x east, y north, and z toward the zenith.
export function writeHorizontalUnitVector(az: number, alt: number, out: NumberArray, offset = 0) {
	const cosAlt = Math.cos(alt)
	out[offset] = cosAlt * Math.sin(az)
	out[offset + 1] = cosAlt * Math.cos(az)
	out[offset + 2] = Math.sin(alt)
}

// Writes the row-major matrix rotating equatorial-of-date unit vectors into horizontal unit vectors for a Unix
// time in milliseconds (UTC) and an observer.
export function writeEquatorialToHorizontalMatrix(time: number, observer: ObserverLocation, out: NumberArray) {
	const lst = localSiderealTime(time, observer.longitude * DEG2RAD)
	const lat = observer.latitude * DEG2RAD
	const sinLst = Math.sin(lst)
	const cosLst = Math.cos(lst)
	const sinLat = Math.sin(lat)
	const cosLat = Math.cos(lat)

	out[0] = -sinLst
	out[1] = cosLst
	out[2] = 0
	out[3] = -sinLat * cosLst
	out[4] = -sinLat * sinLst
	out[5] = cosLat
	out[6] = cosLat * cosLst
	out[7] = cosLat * sinLst
	out[8] = sinLat
}

// Writes a row-major 3x3 matrix times the vector (x, y, z) at `out[offset..offset+2]`.
export function multiplyMatrixVector(matrix: Float64Array, x: number, y: number, z: number, out: NumberArray, offset = 0) {
	out[offset] = matrix[0] * x + matrix[1] * y + matrix[2] * z
	out[offset + 1] = matrix[3] * x + matrix[4] * y + matrix[5] * z
	out[offset + 2] = matrix[6] * x + matrix[7] * y + matrix[8] * z
}

// Normalizes the vector at `out[offset..offset+2]` in place; returns false, leaving it unchanged, when its
// length is nearly zero.
export function normalizeVector(out: NumberArray, offset = 0): boolean {
	const x = out[offset]
	const y = out[offset + 1]
	const z = out[offset + 2]
	const length = Math.hypot(x, y, z)

	if (length <= 1e-12) return false

	out[offset] = x / length
	out[offset + 1] = y / length
	out[offset + 2] = z / length
	return true
}

// Writes the cross product a × b at `out[offset..offset+2]`.
function writeCross(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: NumberArray, offset = 0) {
	out[offset] = ay * bz - az * by
	out[offset + 1] = az * bx - ax * bz
	out[offset + 2] = ax * by - ay * bx
}

// Returns the angle in radians [0, π] between two unit vectors.
export function angularDistance(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
	return Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1))
}

// Writes the row-major view matrix whose rows are the right, up, and forward axes for a view centered on
// `center` and oriented by the stable `referenceUp` vector.
export function writeViewMatrix(center: NumberArray, referenceUp: NumberArray, out: NumberArray) {
	const work = WRITE_VIEW_MATRIX_WORK

	work[0] = center[0]
	work[1] = center[1]
	work[2] = center[2]

	if (!normalizeVector(work)) {
		work[0] = 0
		work[1] = 0
		work[2] = 1
	}

	writeCross(referenceUp[0], referenceUp[1], referenceUp[2], work[0], work[1], work[2], work, 3)

	if (!normalizeVector(work, 3)) {
		writeCross(1, 0, 0, work[0], work[1], work[2], work, 3)
		normalizeVector(work, 3)
	}

	writeCross(work[0], work[1], work[2], work[3], work[4], work[5], out, 3)
	normalizeVector(out, 3)

	out[0] = work[3]
	out[1] = work[4]
	out[2] = work[5]
	out[6] = work[0]
	out[7] = work[1]
	out[8] = work[2]
}

// Returns whether a projection maps the visible hemisphere onto a finite disk.
export function isFiniteDiskProjection(projection: ProjectionType): boolean {
	return projection !== 'gnomonic'
}

// Projects a view-space unit vector (z toward the view center) into normalized plane coordinates at
// `out[0..1]`, where the finite disk projections reach radius 1 at 90° from the center; returns false when the
// vector is not projectable.
export function projectViewVector(type: ProjectionType, x: number, y: number, z: number, out: NumberArray) {
	const visibleZ = Math.max(0, z)

	switch (type) {
		case 'azimuthalEquidistant': {
			if (z < -HORIZON_EPSILON) {
				return false
			}

			const theta = Math.acos(clamp(visibleZ, -1, 1))

			if (theta <= 1e-9) {
				out[0] = 0
				out[1] = 0
				return true
			}

			const sinTheta = Math.sin(theta)

			if (Math.abs(sinTheta) <= 1e-9) {
				return false
			}

			const k = theta / (PIOVERTWO * sinTheta)
			out[0] = x * k
			out[1] = y * k
			return true
		}
		case 'azimuthalEqualArea': {
			if (z < -HORIZON_EPSILON) {
				return false
			}

			const k = 1 / Math.sqrt(1 + visibleZ)
			out[0] = x * k
			out[1] = y * k
			return true
		}
		case 'orthographic': {
			if (z < -HORIZON_EPSILON) {
				return false
			}

			out[0] = x
			out[1] = y
			return true
		}
		case 'stereographic': {
			if (z < -HORIZON_EPSILON) {
				return false
			}

			const d = 1 + visibleZ

			if (d <= 1e-9) {
				return false
			}

			const k = 1 / d
			out[0] = x * k
			out[1] = y * k
			return true
		}
		case 'gnomonic': {
			if (z <= 0.02) {
				return false
			}

			out[0] = x / z
			out[1] = y / z
			return Math.abs(out[0]) < 8 && Math.abs(out[1]) < 8
		}
	}
}

// Inverts normalized projection-plane coordinates into a view-space unit vector at `out[0..2]`; returns false
// outside the projection domain.
export function unprojectViewVector(type: ProjectionType, x: number, y: number, out: NumberArray) {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return false

	let px = x
	let py = y
	let rho = Math.hypot(px, py)

	if (isFiniteDiskProjection(type)) {
		if (rho > 1 + HORIZON_EPSILON) {
			return false
		}

		if (rho > 1) {
			px /= rho
			py /= rho
			rho = 1
		}
	}

	if (rho <= 1e-12) {
		out[0] = 0
		out[1] = 0
		out[2] = 1
		return true
	}

	switch (type) {
		case 'azimuthalEquidistant': {
			const theta = rho * PIOVERTWO
			const k = Math.sin(theta) / rho
			out[0] = px * k
			out[1] = py * k
			out[2] = Math.cos(theta)
			return true
		}
		case 'azimuthalEqualArea': {
			const z = 1 - rho * rho
			const k = Math.sqrt(Math.max(0, 1 + z))
			out[0] = px * k
			out[1] = py * k
			out[2] = z
			return true
		}
		case 'orthographic':
			out[0] = px
			out[1] = py
			out[2] = Math.sqrt(Math.max(0, 1 - rho * rho))
			return true
		case 'stereographic': {
			const d = 1 + rho * rho
			out[0] = (2 * px) / d
			out[1] = (2 * py) / d
			out[2] = (1 - rho * rho) / d
			return true
		}
		case 'gnomonic': {
			out[0] = px
			out[1] = py
			out[2] = 1
			return normalizeVector(out)
		}
	}
}

// Writes the transformed screen position of a base screen position (pixels) at `out[0..1]`.
export function applyViewTransform(x: number, y: number, width: number, height: number, transform: Readonly<ViewTransform>, out: NumberArray) {
	out[0] = width / 2 + transform.x + (x - width / 2) * transform.k
	out[1] = height / 2 + transform.y + (y - height / 2) * transform.k
}

// Writes the viewport, grown by `margin` screen pixels, in base screen coordinates as [minX, maxX, minY, maxY]
// for cheap point culling.
export function writeBaseViewportBounds(width: number, height: number, transform: Readonly<ViewTransform>, margin: number, out: NumberArray) {
	const inverseScale = 1 / transform.k
	const centerX = width / 2
	const centerY = height / 2
	out[0] = centerX + (-margin - centerX - transform.x) * inverseScale
	out[1] = centerX + (width + margin - centerX - transform.x) * inverseScale
	out[2] = centerY + (-margin - centerY - transform.y) * inverseScale
	out[3] = centerY + (height + margin - centerY - transform.y) * inverseScale
}

// Returns whether a screen position lies inside the viewport grown by `margin` pixels.
export function isPointInsideViewportMargin(x: number, y: number, width: number, height: number, margin: number) {
	return x >= -margin && x <= width + margin && y >= -margin && y <= height + margin
}

// Returns the pixels per normalized projection unit: the disk radius of finite projections, or a fixed
// fraction of the canvas for the gnomonic projection.
export function projectionScale(width: number, height: number, projection: ProjectionType) {
	const size = Math.min(width, height)

	switch (projection) {
		case 'stereographic':
		case 'azimuthalEqualArea':
		case 'azimuthalEquidistant':
		case 'orthographic':
			return Math.max(1, size / 2 - PROJECTION_PADDING)
		case 'gnomonic':
			return size * 0.2
	}
}
