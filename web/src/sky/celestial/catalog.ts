import { PIOVERTWO } from 'nebulosa/src/core/constants'
import { type NumberArray, clamp } from 'nebulosa/src/math/numerical/math'
import { normalizeAngle } from 'nebulosa/src/math/units/angle'
import { isFiniteNumber, writeRaDecUnitVector } from './geometry'
import type { CelestialObject, DeepSkyObject, MilkyWayCoordinates, MilkyWayLinearRingCoordinates, MilkyWayPolygonCoordinates, MilkyWayRing, MilkyWayStep, Star, StarCatalogInput, StarId, StarLayerOptions, ThemeOptions } from './types'

// Typed-array catalog storage for the star map: stars grouped into style buckets for batched drawing,
// deep-sky objects, and Milky Way outlines prepared as unit vectors. Each catalog also keeps the per-update
// projection results (base screen positions in pixels and visibility) that layers and picking read.

// Number of star radius buckets; higher refines magnitude sizing at more sprite cache work.
export const STAR_RADIUS_BUCKETS = 6

// Number of star B-V color buckets; higher refines colors at more sprite cache work.
export const STAR_COLOR_BUCKETS = 16

// Total number of star style buckets, one per radius and color pair.
export const STAR_STYLE_BUCKETS = STAR_RADIUS_BUCKETS * STAR_COLOR_BUCKETS

// Magnitude assigned to stars without one, faint enough to hide them by default.
const MISSING_MAGNITUDE = 99

// B-V index in magnitudes assigned to stars without one (a solar-type white).
const DEFAULT_BV = 0.65

// Star catalog normalized into typed arrays.
interface NormalizedStarInput {
	// Number of stars.
	readonly count: number
	// Right ascension of each star in radians [0, 2π).
	readonly ra: Float32Array
	// Declination of each star in radians [-π/2, π/2].
	readonly dec: Float32Array
	// Visual magnitude of each star.
	readonly mag: Float32Array
	// B-V index of each star in magnitudes, when any star has one.
	readonly bv?: Float32Array
	// Proper name of each star.
	readonly names: readonly string[]
	// Catalog identifier of each star.
	readonly ids: readonly StarId[]
}

// High-performance star catalog storage with per-update projection results.
export class StarCatalog {
	// Right ascension of each star in radians [0, 2π).
	readonly ra: NumberArray
	// Declination of each star in radians [-π/2, π/2].
	readonly dec: NumberArray
	// Visual magnitude of each star.
	readonly mag: NumberArray
	// B-V index of each star in magnitudes.
	readonly bv?: NumberArray
	// Equatorial unit vector x component of each star.
	readonly eqX: NumberArray
	// Equatorial unit vector y component of each star.
	readonly eqY: NumberArray
	// Equatorial unit vector z component of each star.
	readonly eqZ: NumberArray
	// Base screen x of each visible star in pixels.
	readonly screenX: NumberArray
	// Base screen y of each visible star in pixels.
	readonly screenY: NumberArray
	// 1 when the star was projected in the last update, 0 otherwise.
	readonly visible: NumberArray
	// 1 when the star's label was drawn in the last render, 0 otherwise.
	readonly labelVisible: NumberArray
	// Proper name of each star.
	readonly names: readonly string[]
	// Catalog identifier of each star.
	readonly ids: readonly StarId[]
	// Indices of the named stars, so label scans skip unnamed rows.
	readonly namedIndices?: Int32Array
	// Number of stars.
	readonly count: number

