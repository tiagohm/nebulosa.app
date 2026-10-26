import { type LunarEclipse, type LunarEclipseType, nearestLunarEclipse } from 'nebulosa/src/astronomy/bodies/moon'
import { sunMoonPosition } from 'nebulosa/src/astronomy/events/eclipse/eclipse'
import {
	computeLocalLunarEclipseCircumstances,
	computeLocalLunarEclipseViewGeometry,
	type LocalLunarEclipseCircumstances,
	type LocalLunarEclipseDetails,
	type LocalLunarEclipseSvgShape,
	type LocalLunarEclipseVisibilityKind,
	type LocalLunarViewHandedness,
	type LocalLunarViewOrientationMode,
} from 'nebulosa/src/astronomy/events/eclipse/lunar/local'
import { computeLunarEclipseMapGeometry, type LunarEclipseContactKind, lunarEclipseEvents, lunarEclipseMapToSvgPaths } from 'nebulosa/src/astronomy/events/eclipse/lunar/map'
import { timeToUnixMillis, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { DEGREE_PLANE, type EclipseDirection, type EclipseLocation, eclipseNotFound, ID_SEARCH_MARGIN, locationParams, MAP_PRECISION, yieldEventLoop } from './eclipses'
import { errorResponse } from './http'
import { LruCache } from './sky/ephemeris'

// Lunar eclipses for the Lunar Eclipse Map tool: stateless, read-only queries over the toolkit's lunar eclipse
// engine (core/src/astronomy/events/eclipse/lunar), answered under /api/eclipses/lunar with the conventions of
// eclipses.ts. An eclipse is named by its id, the Unix milliseconds of its greatest eclipse, so no eclipse is
// stored on the server. Times are Unix milliseconds (UTC), angles and geographic positions degrees (longitude
// east positive), durations seconds. Visibility is the Moon's center at or above the geometric 0° horizon,
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
	// Contact whose Moon disk is drawn; MAX, then the first contact, when the eclipse lacks it.
	readonly event: LunarEclipseContactKind
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
	// Contact whose Moon disk is drawn, absent when the eclipse has none.
	readonly selectedEvent?: LunarEclipseContactKind
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

// Id of an eclipse: the Unix milliseconds of its greatest eclipse, truncated.
function eclipseId(eclipse: LunarEclipse): string {
	return `${timeToUnixMillis(eclipse.maximalTime)}`
}

// Returns the eclipse nearest an instant in a direction: the next one has an id later than time, the previous one an
// id earlier than it, so stepping from an id never returns the same eclipse. time is in Unix milliseconds.
export function findLunarEclipse(time: number, direction: EclipseDirection): LunarEclipse {
	// The greatest eclipse is up to a millisecond after its id, so the instant is moved by one millisecond away from it.
	return direction === 'next' ? nearestLunarEclipse(timeUnix((time + 1) / 1000), true) : nearestLunarEclipse(timeUnix((time - 1) / 1000), false)
}

// Returns the eclipse an id names, or undefined when it names none.
export function resolveLunarEclipse(id: string): LunarEclipse | undefined {
	const eclipse = findLunarEclipse(+id - ID_SEARCH_MARGIN, 'next')
	return eclipseId(eclipse) === id ? eclipse : undefined
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

// Returns the global map of an eclipse.
export function lunarEclipseMap(eclipse: LunarEclipse): LunarEclipseMap {
	const geometry = computeLunarEclipseMapGeometry(eclipse, sunMoonPosition)
	const lines = lunarEclipseMapToSvgPaths(geometry, DEGREE_PLANE, { precision: MAP_PRECISION })
	const fills = lunarEclipseMapToSvgPaths(geometry, DEGREE_PLANE, { fill: true, fillRegion: 'aboveHorizon', precision: MAP_PRECISION })
	const events = geometry.events.map((event) => ({ kind: event.kind, time: timeToUnixMillis(event.time), sublunar: { longitude: toDeg(event.sublunar.x), latitude: toDeg(event.sublunar.y) } }))
	return { eclipse: lunarEclipseSummary(eclipse), events, lines: contactPaths(lines.moonRiseSet), fills: contactPaths(fills.moonRiseSet) }
}

// Returns the toolkit's circumstances of an eclipse for a place, with altitudeSamples samples of the Moon's altitude.
function circumstances(eclipse: LunarEclipse, { longitude, latitude }: EclipseLocation, altitudeSamples?: number) {
	return computeLocalLunarEclipseCircumstances(eclipse, deg(longitude), deg(latitude), sunMoonPosition, { altitudeSamples })
}

// Returns the circumstances of an eclipse from a place, with its Local View drawn as view asks.
export function localLunarEclipse(eclipse: LunarEclipse, location: EclipseLocation, view: LunarEclipseViewOptions, local: LocalLunarEclipseCircumstances = circumstances(eclipse, location)): LocalLunarEclipse {
	const events: LocalLunarEclipseContact[] = []

	for (const contact of lunarEclipseEvents(eclipse)) {
		const event = local.events[contact.kind]
		if (!event) continue
		const { kind, observable, altitude, azimuth, positionAngle, zenithAngle, umbralMagnitude, penumbralMagnitude } = event
		events.push({ kind, time: timeToUnixMillis(event.time), observable, altitude: toDeg(altitude), azimuth: toDeg(azimuth), positionAngle: toDeg(positionAngle), zenithAngle: toDeg(zenithAngle), umbralMagnitude, penumbralMagnitude })
	}

	const geometry = computeLocalLunarEclipseViewGeometry(local, eclipse, { selectedEvent: view.event, orientationMode: view.orientation, handedness: view.handedness, includeGhostDisks: view.ghosts, includeHorizon: true, horizonAltitude: 0 })
	const { kind, text, hasObservableEclipse } = local.visibility

	return {
		eclipseId: eclipseId(eclipse),
		location,
		visibility: { kind, text, hasObservableEclipse },
		details: local.details,
		events,
		view: { width: geometry.width, height: geometry.height, selectedEvent: geometry.selectedEvent, shapes: geometry.shapes },
	}
}

// Lunar eclipse queries, keeping the latest maps and local circumstances so moving between contacts or redrawing
// the Local View does not compute them again.
export class LunarEclipseService {
	readonly #maps = new LruCache<LunarEclipseMap>(CACHE_LIMIT)
	readonly #locals = new LruCache<LocalLunarEclipseCircumstances>(CACHE_LIMIT)

	// Returns the eclipse nearest time (Unix milliseconds) in a direction.
	find(time: number, direction: EclipseDirection): LunarEclipseSummary {
		return lunarEclipseSummary(findLunarEclipse(time, direction))
	}

	// Returns the eclipse nearest time (Unix milliseconds) in a direction whose Moon is above the horizon of a place
	// at some instant, trying MAX_VISIBLE_SCAN eclipses at most; undefined when none of them is, or when the signal
	// aborts. Each candidate costs tens of milliseconds, so the event loop runs between them.
	async findVisible(time: number, direction: EclipseDirection, location: EclipseLocation, signal?: AbortSignal): Promise<LunarEclipseSummary | undefined> {
		let cursor = time

		for (let i = 0; i < MAX_VISIBLE_SCAN; i++) {
			const eclipse = findLunarEclipse(cursor, direction)
			if (circumstances(eclipse, location, VISIBILITY_SAMPLES).visibility.hasObservableEclipse) return lunarEclipseSummary(eclipse)
			cursor = +eclipseId(eclipse)
			await yieldEventLoop()
			if (signal?.aborted) return undefined
		}

		return undefined
	}

	// Returns the global map of the eclipse an id names, or undefined when it names none.
	map(id: string): LunarEclipseMap | undefined {
		const cached = this.#maps.get(id)
		if (cached) return cached

		const eclipse = resolveLunarEclipse(id)
		if (!eclipse) return undefined

		const map = lunarEclipseMap(eclipse)
		this.#maps.set(id, map)
		return map
	}

	// Returns the circumstances of the eclipse an id names from a place, or undefined when it names none.
	local(id: string, location: EclipseLocation, view: LunarEclipseViewOptions): LocalLunarEclipse | undefined {
		const eclipse = resolveLunarEclipse(id)
		if (!eclipse) return undefined

		const key = `${id}:${location.longitude}:${location.latitude}`
		let local = this.#locals.get(key)

		if (!local) {
			local = circumstances(eclipse, location)
			this.#locals.set(key, local)
		}

		return localLunarEclipse(eclipse, location, view, local)
	}
}

// Reads the presentation of the Local View from the `event`, `orientation`, `handedness`, and `ghosts` query
// parameters, each defaulting to DEFAULT_VIEW_OPTIONS.
function viewParams(params: URLSearchParams): LunarEclipseViewOptions {
	const ghosts = params.get('ghosts')

	return {
		event: (params.get('event') as LunarEclipseContactKind | null) ?? DEFAULT_VIEW_OPTIONS.event,
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
