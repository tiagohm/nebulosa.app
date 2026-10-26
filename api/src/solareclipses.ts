import type { SolarEclipse } from 'nebulosa/src/astronomy/bodies/sun'
import { sunMoonPosition } from 'nebulosa/src/astronomy/events/eclipse/eclipse'
import {
	computeLocalSolarEclipseCircumstances,
	computeLocalSolarEclipseViewGeometry,
	type LocalCentralPhaseKind,
	type LocalEclipseContactKind,
	type LocalSolarEclipseCircumstances,
	type LocalSolarEclipseSvgShape,
	type LocalSunMotion,
	type LocalViewHandedness,
	type LocalViewOrientationMode,
	type LocalVisibilityKind,
} from 'nebulosa/src/astronomy/events/eclipse/solar/local'
import type { PolynomialBesselianElements } from 'nebulosa/src/astronomy/events/eclipse/solar/map'
import { timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { type EclipseDirection, type EclipseLocation, eclipseNotFound, locationParams, yieldEventLoop } from './eclipses'
import { errorResponse } from './http'
import { LruCache } from './sky/ephemeris'
import { findSolarEclipse, resolveSolarEclipse, type SolarEclipseMap, type SolarEclipseSummary, solarEclipseElements, solarEclipseId, solarEclipseSummary } from './solareclipses.map'

// Solar eclipses for the Solar Eclipse Map tool: stateless, read-only queries over the toolkit's solar eclipse
// engine (core/src/astronomy/events/eclipse/solar), answered under /api/eclipses/solar with the conventions of
// eclipses.ts. An eclipse is named by its id, the Unix milliseconds of its greatest eclipse, so no eclipse is
// stored on the server. The global map (solareclipses.map.ts) is computed on a worker of its own
// (solareclipses.worker.ts), since it costs hundreds of milliseconds; the local circumstances, tens at most, are
// computed here. Times are Unix milliseconds (UTC), angles and geographic positions degrees (longitude east
// positive), durations seconds, widths kilometers; values an eclipse or a place lacks are absent, never zero.
// Locally, visible means the Sun's center at or above the 0° horizon, without terrain or the site's elevation.

export type { HybridEclipseKind, SolarEclipseExtreme, SolarEclipseMap, SolarEclipseMapPoint, SolarEclipsePathKind, SolarEclipsePaths, SolarEclipsePointKind, SolarEclipseSummary, SolarEclipseType } from './solareclipses.map'
export type { LocalCentralPhaseKind, LocalEclipseContactKind, LocalSolarEclipseSvgShape, LocalSunMotion, LocalViewHandedness, LocalViewOrientationMode, LocalVisibilityKind }

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

// Magnitude, ratio, durations in seconds, and the width in kilometers of the central shadow's chord through the
// place (not the width of the path on the central line); each is absent when the place lacks it.
export type LocalSolarEclipseDetails = LocalSolarEclipseCircumstances['details']

// Presentation of the Local View: the Sun and the Moon as seen from a place at a contact.
export interface SolarEclipseViewOptions {
	// Contact drawn; MAX, then the first contact, when the place lacks it.
	readonly event: LocalEclipseContactKind
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
	// Contact drawn, absent when the place has none.
	readonly selectedEvent?: LocalEclipseContactKind
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
	// Magnitude, ratio, durations, and shadow chord.
	readonly details: LocalSolarEclipseDetails
	// Contacts the place has, in chronological order.
	readonly events: readonly LocalSolarEclipseContact[]
	// Local View.
	readonly view: SolarEclipseLocalView
}

// Request to the map worker.
export interface SolarEclipseMapWorkerRequest {
	// Id of the job, echoed by the response.
	readonly jobId: string
	// Id of the eclipse.
	readonly id: string
}

// Response of the map worker.
export type SolarEclipseMapWorkerResponse = { readonly jobId: string; readonly status: 'computed'; readonly map: SolarEclipseMap } | { readonly jobId: string; readonly status: 'notFound' } | { readonly jobId: string; readonly status: 'failed'; readonly error: string }

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

// Returns the toolkit's circumstances of an eclipse for a place, from its elements, on the 0° horizon.
function circumstances(pbe: PolynomialBesselianElements, { longitude, latitude }: EclipseLocation) {
	return computeLocalSolarEclipseCircumstances(pbe, deg(longitude), deg(latitude), { sunMoonPosition, horizonAltitude: 0 })
}

// Returns the circumstances of an eclipse from a place, with its Local View drawn as view asks.
export function localSolarEclipse(eclipse: SolarEclipse, location: EclipseLocation, view: SolarEclipseViewOptions, local: LocalSolarEclipseCircumstances): LocalSolarEclipse {
	const events: LocalSolarEclipseContact[] = []

	for (const kind of CONTACT_ORDER) {
		const event = local.events[kind]
		if (!event) continue
		const { observable, sunAltitude, positionAngle, zenithAngle, magnitude, moonSunDiameterRatio, centralPhaseKind } = event
		events.push({ kind, time: timeToUnixMillis(event.time), observable, altitude: toDeg(sunAltitude), positionAngle: positionAngle === undefined ? undefined : toDeg(positionAngle), zenithAngle: zenithAngle === undefined ? undefined : toDeg(zenithAngle), magnitude, moonSunDiameterRatio, centralPhaseKind })
	}

	const geometry = computeLocalSolarEclipseViewGeometry(local, { selectedEvent: view.event, orientationMode: view.orientation, handedness: view.handedness, includeGhostDisks: view.ghosts, includeHorizon: true })
	const { kind, text, hasGeometricEclipse, hasObservableEclipse, hasCentralPhase, centralPhaseKind, sunMotion, completeness } = local.visibility

	return {
		eclipseId: solarEclipseId(eclipse),
		location,
		visibility: { kind, text, hasGeometricEclipse, hasObservableEclipse, hasCentralPhase, centralPhaseKind, sunMotion, completeness },
		details: local.details,
		events,
		view: { width: geometry.width, height: geometry.height, selectedEvent: geometry.selectedEvent, shapes: geometry.shapes },
	}
}

// Solar eclipse queries. Maps are computed on a worker, one at a time, and concurrent requests for the same map
// share one job; the latest maps, elements, and local circumstances are kept, so moving between contacts or
// redrawing the Local View does not compute them again.
export class SolarEclipseService {
	readonly #maps = new LruCache<SolarEclipseMap>(CACHE_LIMIT)
	readonly #elements = new LruCache<PolynomialBesselianElements>(CACHE_LIMIT)
	readonly #locals = new LruCache<LocalSolarEclipseCircumstances>(CACHE_LIMIT)
	// Maps being computed, by id.
	readonly #pending = new Map<string, Promise<SolarEclipseMap | undefined>>()
	// Worker kept between maps.
	#idle?: SolarEclipseMapWorker
	// Settles when the previous map ended; maps run one at a time.
	#queue: Promise<unknown> = Promise.resolve()

	// Creates the service; timeout bounds every map in milliseconds and startWorker creates map workers.
	constructor(
		readonly timeout: number = MAP_TIMEOUT,
		readonly startWorker: SolarEclipseMapWorkerFactory = startSolarEclipseMapWorker,
	) {}

	// Returns the eclipse nearest time (Unix milliseconds) in a direction.
	find(time: number, direction: EclipseDirection): SolarEclipseSummary {
		return solarEclipseSummary(findSolarEclipse(time, direction))
	}

	// Returns the eclipse nearest time (Unix milliseconds) in a direction whose Sun is above the horizon of a place
	// at some instant of the local eclipse, trying MAX_VISIBLE_SCAN eclipses at most; undefined when none of them
	// is, or when the signal aborts. Each candidate costs tens of milliseconds, so the event loop runs between them;
	// the caches are left alone, so a search never evicts what is shown.
	async findVisible(time: number, direction: EclipseDirection, location: EclipseLocation, signal?: AbortSignal): Promise<SolarEclipseSummary | undefined> {
		let cursor = time

		for (let i = 0; i < MAX_VISIBLE_SCAN; i++) {
			const eclipse = findSolarEclipse(cursor, direction)
			if (circumstances(solarEclipseElements(eclipse), location).visibility.hasObservableEclipse) return solarEclipseSummary(eclipse)
			cursor = +solarEclipseId(eclipse)
			await yieldEventLoop()
			if (signal?.aborted) return undefined
		}

		return undefined
	}

	// Returns the global map of the eclipse an id names, or undefined when it names none; rejects when the worker
	// fails or times out.
	map(id: string): Promise<SolarEclipseMap | undefined> {
		const cached = this.#maps.get(id)
		if (cached) return Promise.resolve(cached)
		if (!resolveSolarEclipse(id)) return Promise.resolve(undefined)

		let pending = this.#pending.get(id)

		if (!pending) {
			const run = this.#queue.then(() => this.#compute(id))
			this.#queue = run.catch(() => undefined)
			pending = run.finally(() => this.#pending.delete(id))
			this.#pending.set(id, pending)
		}

		return pending
	}

	// Returns the circumstances of the eclipse an id names from a place, or undefined when it names none.
	local(id: string, location: EclipseLocation, view: SolarEclipseViewOptions): LocalSolarEclipse | undefined {
		const eclipse = resolveSolarEclipse(id)
		if (!eclipse) return undefined

		const key = `${id}:${location.longitude}:${location.latitude}`
		let local = this.#locals.get(key)

		if (!local) {
			local = circumstances(this.#elementsOf(id, eclipse), location)
			this.#locals.set(key, local)
		}

		return localSolarEclipse(eclipse, location, view, local)
	}

	// Terminates the idle worker. Maps still queued start a new one.
	dispose() {
		this.#idle?.terminate()
		this.#idle = undefined
	}

	// Same as dispose, so the service can be scoped with `using`.
	[Symbol.dispose]() {
		this.dispose()
	}

	// Returns the elements of an eclipse, fitted once while they stay in the cache.
	#elementsOf(id: string, eclipse: SolarEclipse) {
		let elements = this.#elements.get(id)

		if (!elements) {
			elements = solarEclipseElements(eclipse)
			this.#elements.set(id, elements)
		}

		return elements
	}

	// Computes one map on the worker and keeps it.
	async #compute(id: string): Promise<SolarEclipseMap | undefined> {
		const worker = this.#idle ?? this.startWorker()
		this.#idle = undefined
		const request: SolarEclipseMapWorkerRequest = { jobId: crypto.randomUUID(), id }
		const { promise, resolve, reject } = Promise.withResolvers<SolarEclipseMap | undefined>()
		let reusable = false

		const onMessage = (event: MessageEvent<SolarEclipseMapWorkerResponse>) => {
			const response = event.data
			if (response.jobId !== request.jobId) return
			// A map that threw leaves the worker usable; only a crash or a timeout does not.
			reusable = true
			if (response.status === 'computed') resolve(response.map)
			else if (response.status === 'notFound') resolve(undefined)
			else reject(new Error(`The solar eclipse map failed: ${response.error}`))
		}

		const onError = (event: ErrorEvent) => reject(new Error(`The solar eclipse map worker died: ${event.message}`))
		const timer = setTimeout(() => reject(new Error(`The solar eclipse map did not finish within ${this.timeout / 1000} s`)), this.timeout)

		worker.addEventListener('message', onMessage)
		worker.addEventListener('error', onError)

		try {
			worker.postMessage(request, [])
			const map = await promise
			if (map) this.#maps.set(id, map)
			return map
		} finally {
			clearTimeout(timer)
			worker.removeEventListener('message', onMessage)
			worker.removeEventListener('error', onError)
			// A map cannot be interrupted, so a worker still computing one is terminated.
			if (reusable) this.#idle = worker
			else worker.terminate()
		}
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

// Reads the presentation of the Local View from the `event`, `orientation`, `handedness`, and `ghosts` query
// parameters, each defaulting to DEFAULT_VIEW_OPTIONS.
function viewParams(params: URLSearchParams): SolarEclipseViewOptions {
	const ghosts = params.get('ghosts')

	return {
		event: (params.get('event') as LocalEclipseContactKind | null) ?? DEFAULT_VIEW_OPTIONS.event,
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
