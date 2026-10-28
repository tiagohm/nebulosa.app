import { coneSearch, GEOCENTER, SKYBOT_MAX_EPOCH, SKYBOT_MAX_RADIUS, SKYBOT_MIN_EPOCH, type SkybotObject } from 'nebulosa/src/adapters/orbits/skybot'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { tanProject, tanUnproject } from 'nebulosa/src/astrometry/wcs/fits.wcs'
import { geocentricToTopocentric } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { eraS2c } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import type { GeographicPosition } from 'nebulosa/src/astronomy/observer/location'
import { type FitsLocationSource, readFitsTime } from 'nebulosa/src/astronomy/time/fits'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { hasKeyword, parseFitsDateTimeFields, textKeyword } from 'nebulosa/src/io/formats/fits/util'
import { vecAngle } from 'nebulosa/src/math/linear-algebra/vec3'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { toMeter } from 'nebulosa/src/math/units/distance'
import { type AnalysisCompletion, type AnalysisEntry, type AnalysisJob, type AnalysisJobState, AnalysisScheduler } from './analysis'
import { errorResponse } from './http'
import type { ImageStore } from './images'
import type { PlateSolvingService } from './platesolving'
import { SOLAR_SYSTEM_BODIES } from './sky/bodies'
import type { FieldConstellations, FieldObject, FieldObjects, FieldQuery } from './sky/catalog'
import type { SkyObserver, SkyPosition } from './sky/ephemeris'
import type { SkyObjectRef, SolarSystemBodyCode } from './sky/types'

// Annotation service of the Images workspace: identifies what an image shows from its WCS, never from its pixels. A job
// unprojects the border of an image document of the image store, addressed by its id, through one WCS frozen when the
// job is submitted (the header's own, or the solution of a completed plate solving job of the same image named by the
// request) into a cone of the sky, queries the embedded sky catalog for the stars, deep-sky objects, and constellation
// figures in it, and keeps those whose position (or, for a deep-sky object, any part of its major axis) projects onto
// the image. When the observation instant is known, the stars are moved there by their proper motion, and the Sun, the
// Moon, the planets, and Pluto are added from the local ephemeris, seen from the requested observer or else from the
// Earth's center. Positions are astrometric, on the ICRS (J2000) equator of a plate solution, never apparent of date.
// Nothing is solved implicitly, no network is queried, and the current time is never used for an image.
//
// A minor-body job (kind minorBodies) is a separate, explicit request: it asks the IMCCE SkyBoT cone search (the
// toolkit's coneSearch) for the known asteroids and comets of the same cone at the observation instant, from the Earth's
// center, under a time budget and its own concurrency, so a slow or failed search never delays nor changes the local
// annotation. SkyBoT takes an observatory code only, so when the header locates the image (OBSGEO-* or SITELAT/SITELONG/
// SITEELEV) its geocentric positions are moved by the parallax of that site (geocentricToTopocentric), and each position
// says whether it is geocentric or so corrected. Its positions are SkyBoT's astrometric J2000 predictions, never
// detections in the pixels.
//
// The observation instant is the request's own, or else the middle of the exposure from the raw DATE-OBS of the header
// (or DATE-END, when the exposure is known) and its exposure duration (EXPTIME or EXPOSURE); FITS dates are UTC.
//
// Jobs run in memory under the shared analysis scheduling (analysis.ts): one annotation at a time, at most MAX_QUEUED
// jobs waiting. A job retains its image until it ends. An equivalent request (same image, WCS, magnitude limit, instant,
// and observer) still waiting or running, or completed with its result kept, is answered instead of running again.
// Results are kept only in memory, keyed by job and grouped by image, until their image is released or the bounded
// store evicts them; a result carries the WCS it was computed with, so the client projects it with the same one. Every
// change of a job is published as a compact annotations:updated event without the objects, which are fetched on demand.

// What a job annotates: the local catalog and ephemeris, or the minor bodies SkyBoT knows.
export type AnnotationKind = 'local' | 'minorBodies'

// What a job annotates and from which context.
export interface AnnotationRequest {
	// What is annotated.
	readonly kind: AnnotationKind
	// Completed plate solving job of the same image whose solution gives the WCS; absent uses the WCS of the image
	// header.
	readonly plateSolveJobId?: string
	// Faintest magnitude of the stars and deep-sky objects kept; deep-sky objects of a classic visual catalog are kept
	// without a magnitude.
	readonly magnitudeLimit: number
	// Instant of the observation, Unix milliseconds (UTC), taken as the middle of the exposure; absent uses the header.
	readonly time?: number
	// Observer of the solar-system bodies of a local job; absent sees them from the Earth's center. A minor-body job
	// ignores it: it sees the bodies from the site of the image header, or else from the Earth's center.
	readonly observer?: SkyObserver
}

// Group of an annotated object.
export type AnnotationLayer = 'star' | 'deepSky' | 'solarSystem' | 'minorBody'

// Position at the start and the end of the exposure of an object that moves during it, in radians (ICRS).
export interface AnnotationMotion {
	// [right ascension, declination] at the start of the exposure.
	readonly start: readonly [number, number]
	// [right ascension, declination] at its end.
	readonly end: readonly [number, number]
}