	// Style bucket of each star (color bucket × radius buckets + radius bucket).
	private readonly styleBucket: Uint16Array
	// Indices of the stars projected in the last update, in catalog order.
	private readonly visibleIndices: NumberArray
	// Indices of the projected stars grouped contiguously by style bucket.
	private readonly bucketedVisibleIndices: NumberArray
	// Indices of the stars whose labels were drawn in the last render.
	private readonly labelVisibleIndices: NumberArray
	// Number of projected stars per style bucket.
	private readonly bucketCounts = new Int32Array(STAR_STYLE_BUCKETS)
	// Start offset of each style bucket in bucketedVisibleIndices, plus the end sentinel.
	private readonly bucketStarts = new Int32Array(STAR_STYLE_BUCKETS + 1)
	// Write cursor of each style bucket while grouping.
	private readonly bucketWriteOffsets = new Int32Array(STAR_STYLE_BUCKETS)

	// Number of stars projected in the last update.
	visibleCount = 0
	// Number of star labels drawn in the last render.
	labelVisibleCount = 0

	// Scratch unit vector used while refreshing equatorial vectors.
	private static readonly EQUATORIAL_VECTOR = new Float32Array(3)

	// Builds the catalog from object-array or typed-array input; invalid coordinates become 0, missing
	// magnitudes 99.
	constructor(input: readonly Star[] | StarCatalogInput) {
		const data = normalizeStarInput(input)
		this.count = data.count
		this.ra = data.ra
		this.dec = data.dec
		this.mag = data.mag
		this.bv = data.bv
		this.names = data.names
		this.ids = data.ids
		this.namedIndices = collectNamedIndices(data.names, data.count)
		this.eqX = new Float32Array(this.count)
		this.eqY = new Float32Array(this.count)
		this.eqZ = new Float32Array(this.count)
		this.screenX = new Float32Array(this.count)
		this.screenY = new Float32Array(this.count)
		this.visible = new Uint8Array(this.count)
		this.labelVisible = new Uint8Array(this.count)
		this.styleBucket = new Uint16Array(this.count)
		this.visibleIndices = new Int32Array(this.count)
		this.bucketedVisibleIndices = new Int32Array(this.count)
		this.labelVisibleIndices = new Int32Array(this.count)
		this.updateEquatorialVectors()
	}

	// Recomputes the equatorial unit vectors from the stored coordinates.
	updateEquatorialVectors() {
		const vector = StarCatalog.EQUATORIAL_VECTOR
		const ras = this.ra
		const decs = this.dec
		const eqX = this.eqX
		const eqY = this.eqY
		const eqZ = this.eqZ

		for (let i = 0; i < this.count; i++) {
			writeRaDecUnitVector(ras[i], decs[i], vector)
			eqX[i] = vector[0]
			eqY[i] = vector[1]
			eqZ[i] = vector[2]
		}
	}

	// Recomputes each star's style bucket from its magnitude and B-V index, outside the draw loop.
	cacheStyleBuckets(options: Required<StarLayerOptions>, theme: ThemeOptions) {
		const minMag = theme.stars.magnitudeScale[0]
		const maxMag = theme.stars.magnitudeScale[1]
		const magRange = Math.max(0.01, maxMag - minMag)

		for (let i = 0; i < this.count; i++) {
			const mag = this.mag[i]
			const brightness = 1 - clamp((mag - minMag) / magRange, 0, 1)
			const radiusBucket = options.sizeByMagnitude ? clamp(Math.floor(brightness * STAR_RADIUS_BUCKETS), 0, STAR_RADIUS_BUCKETS - 1) : Math.floor(STAR_RADIUS_BUCKETS / 2)
			const bv = this.bv?.[i] ?? DEFAULT_BV
			const colorBucket = options.colorByBV ? clamp(Math.floor(((clamp(bv, -0.4, 2) + 0.4) / 2.4) * STAR_COLOR_BUCKETS), 0, STAR_COLOR_BUCKETS - 1) : Math.floor(STAR_COLOR_BUCKETS / 2)
			this.styleBucket[i] = colorBucket * STAR_RADIUS_BUCKETS + radiusBucket
		}
	}

	// Clears the projection results before a projection pass.
	beginProjection() {
		this.visible.fill(0)
		this.bucketCounts.fill(0)
		this.visibleCount = 0
	}

