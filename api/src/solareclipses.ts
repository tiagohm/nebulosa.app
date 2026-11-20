import type { SolarEclipse } from 'nebulosa/src/astronomy/bodies/sun'
import type { SunMoonProvider } from 'nebulosa/src/astronomy/events/eclipse/eclipse'
import {
	computeLocalSolarEclipseCircumstances,
	computeLocalSolarEclipseInstant,
	computeLocalSolarEclipseViewGeometry,
	type CentralLineSide,
	type LocalCentralPhaseKind,
	type LocalEclipseContactKind,
	type LocalSolarEclipseCircumstances,
	type LocalSolarEclipseInstant,
	type LocalSolarEclipseSvgShape,
	type LocalSunMotion,
	type LocalViewHandedness,
	type LocalViewOrientationMode,
	type LocalVisibilityKind,
} from 'nebulosa/src/astronomy/events/eclipse/solar/local'
import type { PolynomialBesselianElements } from 'nebulosa/src/astronomy/events/eclipse/solar/map'
import { timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { type EclipseDirection, eclipseEphemeris, type EclipseLocation, eclipseNotFound, locationParams } from './eclipses'
import { type EphemerisProvenance, NO_EPHEMERIS_KERNELS } from './ephemeris.chain'
import { errorResponse } from './http'
import { LruCache } from './lrucache'
import type { PlanetaryKernels } from './planetary.source'
import { findSolarEclipse, resolveSolarEclipse, type SolarEclipseMap, type SolarEclipseSummary, solarEclipseElements, solarEclipseId, solarEclipseSummary } from './solareclipses.map'
import { yieldToEventLoop } from './util'
import { runPooledWorkerJob, WorkerPool } from './workerjob'

// Solar eclipses for the Solar Eclipse Map tool: stateless, read-only queries over the toolkit's solar eclipse
// engine (core/src/astronomy/events/eclipse/solar), answered under /api/eclipses/solar with the conventions of
// eclipses.ts. An eclipse is named by its id, the Unix milliseconds of its greatest eclipse, so no eclipse is
// stored on the server. The Sun, the Earth, and the Moon come from the ephemeris of eclipses.ts, the kernels of
// the SPICE Kernel Library when they cover the eclipse, read once per request. The global map (solareclipses.map.ts)
// is computed on a worker of its own (solareclipses.worker.ts), since it costs hundreds of milliseconds, from the
// eclipse and the elements found here; the elements and the local circumstances, tens of milliseconds at most, are
// computed here. Times are Unix milliseconds (UTC), angles and geographic positions degrees (longitude east
// positive), durations seconds, widths kilometers; values an eclipse or a place lacks are absent, never zero.
// Locally, visible means the Sun's center at or above the 0° horizon, without terrain or the site's elevation.

export type { HybridEclipseKind, SolarEclipseExtreme, SolarEclipseMap, SolarEclipseMapPoint, SolarEclipsePathKind, SolarEclipsePaths, SolarEclipsePointKind, SolarEclipseSummary, SolarEclipseType } from './solareclipses.map'
export type { CentralLineSide, LocalCentralPhaseKind, LocalEclipseContactKind, LocalSolarEclipseSvgShape, LocalSunMotion, LocalViewHandedness, LocalViewOrientationMode, LocalVisibilityKind }

// Codes of the errors of the solar eclipse routes.
export type SolarEclipseErrorCode = 'notFound' | 'computationFailed'

// A contact as seen from a place: C1 and C4 begin and end the partial eclipse, C2 and C3 the total or annular one,
// and MAX is the greatest eclipse there.
export interface LocalSolarEclipseContact {
	// Contact.
	readonly kind: LocalEclipseContactKind
	// Instant, in Unix milliseconds (UTC).
	readonly time: number
	// Whether the Sun's center is at or above the horizon.
	readonly observable: boolean
	// Apparent altitude of the Sun's center, in degrees.
	readonly altitude: number
	// Apparent azimuth of the Sun's center, in degrees from north through east, [0, 360).
	readonly azimuth: number
	// Position angle of the contact point on the solar limb, in degrees from celestial north through east, [0, 360);
	// absent when the direction is undefined, as at a perfectly central maximum.
	readonly positionAngle?: number
	// Angle of the contact point on the solar limb, in degrees from the zenith, [0, 360); absent like positionAngle.
	readonly zenithAngle?: number
	// Magnitude at the contact: the fraction of the solar diameter covered by the Moon, dimensionless.
	readonly magnitude: number
	// Moon/Sun apparent diameter ratio at the contact, when known.
	readonly moonSunDiameterRatio?: number
	// Whether the eclipse is total, annular, or neither there at the contact.
	readonly centralPhaseKind: LocalCentralPhaseKind
}

// Visibility of an eclipse from a place.
export interface LocalSolarEclipseVisibility {
	// Classification over the whole eclipse.
	readonly kind: LocalVisibilityKind
	// Classification meant for people.
	readonly text: string
	// Whether the shadow reaches the place, whatever the horizon.
	readonly hasGeometricEclipse: boolean
	// Whether the Sun is above the horizon at some instant of the local eclipse.
	readonly hasObservableEclipse: boolean
	// Whether the total or annular shadow reaches the place.
	readonly hasCentralPhase: boolean
	// Whether the central phase is total or annular, or none for a partial eclipse there.
	readonly centralPhaseKind: LocalCentralPhaseKind
	// Whether the Sun rises or sets across the eclipse, or neither.
	readonly sunMotion: LocalSunMotion
	// Whether the contacts expected were all found; when not, the classification rests on those found.
	readonly completeness: {
		// Whether C1 and C4 were both found.
		readonly partialContactsComplete: boolean
		// Whether C2 and C3 were both found, or the place has no central phase.
		readonly centralContactsComplete: boolean
	}
}

// Magnitude, ratio, durations in seconds, and two widths in kilometers, each absent when the place lacks it: the width
// of the path through the place, between the limits of the central phase and across the central line, and the
// shadow's chord through it, the narrowest width of the shadow on the ground at the local maximum. At a low Sun the
// path can be several times wider than the chord. centralLineDistance is the ground distance, in kilometers, from
// the place to the central line and the compass side of the line it is on, inside the path or outside it; absent for
// an eclipse without a central line.
export type LocalSolarEclipseDetails = LocalSolarEclipseCircumstances['details']

// Presentation of the Local View: the Sun and the Moon as seen from a place at a contact.
export interface SolarEclipseViewOptions {
	// Contact drawn, MAX, then the first contact, when the place lacks it; or a fraction in [0, 1] of the local
	// eclipse, 0 being C1 and 1 being C4, drawn between the contacts (MAX's view without C1 and C4).
	readonly event: LocalEclipseContactKind | number
	// Whether up is the zenith or celestial north.
	readonly orientation: LocalViewOrientationMode
	// Whether east is to the right or to the left.
	readonly handedness: LocalViewHandedness
	// Whether the Moon disks of the other contacts are drawn too.
	readonly ghosts: boolean
}

// Geometry of the Local View, a schematic diagram in pixels with the origin at the top-left corner and y down.
export interface SolarEclipseLocalView {
	// Width, in pixels.
	readonly width: number
	// Height, in pixels.
	readonly height: number
	// Contact drawn, absent when the place has none or an instant between the contacts is drawn.
	readonly selectedEvent?: LocalEclipseContactKind
	// Instant drawn, in Unix milliseconds (UTC); absent when the place has no contact.
	readonly time?: number
	// Position angle at the instant drawn, in degrees from celestial north through east, [0, 360): of the contact point on
	// the solar limb at a contact, or between the contacts of the limb point nearest the Moon's center; absent when
	// undefined, as at a perfectly central maximum.
	readonly positionAngle?: number
	// The same angle measured from the direction of the zenith, in degrees, [0, 360); absent like positionAngle.
	readonly zenithAngle?: number
	// Shapes in painting order.
	readonly shapes: readonly LocalSolarEclipseSvgShape[]
}

// Circumstances of a solar eclipse from a place.
export interface LocalSolarEclipse {
	// Id of the eclipse.
	readonly eclipseId: string
	// Place.
	readonly location: EclipseLocation
	// Visibility.
	readonly visibility: LocalSolarEclipseVisibility
	// Magnitude, ratio, durations, path width, and shadow chord.
	readonly details: LocalSolarEclipseDetails
	// Contacts the place has, in chronological order.
	readonly events: readonly LocalSolarEclipseContact[]
	// Local View.
	readonly view: SolarEclipseLocalView
	// Source of the Sun and the Moon of the circumstances.
	readonly ephemeris: EphemerisProvenance
}

// Request to the map worker.
export interface SolarEclipseMapWorkerRequest {
	// Id of the job, echoed by the response.
	readonly jobId: string
	// The eclipse, refined on its ephemeris.
	readonly eclipse: SolarEclipse
	// Its polynomial Besselian elements, fitted on the same ephemeris.
	readonly elements: PolynomialBesselianElements
}

// Response of the map worker.
export type SolarEclipseMapWorkerResponse = { readonly jobId: string; readonly status: 'computed'; readonly map: SolarEclipseMap } | { readonly jobId: string; readonly status: 'failed'; readonly error: string }

// Worker thread of the maps. `unref` is a Bun extension that the DOM Worker type lacks.
type SolarEclipseMapWorker = Worker & Pick<Bun.Worker, 'unref'>

// Starts a map worker; injectable so tests can observe the worker lifecycle.
export type SolarEclipseMapWorkerFactory = () => SolarEclipseMapWorker

// Time a map may take, in milliseconds, before its worker is terminated; a map takes well under a second.
export const MAP_TIMEOUT = 30000

// Eclipses tried at most by the visible-only search, about two decades; the search then gives up.
export const MAX_VISIBLE_SCAN = 48

// Maps, elements, and local circumstances kept at most.
const CACHE_LIMIT = 8

// Contacts in chronological order.
const CONTACT_ORDER: readonly LocalEclipseContactKind[] = ['C1', 'C2', 'MAX', 'C3', 'C4']

// Default presentation of the Local View.
const DEFAULT_VIEW_OPTIONS: SolarEclipseViewOptions = { event: 'MAX', orientation: 'zenith', handedness: 'eastRight', ghosts: true }

// Returns the toolkit's circumstances of an eclipse for a place, from its elements and the Sun and the Moon they were
// fitted on, on the 0° horizon.
function circumstances(pbe: PolynomialBesselianElements, { longitude, latitude }: EclipseLocation, sunMoon: SunMoonProvider) {
	return computeLocalSolarEclipseCircumstances(pbe, deg(longitude), deg(latitude), { sunMoonPosition: sunMoon, horizonAltitude: 0 })
}

// Options of the solar eclipse service.
export interface SolarEclipseServiceOptions {
	// Time a map may take, in milliseconds; MAP_TIMEOUT by default.
	readonly timeout?: number
	// Creates map workers; injectable so tests can observe the worker lifecycle.
	readonly startWorker?: SolarEclipseMapWorkerFactory
	// Kernels of the SPICE Kernel Library; none by default, so every eclipse is computed on the theories.
	readonly kernels?: PlanetaryKernels
}

// Returns the circumstances of an eclipse from a place, with its Local View drawn as view asks: at instant when
// given (the state at view's fraction), otherwise at view's contact.
export function localSolarEclipse(eclipse: SolarEclipse, location: EclipseLocation, view: SolarEclipseViewOptions, local: LocalSolarEclipseCircumstances, ephemeris: EphemerisProvenance, instant?: LocalSolarEclipseInstant): LocalSolarEclipse {
	const events: LocalSolarEclipseContact[] = []

	for (const kind of CONTACT_ORDER) {
		const event = local.events[kind]
		if (!event) continue
		const { observable, sunAltitude, sunAzimuth, positionAngle, zenithAngle, magnitude, moonSunDiameterRatio, centralPhaseKind } = event
		events.push({
			kind,
			time: timeToUnixMillis(event.time),
			observable,
			altitude: toDeg(sunAltitude),
			azimuth: toDeg(sunAzimuth),
			positionAngle: positionAngle === undefined ? undefined : toDeg(positionAngle),
			zenithAngle: zenithAngle === undefined ? undefined : toDeg(zenithAngle),
			magnitude,
			moonSunDiameterRatio,
			centralPhaseKind,
		})
	}

	const geometry = computeLocalSolarEclipseViewGeometry(local, { selectedEvent: typeof view.event === 'number' ? 'MAX' : view.event, instant, orientationMode: view.orientation, handedness: view.handedness, includeGhostDisks: view.ghosts, includeHorizon: true, height: 300 })
	const drawn = instant ?? (geometry.selectedEvent && local.events[geometry.selectedEvent])
	const { kind, text, hasGeometricEclipse, hasObservableEclipse, hasCentralPhase, centralPhaseKind, sunMotion, completeness } = local.visibility

	return {
		eclipseId: solarEclipseId(eclipse),
		location,
		visibility: { kind, text, hasGeometricEclipse, hasObservableEclipse, hasCentralPhase, centralPhaseKind, sunMotion, completeness },
		details: local.details,
		events,
		view: {
			width: geometry.width,
			height: geometry.height,
			selectedEvent: geometry.selectedEvent,
			time: drawn ? timeToUnixMillis(drawn.time) : undefined,
			positionAngle: drawn?.positionAngle === undefined ? undefined : toDeg(drawn.positionAngle),
			zenithAngle: drawn?.zenithAngle === undefined ? undefined : toDeg(drawn.zenithAngle),
			shapes: geometry.shapes,
		},
		ephemeris,
	}
}

// Solar eclipse queries. Maps are computed on a worker, one at a time, and concurrent requests for the same map
// share one job; the latest maps, elements, and local circumstances are kept by ephemeris source and kernel
// generation, so moving between contacts or redrawing the Local View does not compute them again, and a change of the
// kernels does.
export class SolarEclipseService {
	readonly #maps = new LruCache<SolarEclipseMap>(CACHE_LIMIT)
	readonly #elements = new LruCache<PolynomialBesselianElements>(CACHE_LIMIT)
	readonly #locals = new LruCache<LocalSolarEclipseCircumstances>(CACHE_LIMIT)
	// Maps being computed, by id.
	readonly #pending = new Map<string, Promise<SolarEclipseMap | undefined>>()
	// Map workers kept between maps.
	readonly #workers = new WorkerPool(() => this.startWorker())
	// Settles when the previous map ended; maps run one at a time.
	#queue: Promise<unknown> = Promise.resolve()
	// Whether the service was disposed, after which no map starts.
	#disposed = false

	// Time a map may take, in milliseconds, before its worker is terminated.
	readonly timeout: number
	// Creates map workers.
	readonly startWorker: SolarEclipseMapWorkerFactory
	// Kernels the ephemeris of every eclipse is chosen from.
	readonly kernels: PlanetaryKernels

	// Creates the service.
	constructor({ timeout = MAP_TIMEOUT, startWorker = startSolarEclipseMapWorker, kernels = NO_EPHEMERIS_KERNELS }: SolarEclipseServiceOptions = {}) {
		this.timeout = timeout
		this.startWorker = startWorker
		this.kernels = kernels
	}

	// Returns the eclipse nearest time (Unix milliseconds) in a direction.
	find(time: number, direction: EclipseDirection): SolarEclipseSummary {
		return solarEclipseSummary(findSolarEclipse(time, direction, this.kernels.current()))
	}

	// Returns the eclipse nearest time (Unix milliseconds) in a direction whose Sun is above the horizon of a place
	// at some instant of the local eclipse, trying MAX_VISIBLE_SCAN eclipses at most; undefined when none of them
	// is, or when the signal aborts. Each candidate costs tens of milliseconds, so the event loop runs between them;
	// the caches are left alone, so a search never evicts what is shown.
	async findVisible(time: number, direction: EclipseDirection, location: EclipseLocation, signal?: AbortSignal): Promise<SolarEclipseSummary | undefined> {
		let cursor = time

		for (let i = 0; i < MAX_VISIBLE_SCAN; i++) {
			// Each candidate is one computation on the snapshot of its turn, since the kernels may change between turns.
			const snapshot = this.kernels.current()
			const eclipse = findSolarEclipse(cursor, direction, snapshot)
			const visible = eclipseEphemeris(snapshot, eclipse.maximalTime).run((sunMoon) => circumstances(solarEclipseElements(eclipse, sunMoon), location, sunMoon).visibility.hasObservableEclipse).result
			if (visible) return solarEclipseSummary(eclipse)
			cursor = +solarEclipseId(eclipse)
			await yieldToEventLoop()
			if (signal?.aborted) return undefined
		}

		return undefined
	}

	// Returns the global map of the eclipse an id names, or undefined when it names none; rejects when the worker
	// fails or times out. The eclipse and its elements are found here, synchronously on one kernel snapshot, and only
	// the geometry waits for the worker, which is told the source of the elements.
	map(id: string): Promise<SolarEclipseMap | undefined> {
		const snapshot = this.kernels.current()
		const eclipse = resolveSolarEclipse(id, snapshot)
		if (!eclipse) return Promise.resolve(undefined)

		const { result, provenance } = eclipseEphemeris(snapshot, eclipse.maximalTime).run((sunMoon, source) => ({ elements: this.#elementsOf(eclipse, sunMoon, source), key: `${source}:${solarEclipseId(eclipse)}` }))
		const { elements, key } = result
		const cached = this.#maps.get(key)
		if (cached) return Promise.resolve(cached)

		let pending = this.#pending.get(key)

		if (!pending) {
			const run = this.#queue.then(() => this.#compute(key, eclipse, elements, provenance))
			this.#queue = run.catch(() => undefined)
			pending = run.finally(() => this.#pending.delete(key))
			this.#pending.set(key, pending)
		}

		return pending
	}

	// Returns the circumstances of the eclipse an id names from a place, or undefined when it names none.
	local(id: string, location: EclipseLocation, view: SolarEclipseViewOptions): LocalSolarEclipse | undefined {
		const snapshot = this.kernels.current()
		const eclipse = resolveSolarEclipse(id, snapshot)
		if (!eclipse) return undefined

		const { result, provenance } = eclipseEphemeris(snapshot, eclipse.maximalTime).run((sunMoon, source) => {
			const key = `${source}:${solarEclipseId(eclipse)}:${location.longitude}:${location.latitude}`
			const pbe = this.#elementsOf(eclipse, sunMoon, source)
			let circumstancesHere = this.#locals.get(key)

			if (!circumstancesHere) {
				circumstancesHere = circumstances(pbe, location, sunMoon)
				this.#locals.set(key, circumstancesHere)
			}

			// The state at a fraction of the local eclipse, on the same elements and Sun and Moon as its contacts.
			const instant = typeof view.event === 'number' ? computeLocalSolarEclipseInstant(pbe, deg(location.longitude), deg(location.latitude), circumstancesHere.events, view.event, { sunMoonPosition: sunMoon, horizonAltitude: 0 }) : undefined
			return { local: circumstancesHere, instant }
		})

		return localSolarEclipse(eclipse, location, view, result.local, provenance, result.instant)
	}

	// Terminates the idle worker; a map still running terminates its worker once it ends, and maps still queued reject.
	dispose() {
		this.#disposed = true
		this.#workers[Symbol.dispose]()
	}

	// Same as dispose, so the service can be scoped with `using`.
	[Symbol.dispose]() {
		this.dispose()
	}

	// Returns the elements of an eclipse fitted on the Sun and the Moon of the source whose key is source, once while
	// they stay in the cache.
	#elementsOf(eclipse: SolarEclipse, sunMoon: SunMoonProvider, source: string) {
		const key = `${source}:${solarEclipseId(eclipse)}`
		let elements = this.#elements.get(key)

		if (!elements) {
			elements = solarEclipseElements(eclipse, sunMoon)
			this.#elements.set(key, elements)
		}

		return elements
	}

	// Computes on the worker the map of an eclipse from its elements, fitted on the source of ephemeris, and keeps it under key.
	async #compute(key: string, eclipse: SolarEclipse, elements: PolynomialBesselianElements, ephemeris: EphemerisProvenance): Promise<SolarEclipseMap> {
		if (this.#disposed) throw new Error('The solar eclipse service was stopped')
		const jobId = Bun.randomUUIDv7()

		const map = await runPooledWorkerJob<SolarEclipseMapWorkerResponse, SolarEclipseMap>({
			pool: this.#workers,
			request: { jobId, eclipse, elements } satisfies SolarEclipseMapWorkerRequest,
			timeout: this.timeout,
			timedOut: () => new Error(`The solar eclipse map did not finish within ${this.timeout / 1000} s`),
			crashed: (event) => new Error(`The solar eclipse map worker died: ${event.message}`),
			receive: (response, settle) => {
				if (response.jobId !== jobId) return
				// A map that threw leaves the worker usable; only a crash or a timeout does not.
				if (response.status === 'computed') settle.resolve({ ...response.map, ephemeris })
				else settle.reject(new Error(`The solar eclipse map failed: ${response.error}`))
			},
		})

		this.#maps.set(key, map)
		return map
	}
}

// Starts a map worker. The compiled executable defines the embedded path of the worker (see app/build.ts);
// elsewhere it is resolved next to this module.
function startSolarEclipseMapWorker(): SolarEclipseMapWorker {
	const worker = new Worker(process.env.NEBULOSA_SOLARECLIPSE_WORKER ?? new URL('./solareclipses.worker.ts', import.meta.url)) as SolarEclipseMapWorker
	// An idle worker must not keep the process alive on its own.
	worker.unref()
	return worker
}

// Reads the presentation of the Local View from the `event` (a contact, or a fraction of the local eclipse in [0, 1]),
// `orientation`, `handedness`, and `ghosts` query parameters, each defaulting to DEFAULT_VIEW_OPTIONS.
function viewParams(params: URLSearchParams): SolarEclipseViewOptions {
	const ghosts = params.get('ghosts')
	const event = params.get('event')

	return {
		event: event === null ? DEFAULT_VIEW_OPTIONS.event : CONTACT_ORDER.includes(event as LocalEclipseContactKind) ? (event as LocalEclipseContactKind) : Number(event),
		orientation: (params.get('orientation') as LocalViewOrientationMode | null) ?? DEFAULT_VIEW_OPTIONS.orientation,
		handedness: (params.get('handedness') as LocalViewHandedness | null) ?? DEFAULT_VIEW_OPTIONS.handedness,
		ghosts: ghosts === null ? DEFAULT_VIEW_OPTIONS.ghosts : ghosts === 'true',
	}
}

// Answers an id that names no eclipse.
function solarEclipseNotFound() {
	return eclipseNotFound('Solar eclipse not found')
}

// Creates the solar eclipse routes.
export function createSolarEclipseRoutes(service: SolarEclipseService) {
	return {
		'/api/eclipses/solar': {
			// The eclipse nearest `time` (Unix milliseconds, now when absent) in `direction` (next when absent); with
			// `longitude` and `latitude`, the nearest one whose Sun is above their horizon during the local eclipse, or
			// 404 when none is within MAX_VISIBLE_SCAN eclipses.
			GET: async (req: Request) => {
				const params = new URL(req.url).searchParams
				const time = params.get('time')
				const at = time ? +time : Date.now()
				const direction = (params.get('direction') as EclipseDirection | null) ?? 'next'
				if (!params.has('longitude') || !params.has('latitude')) return Response.json(service.find(at, direction))

				const eclipse = await service.findVisible(at, direction, locationParams(params), req.signal)
				return eclipse ? Response.json(eclipse) : errorResponse(`No solar eclipse visible here within ${MAX_VISIBLE_SCAN} eclipses`, 404, 'notFound' satisfies SolarEclipseErrorCode)
			},
		},
		'/api/eclipses/solar/:id/map': {
			// Global map of an eclipse; 404 when the id names none, 500 when it could not be computed.
			GET: async (req) => {
				try {
					const map = await service.map(req.params.id)
					return map ? Response.json(map) : solarEclipseNotFound()
				} catch (error) {
					return errorResponse(error instanceof Error ? error.message : 'The solar eclipse map failed', 500, 'computationFailed' satisfies SolarEclipseErrorCode)
				}
			},
		},
		'/api/eclipses/solar/:id/local': {
			// Circumstances of an eclipse from the place of `longitude` and `latitude`, with the Local View drawn as
			// `event`, `orientation`, `handedness`, and `ghosts` ask; 404 when the id names no eclipse.
			GET: (req) => {
				const params = new URL(req.url).searchParams
				const local = service.local(req.params.id, locationParams(params), viewParams(params))
				return local ? Response.json(local) : solarEclipseNotFound()
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