// An object in the field of an image.
export interface AnnotationObject {
	// Stable key of the object across jobs and providers, such as "catalog:1001879", "body:599", or "skybot:2003 QW37".
	readonly id: string
	// Identity of the object in the sky API; absent for a minor body, whose SPK-ID SkyBoT does not give.
	readonly ref?: SkyObjectRef
	// Group of the object.
	readonly layer: AnnotationLayer
	// Display name: the proper name or the preferred designation.
	readonly name: string
	// Every other designation, most relevant first.
	readonly designations: readonly string[]
	// Object type, such as "Galaxy" or "Planet".
	readonly typeName: string
	// Visual magnitude; absent when unknown.
	readonly magnitude?: number
	// Astrometric right ascension (ICRS, J2000 equator) in radians, at the observation instant for a star with proper
	// motion and a solar-system body.
	readonly rightAscension: number
	// Astrometric declination in radians.
	readonly declination: number
	// Angular size along the major axis in radians; absent when unknown.
	readonly majorAxis?: number
	// Angular size along the minor axis in radians; absent when unknown.
	readonly minorAxis?: number
	// Position angle of the major axis from north through east in radians; absent when unknown.
	readonly orientation?: number
	// Positions at the start and end of the exposure of a solar-system body or a minor body, when the exposure is known.
	readonly motion?: AnnotationMotion
	// Uncertainty of the predicted position of a minor body, radians; absent when unknown.
	readonly positionError?: number
	// Where the position of a solar-system body or a minor body is seen from; absent for the catalog objects, whose
	// positions are the same from anywhere on the Earth.
	readonly center?: AnnotationCenter
}

// Where the WCS of a job came from.
export type AnnotationWcs = { readonly source: 'header' } | { readonly source: 'plateSolve'; readonly plateSolveJobId: string }

// Where the observation instant of a job came from: the request, the DATE-OBS of the header, or its DATE-END and the
// exposure duration.
export type AnnotationTimeOrigin = 'request' | 'dateObs' | 'dateEnd'

// Observation context of a job, resolved when it was submitted.
export interface AnnotationObservation {
	// Instant the positions are computed for, the middle of the exposure when its duration is known, Unix milliseconds
	// (UTC).
	readonly time: number
	// Where the instant came from.
	readonly origin: AnnotationTimeOrigin
	// Whether the header gives the instant to more than a second only, such as a date without a time.
	readonly approximate: boolean
	// Exposure duration in seconds, when known.
	readonly exposure?: number
	// Start of the exposure, Unix milliseconds (UTC), when its duration is known.
	readonly start?: number
	// End of the exposure, Unix milliseconds (UTC), when its duration is known.
	readonly end?: number
	// Where the bodies of the job are seen from.
	readonly center: AnnotationCenter
	// Site the bodies are seen from, when there is one: the requested observer of a local job, or the site of the image
	// header of a minor-body job.
	readonly site?: AnnotationSite
}

// Where a position is seen from: computed for the site (topocentric), computed for the Earth's center and then moved by
// the parallax of the site (geocentricCorrected), or for the Earth's center (geocentric).
export type AnnotationCenter = 'topocentric' | 'geocentricCorrected' | 'geocentric'

// Where a site came from: the observer of the request, or the keywords of the image header (OBSGEO-X/Y/Z, OBSGEO-B/L/H,
// or SITELAT/SITELONG/SITEELEV).
export type AnnotationSiteSource = 'observer' | 'obsgeoXyz' | 'obsgeoBlh' | 'siteKeywords'

// Geographic site the bodies are seen from.
export interface AnnotationSite {
	// Geodetic latitude in degrees, north positive.
	readonly latitude: number
	// Geodetic longitude in degrees, east positive.
	readonly longitude: number
	// Height above the ellipsoid in meters.
	readonly elevation: number
	// Where the site came from.
	readonly source: AnnotationSiteSource
}

// Observation context of an image as its header gives it, for a client to show before a run: the instant of a
// minor-body search and the site it is corrected to.
export interface AnnotationImageContext {
	// Observation context from the header; absent when it has no observation date.
	readonly observation?: AnnotationObservation
	// Site of the header; absent when it locates no site.
	readonly site?: AnnotationSite
}

// Cone of the sky that encloses an image.
export interface AnnotationField {
	// Right ascension of the center of the image (ICRS) in radians, [0, 2π).
	readonly rightAscension: number
	// Declination of the center in radians.
	readonly declination: number
	// Angular distance from the center to the farthest point of the border, in radians.
	readonly radius: number
	// Angular size of a pixel at the center, in radians.
	readonly scale: number
}

// State of a job: waiting, running, or ended (completed, failed, or cancelled).
export type AnnotationJobState = AnalysisJobState

// Why a job did not complete, or a submission was refused:
// - queueFull: too many jobs were waiting when it was submitted.
// - contextUnavailable: the plate solving job named by the request is unknown, not kept, of another image, or without
//   a solution, or the image has no usable WCS; for a minor-body job, the observation instant is unknown or outside
//   the epochs SkyBoT serves, or the image is wider than the cone it searches.
// - annotationFailed: the objects could not be computed.
// - timeout: SkyBoT did not answer within the time budget.
// - providerFailed: SkyBoT could not be reached or answered with an error or a malformed response.
// - cancelled: the job was cancelled.
// - expired: the result is no longer kept.
export type AnnotationErrorCode = 'queueFull' | 'contextUnavailable' | 'annotationFailed' | 'timeout' | 'providerFailed' | 'cancelled' | 'expired'