	// Records a star projected to the base screen position (x, y) in pixels.
	recordVisible(index: number, x: number, y: number) {
		this.visible[index] = 1
		this.screenX[index] = x
		this.screenY[index] = y
		this.visibleIndices[this.visibleCount++] = index
		this.bucketCounts[this.styleBucket[index]]++
	}

	// Clears the label flags of the previous render.
	beginLabelRender() {
		for (let i = 0; i < this.labelVisibleCount; i++) {
			this.labelVisible[this.labelVisibleIndices[i]] = 0
		}

		this.labelVisibleCount = 0
	}

	// Records that a star's label was drawn.
	recordLabelVisible(index: number) {
		if (this.labelVisible[index]) return

		this.labelVisible[index] = 1
		this.labelVisibleIndices[this.labelVisibleCount++] = index
	}

	// Groups the projected stars contiguously by style bucket so drawing changes style once per bucket.
	finalizeProjectionBuckets() {
		let cursor = 0

		for (let bucket = 0; bucket < STAR_STYLE_BUCKETS; bucket++) {
			this.bucketStarts[bucket] = cursor
			cursor += this.bucketCounts[bucket]
		}

		this.bucketStarts[STAR_STYLE_BUCKETS] = cursor

		for (let bucket = 0; bucket < STAR_STYLE_BUCKETS; bucket++) {
			this.bucketWriteOffsets[bucket] = this.bucketStarts[bucket]
		}

		for (let i = 0; i < this.visibleCount; i++) {
			const index = this.visibleIndices[i]
			const bucket = this.styleBucket[index]
			this.bucketedVisibleIndices[this.bucketWriteOffsets[bucket]++] = index
		}
	}

	// Returns how many projected stars of at most maxMagnitude fall inside bounds, the base screen rectangle
	// [minX, maxX, minY, maxY] in pixels of writeBaseViewportBounds, and so are drawn; stops counting past `limit`,
	// which is returned as limit + 1.
	countDrawn(maxMagnitude: number, bounds: NumberArray, limit: number) {
		let drawn = 0

		for (let i = 0; i < this.visibleCount; i++) {
			const index = this.visibleIndices[i]
			const x = this.screenX[index]
			const y = this.screenY[index]

			if (this.mag[index] > maxMagnitude || x < bounds[0] || x > bounds[1] || y < bounds[2] || y > bounds[3]) {
				continue
			}

			if (++drawn > limit) {
				break
			}
		}

		return drawn
	}

	// Returns the picked-object payload of a star.
	getObject(index: number): CelestialObject {
		return {
			type: 'star',
			index,
			id: this.ids[index],
			name: this.names[index],
			mag: this.mag[index],
			rightAscension: this.ra[index],
			declination: this.dec[index],
		}
	}

	// Returns the projected star indices grouped by style bucket, without copying.
	getBucketedVisibleIndices() {
		return this.bucketedVisibleIndices
	}

	// Returns the start offset of a style bucket in the grouped indices.
	getBucketStart(bucket: number) {
		return this.bucketStarts[bucket]
	}

	// Returns the end offset (exclusive) of a style bucket in the grouped indices.
	getBucketEnd(bucket: number) {
		return this.bucketStarts[bucket + 1]
	}
}

// Deep-sky catalog storage with per-update projection results.
export class DeepSkyCatalog {
	// Number of objects.
	readonly count: number
	// Equatorial unit vector x component of each object.
	readonly eqX: Float32Array
	// Equatorial unit vector y component of each object.
	readonly eqY: Float32Array
	// Equatorial unit vector z component of each object.
	readonly eqZ: Float32Array
	// Base screen x of each visible object in pixels.
	readonly screenX: Float32Array
	// Base screen y of each visible object in pixels.
	readonly screenY: Float32Array
	// 1 when the object was projected in the last update, 0 otherwise.
	readonly visible: Uint8Array
	// Indices of the objects projected in the last update.
	readonly visibleIndices: Int32Array
	// 1 when the object's label was drawn in the last render, 0 otherwise.
	readonly labelVisible: Uint8Array
	// Indices of the objects whose labels were drawn in the last render.
	private readonly labelVisibleIndices: Int32Array
	// Number of objects projected in the last update.
	visibleCount = 0
	// Number of object labels drawn in the last render.
	private labelVisibleCount = 0

