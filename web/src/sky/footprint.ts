import { eraC2s, eraS2c } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { precessionNutationMatrix, timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { type Mat3, matMulVec } from 'nebulosa/src/math/linear-algebra/mat3'
import type { MutVec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { normalizeAngle } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { skyAt, type WcsFrame } from '../platesolving/wcs'
import type { Size } from '../viewer/transform'

// Handoffs from a solved image to the Sky map: a coordinate to mark and pan to, and the footprint of the image, the
// outline its WCS gives to its sampled borders. Both are kept in the ICRS or FK5 J2000 frame of the solution (taken
// as J2000 for the conversion, which they match within 0.03″) and converted for the map to the true equator and
// equinox of the instant its catalogs were computed for, with the same IAU 2006/2000A precession-nutation matrix of
// the toolkit as the catalogs of api/src/sky/catalog.ts, so they line up with the stars drawn: the matrix is computed
// once per map data, never per tick, and no request is made. The map is only panned onto a coordinate, never
// reprojected around it. A footprint belongs to the image it was taken from and is dropped when that image is no
// longer shown by its document; the coordinate stays until cleared or replaced. Tab memory only.

// Points sampled along each border of an image for its footprint.
const FOOTPRINT_EDGE_SAMPLES = 24

// Sky position in radians: [right ascension, declination].
export type SkyPoint = readonly [number, number]

// Coordinate to mark on the Sky map and pan to.
export interface SkyCoordinateIntent {
	// Increasing number of the request; the latest one is applied once.
	readonly seq: number
	// Right ascension at J2000 (ICRS), radians.
	readonly rightAscension: number
	// Declination at J2000 (ICRS), radians.
	readonly declination: number
	// Name drawn beside the mark.
	readonly label: string
	// Whether a mark is drawn, or only the view panned.
	readonly mark: boolean
}

// Footprint of a solved image on the sky.
export interface ImageFootprint {
	// Key of the document the image was shown in.
	readonly documentKey: string
	// Id of the image.
	readonly imageId: string
	// Name drawn beside the outline.
	readonly name: string
	// Frame of the solution.
	readonly frame: WcsFrame
	// Sky position of the centre of the image, J2000 (ICRS), radians.
	readonly center: SkyPoint
	// Border of the image, clockwise from its top-left corner and closed, J2000 (ICRS), radians; undefined where the
	// WCS cannot unproject, which breaks the outline.
	readonly outline: readonly (SkyPoint | undefined)[]
}

// Handoffs of the tab to the Sky map.
export interface SkyImageState {
	// Coordinate requested last.
	intent?: SkyCoordinateIntent
	// Footprint shown.
	footprint?: ImageFootprint
}

// Handoffs of the tab to the Sky map.
export const skyImageState = proxy<SkyImageState>({})

// Asks the Sky map to mark a J2000 position (radians) with a label and pan to it.
export function showCoordinateInSky(state: SkyImageState, [rightAscension, declination]: SkyPoint, label: string, mark: boolean = true) {
	state.intent = { seq: (state.intent?.seq ?? 0) + 1, rightAscension, declination, label, mark }
}

// Shows the footprint of an image on the Sky map, replacing the previous one, and pans to its centre.
export function showFootprintInSky(state: SkyImageState, footprint: ImageFootprint) {
	state.footprint = footprint
	showCoordinateInSky(state, footprint.center, footprint.name, false)
}

// Hides the footprint.
export function clearImageFootprint(state: SkyImageState) {
	state.footprint = undefined
}

// Removes the mark of the coordinate requested last.
export function clearSkyCoordinate(state: SkyImageState) {
	if (state.intent) state.intent = { ...state.intent, mark: false }
}

// Returns the footprint of an image of a size through its solution: its centre and its four borders sampled at
// FOOTPRINT_EDGE_SAMPLES points each, clockwise from the top-left corner, in viewer pixels unprojected through the WCS;
// undefined when its centre cannot be unprojected.
export function imageFootprint(solution: FitsHeader, frame: WcsFrame, image: Size, documentKey: string, imageId: string, name: string): ImageFootprint | undefined {
	const center = skyAt(solution, { x: image.width / 2, y: image.height / 2 })
	if (!center) return undefined

	const { width, height } = image
	const outline: (SkyPoint | undefined)[] = []
	const edges = [(t: number) => ({ x: t * width, y: 0 }), (t: number) => ({ x: width, y: t * height }), (t: number) => ({ x: (1 - t) * width, y: height }), (t: number) => ({ x: 0, y: (1 - t) * height })]

	for (const edge of edges) for (let i = 0; i < FOOTPRINT_EDGE_SAMPLES; i++) outline.push(skyAt(solution, edge(i / FOOTPRINT_EDGE_SAMPLES)))
	outline.push(outline[0])
	return { documentKey, imageId, name, frame, center, outline }
}

// Returns the conversion from J2000 (ICRS) to the true equator and equinox of an instant (Unix milliseconds, UTC): the
// toolkit's precession-nutation matrix, the one the Sky catalogs are precessed with.
export function ofDateMatrix(time: number): Mat3 {
	return precessionNutationMatrix(timeUnix(time / 1000, true))
}

// Returns a J2000 position (radians) on the true equator and equinox of the instant of a matrix of ofDateMatrix, right
// ascension in [0, 2π).
export function toDate(matrix: Mat3, [rightAscension, declination]: SkyPoint): SkyPoint {
	const vector: MutVec3 = [0, 0, 0]
	const [x, y, z] = matMulVec(matrix, eraS2c(rightAscension, declination, vector), vector)
	const [ra, dec] = eraC2s(x, y, z)
	return [normalizeAngle(ra), dec]
}