// Objects of each group a completed job found in the field.
export type AnnotationCounts = Readonly<Record<AnnotationLayer, number>>

// Counts of a completed job.
export interface AnnotationSummary {
	// Objects of each group.
	readonly counts: AnnotationCounts
	// Whether the bounded catalog query left stars or deep-sky objects of the field out.
	readonly truncated: boolean
	// Time the job ran, in milliseconds.
	readonly elapsed: number
}

// An annotation job as published to clients; never carries the objects.
export interface AnnotationJob extends AnalysisJob {
	// What it annotates and from which context.
	readonly request: AnnotationRequest
	// Where its WCS came from.
	readonly wcs: AnnotationWcs
	// Observation context; absent when the instant is unknown.
	readonly observation?: AnnotationObservation
	// Why it did not complete, when it failed or was cancelled.
	readonly code?: AnnotationErrorCode
	// Detail of the failure meant for people.
	readonly error?: string
	// Counts, once completed.
	readonly summary?: AnnotationSummary
}

// Full result of a completed job.
export interface AnnotationResult extends AnnotationSummary {
	// Id of the job.
	readonly jobId: string
	// Id of the image document annotated.
	readonly imageId: string
	// What was annotated and from which context.
	readonly request: AnnotationRequest
	// Where the WCS came from.
	readonly wcs: AnnotationWcs
	// The WCS the objects were selected with, which the client projects them with.
	readonly solution: PlateSolution
	// Observation context; absent when the instant is unknown.
	readonly observation?: AnnotationObservation
	// Cone of the sky queried.
	readonly field: AnnotationField
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
	// Objects on the image: solar-system bodies, then deep-sky objects, then stars, each brightest first.
	readonly objects: readonly AnnotationObject[]
	// Constellation figures reaching the field and labels inside it, unclipped.
	readonly constellations: FieldConstellations
	// Time the job waited before running, in milliseconds.
	readonly queueTime: number
	// Conditions worth knowing about the result, meant for people.
	readonly warnings: readonly string[]
}

// Snapshot of GET /api/annotations: the jobs waiting or running, and the latest ended ones.
export interface AnnotationSnapshot {
	// Jobs, oldest first.
	readonly jobs: readonly AnnotationJob[]
}

// Notification published whenever a job changes.
export interface AnnotationEvent {
	readonly type: 'annotations:updated'
	// New state of the job.
	readonly job: AnnotationJob
}

// Receiver of annotation events.
export type AnnotationListener = (event: AnnotationEvent) => void

// Sky data an annotation reads: the embedded catalog and the local ephemeris (wired in sky/index.ts).
export interface AnnotationSky {
	// Stars and deep-sky objects of the catalog in a cone.
	readonly objects: (query: FieldQuery) => FieldObjects
	// Constellation figures and labels of a cone around a J2000 center, all angles in radians.
	readonly constellations: (rightAscension: number, declination: number, radius: number) => FieldConstellations
	// Local position of a major solar-system body at an instant (Unix milliseconds, UTC), seen from an observer or the
	// Earth's center.
	readonly body: (code: SolarSystemBodyCode, time: number, observer?: SkyObserver) => Promise<SkyPosition>
}

// Request whose context was resolved, ready to be scheduled.
export interface AnnotationPreparation {
	// What to annotate.
	readonly request: AnnotationRequest
	// Where the WCS came from.
	readonly wcs: AnnotationWcs
	// The WCS, a TAN or TAN-SIP solution with 1-based CRPIX.
	readonly solution: PlateSolution
	// Cone of the sky the image covers.
	readonly field: AnnotationField
	// Observation context; absent when the instant is unknown.
	readonly observation?: AnnotationObservation
	// Site of the image header a minor-body job corrects its positions to; absent without one or for a local job.
	readonly location?: GeographicPosition
}

// Outcome of a submission: a new job, the job of an equivalent request still waiting or running (active), the
// completed job of an equivalent earlier one (cached), or why there is none.
export type AnnotationSubmitOutcome =
	| { readonly status: 'accepted'; readonly job: AnnotationJob }
	| { readonly status: 'active'; readonly job: AnnotationJob }
	| { readonly status: 'cached'; readonly job: AnnotationJob }
	| { readonly status: 'missing' }
	| { readonly status: 'contextUnavailable'; readonly error: string }
	| { readonly status: 'queueFull' }

// Error of a job that did not complete, with its reason.
export class AnnotationError extends Error {
	// Creates the error of a reason.
	constructor(
		readonly code: AnnotationErrorCode,
		message: string,
	) {
		super(message)
	}
}

// Cone search of the known minor bodies (the toolkit's coneSearch); tests pass a stub.
export type MinorBodySearch = typeof coneSearch

// Options of the service.
export interface AnnotationServiceOptions {
	// Cone search of the minor bodies; SkyBoT by default.
	readonly skybot?: MinorBodySearch
	// Time a minor-body search may take, in milliseconds, before it fails as timeout.
	readonly skybotTimeout?: number
}

// Provider of a job: the local catalog and ephemeris, or the SkyBoT cone search.
type AnnotationProvider = 'local' | 'skybot'

export { MAX_QUEUED } from './analysis'