	// Builds the catalog over caller-owned objects, which may later be mutated and refreshed.
	constructor(readonly objects: readonly DeepSkyObject[]) {
		this.count = objects.length
		this.eqX = new Float32Array(this.count)
		this.eqY = new Float32Array(this.count)
		this.eqZ = new Float32Array(this.count)
		this.screenX = new Float32Array(this.count)
		this.screenY = new Float32Array(this.count)
		this.visible = new Uint8Array(this.count)
		this.visibleIndices = new Int32Array(this.count)
		this.labelVisible = new Uint8Array(this.count)
		this.labelVisibleIndices = new Int32Array(this.count)
		this.refreshEquatorialVectors()
	}

	// Recomputes the equatorial unit vectors of one object, or of every object when no index is given.
	refreshEquatorialVectors(index?: number) {
		const start = index ?? 0
		const end = index === undefined ? this.count : index + 1
		const vector = new Float32Array(3)

		for (let i = start; i < end; i++) {
			const object = this.objects[i]
			writeRaDecUnitVector(object.rightAscension, object.declination, vector)
			this.eqX[i] = vector[0]
			this.eqY[i] = vector[1]
			this.eqZ[i] = vector[2]
		}
	}

	// Clears the projection results before a projection pass.
	beginProjection() {
		this.visible.fill(0)
		this.visibleCount = 0
	}

	// Records an object projected to the base screen position (x, y) in pixels.
	recordVisible(index: number, x: number, y: number) {
		this.visible[index] = 1
		this.screenX[index] = x
		this.screenY[index] = y
		this.visibleIndices[this.visibleCount++] = index
	}

	// Clears the label flags of the previous render.
	beginLabelRender() {
		for (let i = 0; i < this.labelVisibleCount; i++) {
			this.labelVisible[this.labelVisibleIndices[i]] = 0
		}

		this.labelVisibleCount = 0
	}

	// Records that an object's label was drawn.
	recordLabelVisible(index: number) {
		if (this.labelVisible[index]) return

		this.labelVisible[index] = 1
		this.labelVisibleIndices[this.labelVisibleCount++] = index
	}
}

// Normalizes object-array and typed-array star inputs into typed arrays, normalizing right ascension to
// [0, 2π) and clamping declination to [-π/2, π/2].
function normalizeStarInput(input: readonly Star[] | StarCatalogInput): NormalizedStarInput {
	if ('ra' in input) {
		const count = Math.min(input.count ?? input.ra.length, input.ra.length, input.dec.length)
		const ra = copyFloat32(input.ra, count, 0, normalizeAngle)
		const dec = copyFloat32(input.dec, count, 0, (value) => clamp(value, -PIOVERTWO, PIOVERTWO))
		const mag = input.mag ? copyFloat32(input.mag, count, MISSING_MAGNITUDE) : new Float32Array(count).fill(MISSING_MAGNITUDE)
		const bv = input.bv?.length ? copyFloat32(input.bv, count, DEFAULT_BV) : undefined

		return { count, ra, dec, mag, bv, names: input.names, ids: input.ids }
	}

	const count = input.length
	const ra = new Float32Array(count)
	const dec = new Float32Array(count)
	const mag = new Float32Array(count)
	let bv: Float32Array | undefined
	const names: string[] = []
	const ids: StarId[] = []
	let hasNames = false
	let hasIds = false

	for (let i = 0; i < count; i++) {
		const star = input[i]

		ra[i] = normalizeAngle(isFiniteNumber(star.rightAscension) ? star.rightAscension : 0)
		dec[i] = clamp(isFiniteNumber(star.declination) ? star.declination : 0, -PIOVERTWO, PIOVERTWO)
		mag[i] = isFiniteNumber(star.magnitude) ? star.magnitude : MISSING_MAGNITUDE

		if (isFiniteNumber(star.bv)) {
			bv ??= new Float32Array(count)
			bv[i] = star.bv
		}

		if (star.name) {
			names[i] = star.name
			hasNames = true
		}

		if (star.id) {
			ids[i] = star.id
			hasIds = true
		}
	}

	return { count, ra, dec, mag, bv, names: hasNames ? names : [], ids: hasIds ? ids : [] }
}

