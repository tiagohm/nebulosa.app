import { type LunarEclipse, type LunarEclipseType, nearestLunarEclipse } from 'nebulosa/src/astronomy/bodies/moon'
import type { SunMoonProvider } from 'nebulosa/src/astronomy/events/eclipse/eclipse'
import {
	computeLocalLunarEclipseCircumstances,
	computeLocalLunarEclipseInstant,
	computeLocalLunarEclipseViewGeometry,
	type LocalLunarEclipseCircumstances,
	type LocalLunarEclipseDetails,
	type LocalLunarEclipseInstant,
	type LocalLunarEclipseSvgShape,
	type LocalLunarEclipseVisibilityKind,
	type LocalLunarViewHandedness,
	type LocalLunarViewOrientationMode,
} from 'nebulosa/src/astronomy/events/eclipse/lunar/local'
import { computeLunarEclipseMapGeometry, type LunarEclipseContactKind, lunarEclipseEvents, lunarEclipseMapToSvgPaths, refineLunarEclipse } from 'nebulosa/src/astronomy/events/eclipse/lunar/map'
import { timeToUnixMillis, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { DEGREE_PLANE, type EclipseDirection, eclipseEphemeris, type EclipseLocation, eclipseNotFound, findRefinedEclipse, locationParams, MAP_PRECISION, type RefinedEclipseSearch, resolveRefinedEclipse } from './eclipses'
import { type EphemerisProvenance, NO_EPHEMERIS_KERNELS } from './ephemeris.chain'
import { errorResponse } from './http'
import { LruCache } from './lrucache'
import type { PlanetaryKernels } from './planetary.source'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import { yieldToEventLoop } from './util'

// Lunar eclipses for the Lunar Eclipse Map tool: stateless, read-only queries over the toolkit's lunar eclipse
// engine (core/src/astronomy/events/eclipse/lunar), answered under /api/eclipses/lunar with the conventions of
// eclipses.ts. An eclipse is named by its id, the Unix milliseconds of its greatest eclipse, so no eclipse is
// stored on the server. The Sun, the Earth, and the Moon come from the ephemeris of eclipses.ts, the kernels of
// the SPICE Kernel Library when they cover the eclipse. Times are Unix milliseconds (UTC), angles and geographic
// positions degrees (longitude east positive), durations seconds. Visibility is the Moon's center at or above the geometric 0° horizon,
// without refraction, on the map and locally alike.

export type { LocalLunarEclipseDetails, LocalLunarEclipseSvgShape, LocalLunarEclipseVisibilityKind, LocalLunarViewHandedness, LocalLunarViewOrientationMode, LunarEclipseContactKind, LunarEclipseType }

// Codes of the errors of the lunar eclipse routes.
export type LunarEclipseErrorCode = 'notFound'

// Instant of a contact of an eclipse; MAX is the greatest eclipse, not a contact of the lunar limb.
export interface LunarEclipseContactTime {
	// Contact.
	readonly kind: LunarEclipseContactKind
	// Instant, in Unix milliseconds (UTC).
	readonly time: number
}

// Global circumstances of a lunar eclipse, the same for every observer.
export interface LunarEclipseSummary {
	// Id of the eclipse: the Unix milliseconds of its greatest eclipse, as a decimal string.
	readonly id: string
	// Type of the eclipse.
	readonly type: LunarEclipseType
	// Instant of the greatest eclipse, in Unix milliseconds (UTC).
	readonly maximum: number
	// Umbral magnitude for a total or partial eclipse, penumbral magnitude for a penumbral one.
	readonly magnitude: number
	// Meeus lunation number of the full moon of the eclipse.
	readonly lunation: number
	// Contacts that exist for its type, in chronological order: P1, MAX, P4 for a penumbral eclipse, P1, U1, MAX,
	// U4, P4 for a partial one, all seven for a total one.
	readonly contacts: readonly LunarEclipseContactTime[]
}

// A contact on the map, with the place that has the Moon at the zenith.
export interface LunarEclipseMapEvent extends LunarEclipseContactTime {
	// Sublunar point at the contact, in degrees.
	readonly sublunar: EclipseLocation
}

// SVG path data of each existing contact, drawn on the degree plane: x = longitude + 180 in [0, 360] and y = 90 -
// latitude in [0, 180], so x grows east and y south from longitude -180°, latitude +90°. Contacts the eclipse
// does not have are absent.
export type LunarEclipseContactPaths = Partial<Record<LunarEclipseContactKind, string>>

// Global map of a lunar eclipse: where the Moon rises or sets at each contact.
export interface LunarEclipseMap {
	// Eclipse.
	readonly eclipse: LunarEclipseSummary
	// Contacts, in chronological order, with their sublunar points.
	readonly events: readonly LunarEclipseMapEvent[]
	// Lines where the Moon is on the horizon at each contact; split at the antimeridian.
	readonly lines: LunarEclipseContactPaths
	// Regions where the Moon is above the horizon at each contact, closed along the map edges; drawn with
	// fill-rule evenodd.
	readonly fills: LunarEclipseContactPaths
	// Source of the Sun and the Moon of the map; set by the service.
	readonly ephemeris?: EphemerisProvenance
}

// A contact as seen from a place.
export interface LocalLunarEclipseContact extends LunarEclipseContactTime {
	// Whether the Moon's center is at or above the horizon.
	readonly observable: boolean
	// Topocentric altitude of the Moon, in degrees, without refraction.
	readonly altitude: number
	// Azimuth of the Moon, in degrees, north through east, [0, 360).
	readonly azimuth: number
	// Position angle of the contact point on the lunar limb, in degrees from celestial north through east, [0, 360).
	readonly positionAngle: number
	// Angle of the contact point on the lunar limb, in degrees from the zenith, [0, 360).
	readonly zenithAngle: number
	// Umbral magnitude at the contact: negative at P1 and P4, 0 at U1 and U4, 1 at U2 and U3.
	readonly umbralMagnitude: number
	// Penumbral magnitude at the contact: 0 at P1 and P4.
	readonly penumbralMagnitude: number
}

// Visibility of an eclipse from a place.
export interface LocalLunarEclipseVisibility {
	// Classification over the whole eclipse.
	readonly kind: LocalLunarEclipseVisibilityKind
	// Classification meant for people.
	readonly text: string
	// Whether the Moon is above the horizon at some instant between P1 and P4.
	readonly hasObservableEclipse: boolean
}

// Presentation of the Local View: the Moon's path through the Earth's shadow as seen from a place.
export interface LunarEclipseViewOptions {
	// Contact whose Moon disk is drawn, MAX, then the first contact, when the eclipse lacks it; or a fraction in [0, 1]
	// of the eclipse, 0 being P1 and 1 being P4, drawn between the contacts.
	readonly event: LunarEclipseContactKind | number
	// Whether up is the zenith or celestial north.
	readonly orientation: LocalLunarViewOrientationMode
	// Whether east is to the right or to the left.
	readonly handedness: LocalLunarViewHandedness
	// Whether the Moon disks of the other contacts are drawn too.
	readonly ghosts: boolean
}

// Geometry of the Local View, a schematic diagram in pixels with the origin at the top-left corner and y down.
export interface LunarEclipseLocalView {
	// Width, in pixels.
	readonly width: number
	// Height, in pixels.
	readonly height: number
	// Contact whose Moon disk is drawn, absent when the eclipse has none or an instant between the contacts is drawn.
	readonly selectedEvent?: LunarEclipseContactKind
	// Instant drawn, in Unix milliseconds (UTC); absent when the eclipse has no contact.
	readonly time?: number
	// Position angle at the instant drawn, in degrees from celestial north through east, [0, 360): of the contact point on
	// the lunar limb at a contact, or between the contacts of the limb point nearest the shadow's center; absent without
	// an instant.
	readonly positionAngle?: number
	// The same angle measured from the direction of the zenith, in degrees, [0, 360); absent like positionAngle.
	readonly zenithAngle?: number
	// Shapes in painting order.
	readonly shapes: readonly LocalLunarEclipseSvgShape[]
}

// Circumstances of a lunar eclipse from a place.
export interface LocalLunarEclipse {
	// Id of the eclipse.
	readonly eclipseId: string
	// Place.
	readonly location: EclipseLocation
	// Visibility.
	readonly visibility: LocalLunarEclipseVisibility
	// Magnitudes, and durations in seconds; those the eclipse type lacks are absent.
	readonly details: LocalLunarEclipseDetails
	// Contacts, in chronological order.
	readonly events: readonly LocalLunarEclipseContact[]
	// Local View.
	readonly view: LunarEclipseLocalView
	// Source of the Sun and the Moon of the circumstances.
	readonly ephemeris: EphemerisProvenance
}

// Altitude samples of the visibility check of the visible-only search. Whether the Moon reaches the horizon is
// decided by an exact search of the altitude maximum, not by the samples, so fewer samples than the toolkit's
// default lose nothing and make each candidate about twice as fast.
const VISIBILITY_SAMPLES = 8

// Eclipses tried at most by the visible-only search, about a decade; the search then gives up.
export const MAX_VISIBLE_SCAN = 24

// Maps and local circumstances kept at most.
const CACHE_LIMIT = 8

// Default presentation of the Local View.
const DEFAULT_VIEW_OPTIONS: LunarEclipseViewOptions = { event: 'MAX', orientation: 'zenith', handedness: 'eastRight', ghosts: true }

// Contacts of a lunar eclipse, which the `event` query parameter names; anything else is a fraction of the eclipse.
const LUNAR_CONTACT_KINDS: ReadonlySet<LunarEclipseContactKind> = new Set(['P1', 'U1', 'U2', 'MAX', 'U3', 'U4', 'P4'])

// Id of an eclipse: the Unix milliseconds of its greatest eclipse, truncated.
function eclipseId(eclipse: LunarEclipse): string {
	return `${timeToUnixMillis(eclipse.maximalTime)}`
}

// Penumbral magnitude below zero down to which a series result is still a candidate: the series misses the faintest
// penumbral eclipses, and the geometry of the refinement rejects the candidates that are none.
const SERIES_PENUMBRAL_MARGIN = 0.02

// Search of the lunar eclipses: the toolkit's series, with its instants, type, and magnitude taken from the geometry
// of the Moon and the Earth's shadow.
const SEARCH: RefinedEclipseSearch<LunarEclipse> = {
	// The greatest eclipse is up to a millisecond after its id, so the instant is moved by one millisecond away from it.
	nearest: (time, next) => nearestLunarEclipse(timeUnix((time + (next ? 1 : -1)) / 1000), next, SERIES_PENUMBRAL_MARGIN),
	refine: (candidate, sunMoon) => refineLunarEclipse(candidate, sunMoon),
	center: (eclipse) => eclipse.maximalTime,
	instant: (eclipse) => timeToUnixMillis(eclipse.maximalTime),
	cache: new LruCache(128),
}

// Returns the eclipse nearest an instant in a direction: the next one has an id later than time, the previous one an
// id earlier than it, so stepping from an id never returns the same eclipse. time is in Unix milliseconds; each
// candidate is refined on the ephemeris snapshot gives it (eclipses.ts), the theories when absent.
export function findLunarEclipse(time: number, direction: EclipseDirection, snapshot: SpiceKernelSnapshot = NO_EPHEMERIS_KERNELS.current()): LunarEclipse {
	return findRefinedEclipse(SEARCH, time, direction, snapshot)
}

// Returns the eclipse an id names on the ephemeris of snapshot, the one whose greatest eclipse is within
// ID_MATCH_TOLERANCE of it, or undefined when it names none.
export function resolveLunarEclipse(id: string, snapshot: SpiceKernelSnapshot = NO_EPHEMERIS_KERNELS.current()): LunarEclipse | undefined {
	return resolveRefinedEclipse(SEARCH, id, snapshot)
}

// Returns the global circumstances of an eclipse.
export function lunarEclipseSummary(eclipse: LunarEclipse): LunarEclipseSummary {
	const contacts = lunarEclipseEvents(eclipse).map((contact) => ({ kind: contact.kind, time: timeToUnixMillis(contact.time) }))
	return { id: eclipseId(eclipse), type: eclipse.type, maximum: timeToUnixMillis(eclipse.maximalTime), magnitude: eclipse.magnitude, lunation: eclipse.lunation, contacts }
}

// Keeps the non-empty paths of the contacts.
function contactPaths(paths: Readonly<Record<LunarEclipseContactKind, string>>): LunarEclipseContactPaths {
	const result: Partial<Record<LunarEclipseContactKind, string>> = {}

	for (const [kind, path] of Object.entries(paths) as [LunarEclipseContactKind, string][]) {
		if (path) result[kind] = path
	}

	return result
}

// Returns the global map of an eclipse on the Sun and the Moon of its ephemeris (eclipses.ts).
export function lunarEclipseMap(eclipse: LunarEclipse, sunMoon: SunMoonProvider): LunarEclipseMap {
	const geometry = computeLunarEclipseMapGeometry(eclipse, sunMoon)
	const lines = lunarEclipseMapToSvgPaths(geometry, DEGREE_PLANE, { precision: MAP_PRECISION })
	const fills = lunarEclipseMapToSvgPaths(geometry, DEGREE_PLANE, { fill: true, fillRegion: 'aboveHorizon', precision: MAP_PRECISION })
	const events = geometry.events.map((event) => ({ kind: event.kind, time: timeToUnixMillis(event.time), sublunar: { longitude: toDeg(event.sublunar.x), latitude: toDeg(event.sublunar.y) } }))
	return { eclipse: lunarEclipseSummary(eclipse), events, lines: contactPaths(lines.moonRiseSet), fills: contactPaths(fills.moonRiseSet) }
}

// Returns the toolkit's circumstances of an eclipse for a place on the Sun and the Moon of its ephemeris, with
// altitudeSamples samples of the Moon's altitude.
function circumstances(eclipse: LunarEclipse, { longitude, latitude }: EclipseLocation, sunMoon: SunMoonProvider, altitudeSamples?: number) {
	return computeLocalLunarEclipseCircumstances(eclipse, deg(longitude), deg(latitude), sunMoon, { altitudeSamples })
}

// Returns the circumstances of an eclipse from a place, local, with its Local View drawn as view asks: at instant when
// given (the state at view's fraction), otherwise at view's contact.
export function localLunarEclipse(eclipse: LunarEclipse, location: EclipseLocation, view: LunarEclipseViewOptions, local: LocalLunarEclipseCircumstances, ephemeris: EphemerisProvenance, instant?: LocalLunarEclipseInstant): LocalLunarEclipse {
	const events: LocalLunarEclipseContact[] = []

	for (const contact of lunarEclipseEvents(eclipse)) {
		const event = local.events[contact.kind]
		if (!event) continue
		const { kind, observable, altitude, azimuth, positionAngle, zenithAngle, umbralMagnitude, penumbralMagnitude } = event
		events.push({ kind, time: timeToUnixMillis(event.time), observable, altitude: toDeg(altitude), azimuth: toDeg(azimuth), positionAngle: toDeg(positionAngle), zenithAngle: toDeg(zenithAngle), umbralMagnitude, penumbralMagnitude })
	}

	const geometry = computeLocalLunarEclipseViewGeometry(local, eclipse, { selectedEvent: typeof view.event === 'number' ? 'MAX' : view.event, instant, orientationMode: view.orientation, handedness: view.handedness, includeGhostDisks: view.ghosts, includeHorizon: true, horizonAltitude: 0 })
	const drawn = instant ?? (geometry.selectedEvent && local.events[geometry.selectedEvent])
	const { kind, text, hasObservableEclipse } = local.visibility

	return {
		eclipseId: eclipseId(eclipse),
		location,
		visibility: { kind, text, hasObservableEclipse },
		details: local.details,
		events,
		view: { width: geometry.width, height: geometry.height, selectedEvent: geometry.selectedEvent, time: drawn ? timeToUnixMillis(drawn.time) : undefined, positionAngle: drawn ? toDeg(drawn.positionAngle) : undefined, zenithAngle: drawn ? toDeg(drawn.zenithAngle) : undefined, shapes: geometry.shapes },
		ephemeris,
	}
}

// Options of the lunar eclipse service.
export interface LunarEclipseServiceOptions {
	// Kernels of the SPICE Kernel Library; none by default, so every eclipse is computed on the theories.
	readonly kernels?: PlanetaryKernels
}

// Lunar eclipse queries, keeping the latest maps and local circumstances by ephemeris source and kernel generation,
// so moving between contacts or redrawing the Local View does not compute them again, and a change of the kernels does.
// The kernel snapshot is read once per request (once per candidate of a visible-only search).
export class LunarEclipseService {
	readonly #maps = new LruCache<LunarEclipseMap>(CACHE_LIMIT)
	readonly #locals = new LruCache<LocalLunarEclipseCircumstances>(CACHE_LIMIT)
	// Kernels the ephemeris of every eclipse is chosen from.
	readonly kernels: PlanetaryKernels

	// Creates the service.
	constructor({ kernels = NO_EPHEMERIS_KERNELS }: LunarEclipseServiceOptions = {}) {
		this.kernels = kernels
	}

	// Returns the eclipse nearest time (Unix milliseconds) in a direction.
	find(time: number, direction: EclipseDirection): LunarEclipseSummary {
		return lunarEclipseSummary(findLunarEclipse(time, direction, this.kernels.current()))
	}

	// Returns the eclipse nearest time (Unix milliseconds) in a direction whose Moon is above the horizon of a place
	// at some instant, trying MAX_VISIBLE_SCAN eclipses at most; undefined when none of them is, or when the signal
	// aborts. Each candidate costs tens of milliseconds, so the event loop runs between them.
	async findVisible(time: number, direction: EclipseDirection, location: EclipseLocation, signal?: AbortSignal): Promise<LunarEclipseSummary | undefined> {
		let cursor = time

		for (let i = 0; i < MAX_VISIBLE_SCAN; i++) {
			const snapshot = this.kernels.current()
			const eclipse = findLunarEclipse(cursor, direction, snapshot)
			const visible = eclipseEphemeris(snapshot, eclipse.maximalTime).run((sunMoon) => circumstances(eclipse, location, sunMoon, VISIBILITY_SAMPLES).visibility.hasObservableEclipse).result
			if (visible) return lunarEclipseSummary(eclipse)
			cursor = +eclipseId(eclipse)
			await yieldToEventLoop()
			if (signal?.aborted) return undefined
		}

		return undefined
	}

	// Returns the global map of the eclipse an id names, or undefined when it names none.
	map(id: string): LunarEclipseMap | undefined {
		const snapshot = this.kernels.current()
		const eclipse = resolveLunarEclipse(id, snapshot)
		if (!eclipse) return undefined

		const { result, provenance } = eclipseEphemeris(snapshot, eclipse.maximalTime).run((sunMoon, source) => {
			const key = `${source}:${eclipseId(eclipse)}`
			let map = this.#maps.get(key)

			if (!map) {
				map = lunarEclipseMap(eclipse, sunMoon)
				this.#maps.set(key, map)
			}

			return map
		})

		return { ...result, ephemeris: provenance }
	}

	// Returns the circumstances of the eclipse an id names from a place, or undefined when it names none.
	local(id: string, location: EclipseLocation, view: LunarEclipseViewOptions): LocalLunarEclipse | undefined {
		const snapshot = this.kernels.current()
		const eclipse = resolveLunarEclipse(id, snapshot)
		if (!eclipse) return undefined

		const { result, provenance } = eclipseEphemeris(snapshot, eclipse.maximalTime).run((sunMoon, source) => {
			const key = `${source}:${eclipseId(eclipse)}:${location.longitude}:${location.latitude}`
			let circumstancesHere = this.#locals.get(key)

			if (!circumstancesHere) {
				circumstancesHere = circumstances(eclipse, location, sunMoon)
				this.#locals.set(key, circumstancesHere)
			}

			// The state at a fraction of the eclipse, on the same Sun and Moon as its contacts.
			const instant = typeof view.event === 'number' ? computeLocalLunarEclipseInstant(eclipse, deg(location.longitude), deg(location.latitude), circumstancesHere.events, view.event, sunMoon) : undefined
			return { local: circumstancesHere, instant }
		})

		return localLunarEclipse(eclipse, location, view, result.local, provenance, result.instant)
	}
}

// Reads the presentation of the Local View from the `event` (a contact, or a fraction of the eclipse in [0, 1]),
// `orientation`, `handedness`, and `ghosts` query parameters, each defaulting to DEFAULT_VIEW_OPTIONS.
function viewParams(params: URLSearchParams): LunarEclipseViewOptions {
	const ghosts = params.get('ghosts')
	const event = params.get('event')

	return {
		event: event === null ? DEFAULT_VIEW_OPTIONS.event : LUNAR_CONTACT_KINDS.has(event as LunarEclipseContactKind) ? (event as LunarEclipseContactKind) : Number(event),
		orientation: (params.get('orientation') as LocalLunarViewOrientationMode | null) ?? DEFAULT_VIEW_OPTIONS.orientation,
		handedness: (params.get('handedness') as LocalLunarViewHandedness | null) ?? DEFAULT_VIEW_OPTIONS.handedness,
		ghosts: ghosts === null ? DEFAULT_VIEW_OPTIONS.ghosts : ghosts === 'true',
	}
}

// Answers an id that names no eclipse.
function lunarEclipseNotFound() {
	return eclipseNotFound('Lunar eclipse not found')
}

// Creates the lunar eclipse routes.
export function createLunarEclipseRoutes(service: LunarEclipseService) {
	return {
		'/api/eclipses/lunar': {
			// The eclipse nearest `time` (Unix milliseconds, now when absent) in `direction` (next when absent); with
			// `longitude` and `latitude`, the nearest one whose Moon is above their horizon at some instant, or 404
			// when none is within MAX_VISIBLE_SCAN eclipses.
			GET: async (req: Request) => {
				const params = new URL(req.url).searchParams
				const time = params.get('time')
				const at = time ? +time : Date.now()
				const direction = (params.get('direction') as EclipseDirection | null) ?? 'next'
				if (!params.has('longitude') || !params.has('latitude')) return Response.json(service.find(at, direction))

				const eclipse = await service.findVisible(at, direction, locationParams(params), req.signal)
				return eclipse ? Response.json(eclipse) : errorResponse(`No lunar eclipse visible here within ${MAX_VISIBLE_SCAN} eclipses`, 404, 'notFound' satisfies LunarEclipseErrorCode)
			},
		},
		'/api/eclipses/lunar/:id/map': {
			// Global map of an eclipse; 404 when the id names none.
			GET: (req) => {
				const map = service.map(req.params.id)
				return map ? Response.json(map) : lunarEclipseNotFound()
			},
		},
		'/api/eclipses/lunar/:id/local': {
			// Circumstances of an eclipse from the place of `longitude` and `latitude`, with the Local View drawn as
			// `event`, `orientation`, `handedness`, and `ghosts` ask; 404 when the id names no eclipse.
			GET: (req) => {
				const params = new URL(req.url).searchParams
				const local = service.local(req.params.id, locationParams(params), viewParams(params))
				return local ? Response.json(local) : lunarEclipseNotFound()
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