// Annotations computed at once by each provider: the catalog query is synchronous and takes a few milliseconds, and a
// SkyBoT search takes seconds and must not hold the local one back.
const LIMITS: Readonly<Record<AnnotationProvider, number>> = { local: 1, skybot: 1 }

// Time a SkyBoT search may take by default, in milliseconds: a small field answers in about 1 to 12 s.
const DEFAULT_SKYBOT_TIMEOUT = 20000

// Most minor bodies a job keeps, the brightest ones.
const MAX_MINOR_BODIES = 1000

// Julian day of the Unix epoch (1970-01-01 0h UTC).
const UNIX_EPOCH_JD = 2440587.5

// Milliseconds per day.
const DAY_MS = 86400000

// Most stars a job keeps, the brightest ones.
const MAX_STARS = 2000

// Most deep-sky objects a job keeps, the brightest ones.
const MAX_DEEP_SKY = 2000

// Samples along each side of the image whose unprojection bounds its cone; enough for strongly distorted and polar
// fields, where the corners alone may miss the farthest point.
const BORDER_SAMPLES = 8

// Margin added to the radius of the cone, in radians (1 arcminute): more than a star moves by its proper motion in a
// century, so no star whose epoch position is on the image is missed by the J2000 cone.
const FIELD_MARGIN = Math.PI / 10800

// Milliseconds per second.
const SECOND_MS = 1000

// Returns the key of an equivalent annotation: the same image, kind, WCS, magnitude limit, instant, and observer. The WCS of the header and the acquisition data never change for an image, so they are implied by its id.
export function annotationCacheKey(imageId: string, { kind, plateSolveJobId, magnitudeLimit, time, observer }: AnnotationRequest): string {
	// A minor-body job sees the bodies from the site of the header, which never changes for an image.
	const site = kind === 'local' && observer ? [observer.latitude, observer.longitude, observer.elevation] : null
	return JSON.stringify([imageId, kind, plateSolveJobId ?? null, magnitudeLimit, time ?? null, site])
}

// Returns why SkyBoT cannot search a field at an observation, or undefined when it can: the instant is unknown or
// outside the epochs it serves, or the cone is wider than it searches.
export function minorBodySearchUnavailable(field: AnnotationField, observation: AnnotationObservation | undefined): string | undefined {
	if (!observation) return 'The observation time is unknown; set it to find minor bodies'
	const julianDay = observation.time / DAY_MS + UNIX_EPOCH_JD
	if (!(julianDay >= SKYBOT_MIN_EPOCH && julianDay <= SKYBOT_MAX_EPOCH)) return 'SkyBoT serves epochs from 1889 to 2060 only'
	if (field.radius + FIELD_MARGIN > SKYBOT_MAX_RADIUS) return 'The image is wider than the 10° radius SkyBoT searches'
	return undefined
}

// Converts a minor body SkyBoT listed from the Earth's center to an annotated object, with its positions at the start
// and end of the exposure from its sky motion when both are known. With a site, every position is moved by the parallax
// of the site at its own instant (geocentricCorrected), which needs the geocentric distance SkyBoT gives; without either
// the positions stay geocentric.
function minorBodyAnnotation(body: SkybotObject, observation: AnnotationObservation, location?: GeographicPosition): AnnotationObject {
	const name = body.number === undefined ? body.name : `(${body.number}) ${body.name}`
	const distance = location && body.distance
	// Position seen from the site at an instant (Unix milliseconds, UTC), or the geocentric one without a site.
	const seen = (rightAscension: number, declination: number, time: number): readonly [number, number] => (distance ? geocentricToTopocentric(rightAscension, declination, distance, timeUnix(time / SECOND_MS, true), location) : [rightAscension, declination])
	const [rightAscension, declination] = seen(body.rightAscension, body.declination, observation.time)
	let motion: AnnotationMotion | undefined

	if (observation.start !== undefined && observation.end !== undefined && body.motionRightAscension !== undefined && body.motionDeclination !== undefined) {
		// Offsets in radians over a time in milliseconds; the right ascension rate is along the parallel, so it is divided
		// by the cosine of the declination.
		const at = (time: number) => {
			const days = (time - observation.time) / DAY_MS
			return seen(body.rightAscension + (body.motionRightAscension! * days) / Math.cos(body.declination), body.declination + body.motionDeclination! * days, time)
		}

		motion = { start: at(observation.start), end: at(observation.end) }
	}

	return {
		id: `skybot:${body.number ?? body.name}`,
		layer: 'minorBody',
		name,
		designations: body.number === undefined ? [] : [body.name],
		typeName: body.class,
		rightAscension,
		declination,
		center: distance ? 'geocentricCorrected' : 'geocentric',
		...(body.magnitude !== undefined && { magnitude: body.magnitude }),
		...(body.positionError !== undefined && { positionError: body.positionError }),
		...(motion && { motion }),
	}
}

// Angular distance in radians between two equatorial positions in radians.
function separation(a: readonly [number, number], b: readonly [number, number]) {
	return vecAngle(eraS2c(a[0], a[1]), eraS2c(b[0], b[1]))
}