// Returns the indices of the stars that have a name, in catalog order.
function collectNamedIndices(names: readonly string[], count: number) {
	let namedCount = 0

	for (let i = 0; i < count; i++) {
		if (names[i]) {
			namedCount++
		}
	}

	const indices = new Int32Array(namedCount)
	let cursor = 0

	for (let i = 0; i < count; i++) {
		if (names[i]) {
			indices[cursor++] = i
		}
	}

	return indices
}

// Copies the first `count` values into a Float32Array, mapping finite values and replacing the others by
// `fallback`.
function copyFloat32(source: NumberArray, count: number, fallback: number, map?: (value: number) => number) {
	const output = new Float32Array(count)

	for (let i = 0; i < count; i++) {
		const value = source[i]
		output[i] = isFiniteNumber(value) ? (map ? map(value) : value) : fallback
	}

	return output
}

// Prepares Milky Way levels for projection, dropping polygons without drawable rings.
export function normalizeMilkyWayCoordinates(coordinates: MilkyWayCoordinates): MilkyWayStep[] {
	const steps: MilkyWayStep[] = []

	for (let i = 0; i < coordinates.length; i++) {
		const rings = normalizeMilkyWayPolygon(coordinates[i])
		if (rings.length > 0) steps.push({ rings })
	}

	return steps
}

// Prepares the rings of one Milky Way polygon, dropping degenerate ones.
function normalizeMilkyWayPolygon(polygon: MilkyWayPolygonCoordinates): MilkyWayRing[] {
	const rings: MilkyWayRing[] = []

	for (let i = 0; i < polygon.length; i++) {
		const ring = normalizeMilkyWayRing(polygon[i])
		if (ring) rings.push(ring)
	}

	return rings
}

// Converts a ring into unit vectors, removing a closing vertex that repeats the first one; returns null for
// rings with fewer than two distinct vertices.
function normalizeMilkyWayRing(ring: MilkyWayLinearRingCoordinates): MilkyWayRing | null {
	const n = ring.length
	const coordinates = new Float32Array(n * 2)
	const vectors = new Float32Array(n * 3)
	let pointCount = 0

	for (let i = 0; i < n; i++) {
		const [ra, dec] = ring[i]
		coordinates[pointCount * 2] = ra
		coordinates[pointCount * 2 + 1] = dec
		writeRaDecUnitVector(ra, dec, vectors, pointCount * 3)
		pointCount++
	}

	const closed = pointCount > 2 && milkyWayRingPointMatches(coordinates, 0, pointCount - 1)

	if (closed) {
		pointCount--
	}

	if (pointCount < 2) return null

	return { vectors: vectors.subarray(0, pointCount * 3), pointCount, closed }
}

// Returns whether two ring vertices coincide within 1e-7 radians.
function milkyWayRingPointMatches(coordinates: Float32Array, a: number, b: number) {
	const ai = a * 2
	const bi = b * 2
	return Math.abs(coordinates[ai] - coordinates[bi]) <= 1e-7 && Math.abs(coordinates[ai + 1] - coordinates[bi + 1]) <= 1e-7
}