// Returns the cone of the sky that encloses an image of `width` × `height` pixels through a WCS, from its center and
// BORDER_SAMPLES points along each side (FITS 1-based pixels, the image spanning 0.5 to size + 0.5); undefined when the
// WCS cannot unproject them.
export function annotationField(solution: FitsHeader, width: number, height: number): AnnotationField | undefined {
	const cx = (width + 1) / 2
	const cy = (height + 1) / 2
	const center = tanUnproject(solution, cx, cy)
	const next = tanUnproject(solution, cx + 1, cy)
	if (!center || !next) return undefined

	let radius = 0

	for (let i = 0; i <= BORDER_SAMPLES; i++) {
		const x = 0.5 + (width * i) / BORDER_SAMPLES
		const y = 0.5 + (height * i) / BORDER_SAMPLES

		for (const [px, py] of [
			[x, 0.5],
			[x, height + 0.5],
			[0.5, y],
			[width + 0.5, y],
		] as const) {
			const sky = tanUnproject(solution, px, py)
			if (!sky) return undefined
			radius = Math.max(radius, separation(center, sky))
		}
	}

	return { rightAscension: center[0], declination: center[1], radius, scale: separation(center, next) }
}

// Returns whether an equatorial position in radians projects onto an image of `width` × `height` pixels through a WCS,
// the image widened by `margin` pixels on every side.
function onImage(solution: FitsHeader, width: number, height: number, rightAscension: number, declination: number, margin: number = 0) {
	const point = tanProject(solution, rightAscension, declination)
	return !!point && point[0] >= 0.5 - margin && point[0] <= width + 0.5 + margin && point[1] >= 0.5 - margin && point[1] <= height + 0.5 + margin
}

// Reads a FITS date-time keyword of a header as Unix milliseconds (UTC, as FITS times are) and whether it is resolved
// to more than a second only; undefined when absent or not a FITS date-time.
function dateKeyword(header: FitsHeader, key: 'DATE-OBS' | 'DATE-END') {
	if (!hasKeyword(header, key)) return undefined
	const fields = parseFitsDateTimeFields(textKeyword(header, key))
	if (!fields) return undefined
	const time = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute) + Math.round(fields.second * SECOND_MS)
	return { time, approximate: fields.resolution > 1 }
}

// Kind of site of each keyword set of the toolkit's FITS reader.
const SITE_SOURCES: Readonly<Record<FitsLocationSource, AnnotationSiteSource>> = { geocentric: 'obsgeoXyz', geodetic: 'obsgeoBlh', site: 'siteKeywords' }

// Returns the site of an image header, from OBSGEO-X/Y/Z, OBSGEO-B/L/H, or SITELAT/SITELONG/SITEELEV as the toolkit
// reads them (readFitsTime): its position for the parallax and its description in degrees and meters; undefined when
// the header locates no site.
export function headerSite(header: FitsHeader): { readonly location: GeographicPosition; readonly site: AnnotationSite } | undefined {
	const { location, locationSource } = readFitsTime(header)
	if (!location || !locationSource) return undefined
	return { location, site: { latitude: toDeg(location.latitude), longitude: toDeg(location.longitude), elevation: toMeter(location.elevation), source: SITE_SOURCES[locationSource] } }
}

// Resolves the observation context of a request for an image with a header and an exposure duration in seconds: the
// request's instant, else the DATE-OBS of the header, else its DATE-END when the exposure is known; the instant is the
// middle of the exposure when its duration is known. The bodies of a local job are seen from the requested observer
// (topocentric), and those of a minor-body job from the site of the header (geocentricCorrected); else from the
// Earth's center (geocentric). Undefined when none gives the instant.
export function observationContext(header: FitsHeader, exposure: number | undefined, request: AnnotationRequest): AnnotationObservation | undefined {
	const duration = exposure !== undefined && exposure > 0 ? exposure * SECOND_MS : undefined
	const minorBodies = request.kind === 'minorBodies'
	const site: AnnotationSite | undefined = minorBodies ? headerSite(header)?.site : request.observer && { ...request.observer, source: 'observer' }
	const center: AnnotationCenter = site ? (minorBodies ? 'geocentricCorrected' : 'topocentric') : 'geocentric'
	const seen = { center, ...(site && { site }) }
	let start: number
	let origin: AnnotationTimeOrigin
	let approximate = false

	if (request.time !== undefined) {
		start = duration === undefined ? request.time : request.time - duration / 2
		origin = 'request'
	} else {
		const dateObs = dateKeyword(header, 'DATE-OBS')
		const dateEnd = duration === undefined ? undefined : dateKeyword(header, 'DATE-END')

		if (dateObs) {
			start = dateObs.time
			approximate = dateObs.approximate
			origin = 'dateObs'
		} else if (dateEnd && duration !== undefined) {
			start = dateEnd.time - duration
			approximate = dateEnd.approximate
			origin = 'dateEnd'
		} else {
			return undefined
		}
	}

	if (duration === undefined) return { time: start, origin, approximate, ...seen }
	return { time: start + duration / 2, origin, approximate, exposure: exposure!, start, end: start + duration, ...seen }
}

// Converts a catalog object of the field to an annotated object.
function catalogAnnotation(object: FieldObject): AnnotationObject {
	return {
		id: `catalog:${object.id}`,
		ref: { kind: 'catalog', id: object.id },
		layer: object.category,
		name: object.name,
		designations: object.designations,
		typeName: object.typeName,
		rightAscension: object.rightAscension,
		declination: object.declination,
		...(object.magnitude !== undefined && { magnitude: object.magnitude }),
		...(object.majorAxis !== undefined && { majorAxis: object.majorAxis }),
		...(object.minorAxis !== undefined && { minorAxis: object.minorAxis }),
		...(object.orientation !== undefined && { orientation: object.orientation }),
	}
}

// A job of the service while it waits or runs, with its scheduling state.
type JobEntry = AnalysisEntry<AnnotationJob, AnnotationPreparation>

// Annotation jobs of the server, their scheduling (see analysis.ts), and their results.
export class AnnotationService {
	// Queue, limits, reservations, and kept results.
	readonly #scheduler: AnalysisScheduler<AnnotationJob, AnnotationResult, AnnotationPreparation, AnnotationProvider>
	// Cone search of the minor bodies.
	readonly #skybot: MinorBodySearch
	// Time a minor-body search may take, in milliseconds.
	readonly #skybotTimeout: number

	// Creates the service over the image store, the plate solving results it reads the WCS from, the sky data it
	// annotates with, and the minor-body search, publishing every job change to listener. The results of an image are
	// dropped when the store releases it.
	constructor(
		readonly images: ImageStore,
		readonly plateSolving: Pick<PlateSolvingService, 'result' | 'solutions'>,
		readonly sky: AnnotationSky,
		readonly listener: AnnotationListener,
		{ skybot = coneSearch, skybotTimeout = DEFAULT_SKYBOT_TIMEOUT }: AnnotationServiceOptions = {},
	) {
		this.#skybot = skybot
		this.#skybotTimeout = skybotTimeout
		this.#scheduler = new AnalysisScheduler<AnnotationJob, AnnotationResult, AnnotationPreparation, AnnotationProvider>(images, {
			limits: LIMITS,
			provider: (preparation) => (preparation.request.kind === 'minorBodies' ? 'skybot' : 'local'),
			execute: (entry) => this.#execute(entry),
			failed: (entry, error) => {
				if (entry.controller.signal.aborted) return { state: 'cancelled', code: 'cancelled', error: 'The annotation was cancelled' }
				if (error instanceof AnnotationError) return { state: 'failed', code: error.code, error: error.message }
				return { state: 'failed', code: 'annotationFailed', error: Error.isError(error) ? error.message : String(error) }
			},
			cancelled: () => ({ code: 'cancelled', error: 'The annotation was cancelled' }),
			publish: (job) => this.listener({ type: 'annotations:updated', job }),
		})
	}

	// Submits an annotation of an open image. An equivalent job still waiting or running, or completed with its result
	// kept, is answered instead of running again. The WCS and the observation context are resolved here, once.
	submit(imageId: string, request: AnnotationRequest): AnnotationSubmitOutcome {
		if (this.images.name(imageId) === undefined) return { status: 'missing' }

		const preparation = this.#prepare(imageId, request)
		if (typeof preparation === 'string') return { status: 'contextUnavailable', error: preparation }

		const key = annotationCacheKey(imageId, request)
		const active = this.#scheduler.active(key)
		if (active) return { status: 'active', job: active }
		const cached = this.#scheduler.cached(imageId, key)
		if (cached) return { status: 'cached', job: cached.job }
		if (this.#scheduler.full()) return { status: 'queueFull' }

		const job = this.#scheduler.enqueue(imageId, preparation, key, { request, wcs: preparation.wcs, ...(preparation.observation && { observation: preparation.observation }) })
		return job ? { status: 'accepted', job } : { status: 'missing' }
	}

	// Cancels a job: a waiting one ends at once, a running one is interrupted. Returns false when the job is not waiting
	// or running.
	cancel(jobId: string): boolean {
		return this.#scheduler.cancel(jobId)
	}

	// Returns a job waiting, running, recently ended, or completed with its result kept.
	job(jobId: string): AnnotationJob | undefined {
		return this.#scheduler.job(jobId)
	}

	// Resolves to the result of a job waiting or running once it ended, undefined when it did not complete; returns
	// undefined at once for a job neither waiting nor running.
	settled(jobId: string): Promise<AnnotationResult | undefined> | undefined {
		return this.#scheduler.settled(jobId)
	}

	// Returns the result of a completed job while it is kept.
	result(jobId: string): AnnotationResult | undefined {
		return this.#scheduler.result(jobId)
	}

	// Returns the completed jobs of an image whose results are kept, oldest first.
	results(imageId: string): AnnotationJob[] {
		return this.#scheduler.results(imageId)
	}

	// Returns the observation context of an open or retained image as its header gives it, the instant and site a
	// minor-body search of it uses; undefined when the image is unknown.
	context(imageId: string): AnnotationImageContext | undefined {
		const metadata = this.images.metadata(imageId)
		if (!metadata) return undefined
		const observation = observationContext(metadata.header, metadata.acquisition.exposure, { kind: 'minorBodies', magnitudeLimit: 0 })
		const site = headerSite(metadata.header)?.site
		return { ...(observation && { observation }), ...(site && { site }) }
	}

	// Returns the jobs waiting or running and the latest ended ones, oldest first.
	snapshot(): AnnotationSnapshot {
		return { jobs: this.#scheduler.snapshot() }
	}

	// Resolves the WCS, the field, and the observation context of a request of an open image, or returns why the WCS
	// cannot be used.
	#prepare(imageId: string, request: AnnotationRequest): AnnotationPreparation | string {
		const metadata = this.images.metadata(imageId)
		if (!metadata) return 'The image is not open'

		let solution: PlateSolution | undefined
		let wcs: AnnotationWcs

		if (request.plateSolveJobId !== undefined) {
			const solved = this.plateSolving.result(request.plateSolveJobId)
			if (!solved || solved.imageId !== imageId) return 'The plate solution is not available for this image'
			if (!solved.solution) return 'The plate solving job found no solution'
			solution = solved.solution
			wcs = { source: 'plateSolve', plateSolveJobId: request.plateSolveJobId }
		} else {
			solution = this.plateSolving.solutions(imageId)?.header
			if (!solution) return 'The image header has no usable WCS; solve the image first'
			wcs = { source: 'header' }
		}

		const field = annotationField(solution, metadata.width, metadata.height)
		if (!field) return 'The WCS cannot map the image to the sky'

		const observation = observationContext(metadata.header, metadata.acquisition.exposure, request)
		const unavailable = request.kind === 'minorBodies' ? minorBodySearchUnavailable(field, observation) : undefined
		if (unavailable) return unavailable
		const location = request.kind === 'minorBodies' ? headerSite(metadata.header)?.location : undefined
		return { request, wcs, solution, field, ...(observation && { observation }), ...(location && { location }) }
	}

	// Computes the objects of a job and builds its result.
	#execute(entry: JobEntry): Promise<AnnotationCompletion> {
		return entry.preparation.request.kind === 'minorBodies' ? this.#minorBodies(entry) : this.#local(entry)
	}

	// Searches the minor bodies of a job with SkyBoT, within the time budget, and keeps those on the image, brightest
	// first. Rejects with AnnotationError on a timeout or a failure of the service.
	async #minorBodies(entry: JobEntry): Promise<AnnotationCompletion> {
		const { request, solution, field } = entry.preparation
		const observation = entry.preparation.observation!
		const { width, height } = entry.size
		const timeout = AbortSignal.timeout(this.#skybotTimeout)
		let found: readonly SkybotObject[]

		try {
			found = await this.#skybot(observation.time, field.rightAscension, field.declination, field.radius + FIELD_MARGIN, { observer: GEOCENTER, objects: { asteroids: true, planets: false, comets: true } }, AbortSignal.any([entry.controller.signal, timeout]))
		} catch (error) {
			if (entry.controller.signal.aborted) throw new AnnotationError('cancelled', 'The annotation was cancelled')
			if (timeout.aborted) throw new AnnotationError('timeout', `SkyBoT did not answer within ${this.#skybotTimeout / 1000} s`)
			throw new AnnotationError('providerFailed', `SkyBoT could not be used: ${Error.isError(error) ? error.message : String(error)}`)
		}

		const onField = found.filter((e) => onImage(solution, width, height, e.rightAscension, e.declination)).sort((a, b) => (a.magnitude ?? Infinity) - (b.magnitude ?? Infinity))
		const truncated = onField.length > MAX_MINOR_BODIES
		const objects = onField.slice(0, MAX_MINOR_BODIES).map((e) => minorBodyAnnotation(e, observation, entry.preparation.location))
		const warnings = ['Positions are predictions of SkyBoT, not detections in the image.']

		if (!entry.preparation.location) warnings.push('The image header gives no site, so the minor bodies are seen from the center of the Earth; a near-Earth object may be far from its predicted position.')
		else if (objects.some((e) => e.center === 'geocentric')) warnings.push('SkyBoT gave no distance for some minor bodies, so their positions are not corrected for the site.')
		if (observation.approximate) warnings.push('The header gives the observation time to more than a second only.')
		if (truncated) warnings.push(`The field has more than ${MAX_MINOR_BODIES} minor bodies: only the brightest ones are shown.`)

		const counts: AnnotationCounts = { star: 0, deepSky: 0, solarSystem: 0, minorBody: objects.length }
		const summary: AnnotationSummary = { counts, truncated, elapsed: performance.now() - entry.started! }
		const queueTime = entry.job.startedAt! - entry.job.queuedAt
		const result: AnnotationResult = { ...summary, jobId: entry.job.jobId, imageId: entry.job.imageId, request, wcs: entry.preparation.wcs, solution, observation, field, width, height, objects, constellations: { lines: [], labels: [] }, queueTime, warnings }
		return { patch: { summary }, result }
	}

	// Annotates a job with the local catalog and ephemeris.
	async #local(entry: JobEntry): Promise<AnnotationCompletion> {
		const { request, solution, field, observation } = entry.preparation
		const { width, height } = entry.size
		const { signal } = entry.controller
		const warnings: string[] = []

		const catalog = this.sky.objects({ rightAscension: field.rightAscension, declination: field.declination, radius: field.radius + FIELD_MARGIN, time: observation?.time, magnitudeLimit: request.magnitudeLimit, maxStars: MAX_STARS, maxDeepSky: MAX_DEEP_SKY })
		// A deep-sky object is kept when its major axis may reach the image, so its half extent widens the image.
		const deepSky = catalog.deepSky.filter((e) => onImage(solution, width, height, e.rightAscension, e.declination, (e.majorAxis ?? 0) / 2 / field.scale)).map(catalogAnnotation)
		const stars = catalog.stars.filter((e) => onImage(solution, width, height, e.rightAscension, e.declination)).map(catalogAnnotation)
		const bodies = observation ? await this.#bodies(observation, request.observer, solution, width, height, signal) : []

		if (!observation) warnings.push('The observation time is unknown: the stars are at their J2000 positions and no solar-system body is shown.')
		else if (observation.approximate) warnings.push('The header gives the observation time to more than a second only.')
		if (bodies.length > 0 && !request.observer) warnings.push('The solar-system bodies are seen from the center of the Earth; the Moon may be off by up to a degree.')
		if (catalog.truncated) warnings.push('The field has more catalog objects than are kept: only the brightest ones are shown.')

		const constellations = this.sky.constellations(field.rightAscension, field.declination, field.radius + FIELD_MARGIN)
		const counts: AnnotationCounts = { star: stars.length, deepSky: deepSky.length, solarSystem: bodies.length, minorBody: 0 }
		const summary: AnnotationSummary = { counts, truncated: catalog.truncated, elapsed: performance.now() - entry.started! }
		const queueTime = entry.job.startedAt! - entry.job.queuedAt
		const result: AnnotationResult = { ...summary, jobId: entry.job.jobId, imageId: entry.job.imageId, request, wcs: entry.preparation.wcs, solution, ...(observation && { observation }), field, width, height, objects: [...bodies, ...deepSky, ...stars], constellations, queueTime, warnings }
		return { patch: { summary }, result }
	}

	// Positions of the major solar-system bodies on the image at the observation instant, with their positions at the
	// start and end of the exposure when its duration is known. Rejects with AnnotationError when cancelled.
	async #bodies(observation: AnnotationObservation, observer: SkyObserver | undefined, solution: FitsHeader, width: number, height: number, signal: AbortSignal): Promise<AnnotationObject[]> {
		const bodies: AnnotationObject[] = []

		for (const body of SOLAR_SYSTEM_BODIES) {
			const position = await this.sky.body(body.code, observation.time, observer)
			if (signal.aborted) throw new AnnotationError('cancelled', 'The annotation was cancelled')
			if (!onImage(solution, width, height, position.rightAscensionJ2000, position.declinationJ2000)) continue

			let motion: AnnotationMotion | undefined

			if (observation.start !== undefined && observation.end !== undefined) {
				const [start, end] = await Promise.all([this.sky.body(body.code, observation.start, observer), this.sky.body(body.code, observation.end, observer)])
				motion = { start: [start.rightAscensionJ2000, start.declinationJ2000], end: [end.rightAscensionJ2000, end.declinationJ2000] }
			}

			bodies.push({
				id: `body:${body.code}`,
				ref: { kind: 'body', code: body.code },
				layer: 'solarSystem',
				name: body.name,
				designations: [],
				typeName: body.typeName,
				rightAscension: position.rightAscensionJ2000,
				declination: position.declinationJ2000,
				center: position.center,
				...(position.magnitude !== undefined && { magnitude: position.magnitude }),
				...(motion && { motion }),
			})
		}

		return bodies
	}
}

// What a completed job produced.
type AnnotationCompletion = AnalysisCompletion<AnnotationJob, AnnotationResult>

// Creates the annotation routes over a service.
export function createAnnotationRoutes(service: AnnotationService) {
	return {
		'/api/images/:id/annotations/context': {
			// Observation context of an open image as its header gives it, and its site; 404 when the image is not open.
			GET: (req) => {
				const context = service.context(req.params.id)
				return context ? Response.json(context) : errorResponse('Image not found', 404, 'notFound')
			},
		},
		'/api/images/:id/annotations': {
			// Completed jobs of an image whose results are kept, oldest first.
			GET: (req) => Response.json(service.results(req.params.id)),
			// Submits an annotation (AnnotationRequest) of an open image. Responds 202 with the queued job or the equivalent
			// job still waiting or running, 200 with the completed job of an equivalent earlier annotation, 404 when the
			// image is not open, 422 when its WCS cannot be used, and 503 when too many jobs are waiting.
			POST: async (req) => {
				const outcome = service.submit(req.params.id, (await req.json()) as AnnotationRequest)
				if (outcome.status === 'missing') return errorResponse('Image not found', 404, 'notFound')
				if (outcome.status === 'contextUnavailable') return errorResponse(outcome.error, 422, 'contextUnavailable')
				if (outcome.status === 'queueFull') return errorResponse('Too many annotations are waiting; try again later', 503, 'queueFull')
				return Response.json(outcome.job, { status: outcome.status === 'cached' ? 200 : 202 })
			},
		},
		'/api/annotations': {
			// Jobs waiting or running and the latest ended ones, for a tab that (re)connects.
			GET: () => Response.json(service.snapshot()),
		},
		'/api/annotations/:jobId': {
			// A job; 404 when it is unknown or long forgotten.
			GET: (req) => {
				const job = service.job(req.params.jobId)
				return job ? Response.json(job) : errorResponse('Annotation not found', 404, 'notFound')
			},
		},
		'/api/annotations/:jobId/result': {
			// The full result of a completed job; 404 with code expired when it is not kept (anymore).
			GET: (req) => {
				const result = service.result(req.params.jobId)
				return result ? Response.json(result) : errorResponse('The result is not available', 404, 'expired')
			},
		},
		'/api/annotations/:jobId/cancel': {
			// Cancels a waiting or running job; the end arrives as an annotations:updated event. 404 when it is neither.
			POST: (req) => new Response(null, { status: service.cancel(req.params.jobId) ? 204 : 404 }),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
