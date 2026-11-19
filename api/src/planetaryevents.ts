import { ephemerisUnavailableResponse, EphemerisUnavailableError } from './ephemeris.chain'
import { LruCache } from './lrucache'
import type { PlanetarySourceErrorCode } from './planetary.source'
import { computeSeries, PLANETARY_EVENTS_MODEL_VERSION, type PlanetaryEvent, type PlanetaryEventSeries, type PlanetaryEventSeriesRequest, type PlanetaryEventsKernels, type PlanetaryEventsSearchRequest, type PlanetaryEventsSignature, planetaryEventsSignature, searchPlanetaryEvents } from './planetaryevents.astronomy'
import { computeVisibility, type PlanetaryEventsVisibility, type PlanetaryEventsVisibilityRequest, type PlanetaryEventVisibility, type PlanetaryVisibilityEvent } from './planetaryevents.visibility'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'

// Planetary Events service: a read-only almanac of the geocentric phenomena of Mercury to Neptune over a range (see
// planetaryevents.astronomy.ts), the visibility of a batch of them from a site (planetaryevents.visibility.ts), and the
// sampled curves of one for a chart. Answers are computed on request and kept in bounded in-memory caches whose keys hold
// every input that changes them: the search and the curves by the kernel generation and the offline switch, never by a
// site; the visibility by the event and the site's place, never by a time zone, which only formats. Nothing is stored,
// no event is published, and nothing here moves a device, changes the Sky clock or a site, starts an operation, or asks a
// remote service.

// Stable codes of the error responses: 503 when the kernel set kept changing during a computation (generationChanged).
export type PlanetaryEventsErrorCode = PlanetarySourceErrorCode

// Dependencies of the service.
export interface PlanetaryEventsOptions {
	// Kernels of the SPICE Kernel Library and the offline switch.
	readonly kernels: PlanetaryEventsKernels
}

// Answer of POST /api/planetary-events/search.
export interface PlanetaryEventsSearch {
	// First instant of the range, Unix milliseconds.
	readonly start: number
	// End of the range, exclusive, Unix milliseconds.
	readonly end: number
	// Events whose instant falls in the range, chronologically.
	readonly events: readonly PlanetaryEvent[]
	readonly signature: PlanetaryEventsSignature
}

// Search answers kept: a few tabs, each with a range and a selection.
const SEARCH_CACHE_LIMIT = 8

// Event visibilities kept: a few years of events for a few sites.
const VISIBILITY_CACHE_LIMIT = 1024

// Series answers kept.
const SERIES_CACHE_LIMIT = 32

// Read-only planetary phenomena.
export class PlanetaryEventsService {
	readonly #searches = new LruCache<PlanetaryEventsSearch>(SEARCH_CACHE_LIMIT)
	readonly #visibility = new LruCache<PlanetaryEventVisibility>(VISIBILITY_CACHE_LIMIT)
	readonly #series = new LruCache<PlanetaryEventSeries>(SERIES_CACHE_LIMIT)

	constructor(readonly options: PlanetaryEventsOptions) {}

	// The events of a range, cached by every input of the request and the kernel identity.
	async search(request: PlanetaryEventsSearchRequest, signal?: AbortSignal): Promise<PlanetaryEventsSearch> {
		const key = (snapshot: SpiceKernelSnapshot) => {
			const { start, end, bodies, kinds, appulseThreshold } = request
			return JSON.stringify(['search', PLANETARY_EVENTS_MODEL_VERSION, start, end, [...bodies].sort(), [...kinds].sort(), appulseThreshold, snapshot.offline, snapshot.generation])
		}
		const cached = this.#searches.get(key(this.options.kernels.current()))
		if (cached) return cached

		const { events, sourced } = await searchPlanetaryEvents(this.options.kernels, request, signal)
		const answer: PlanetaryEventsSearch = { start: request.start, end: request.end, events, signature: planetaryEventsSignature(sourced.source, sourced.snapshot, request.bodies) }
		this.#searches.set(key(sourced.snapshot), answer)
		return answer
	}

	// The visibility of each event of a batch from the site, each cached by the event, the site's place, the threshold, and
	// the kernel generation; only the events not cached are computed, and an aborted batch caches nothing.
	async visibility(request: PlanetaryEventsVisibilityRequest, signal?: AbortSignal): Promise<PlanetaryEventsVisibility> {
		const { site, appulseThreshold } = request
		const key = (event: PlanetaryVisibilityEvent, snapshot: SpiceKernelSnapshot) => JSON.stringify(['visibility', PLANETARY_EVENTS_MODEL_VERSION, event.id, site.latitude, site.longitude, site.elevation, appulseThreshold, snapshot.generation])
		const current = this.options.kernels.current()
		const { visibility, snapshot } = await computeVisibility(this.options.kernels, request, (event) => this.#visibility.get(key(event, current)), signal)
		for (const event of request.events) this.#visibility.set(key(event, snapshot), visibility.get(event.id)!)
		return { visibility: Object.fromEntries(visibility) }
	}

	// The sampled curves of one event, cached by the event and the kernel identity.
	async series(request: PlanetaryEventSeriesRequest, signal?: AbortSignal): Promise<PlanetaryEventSeries> {
		const key = (snapshot: SpiceKernelSnapshot) => JSON.stringify(['series', PLANETARY_EVENTS_MODEL_VERSION, request.kind, request.bodies, request.time, snapshot.offline, snapshot.generation])
		const cached = this.#series.get(key(this.options.kernels.current()))
		if (cached) return cached

		const { sourced, ...series } = await computeSeries(this.options.kernels, request, signal)
		const answer: PlanetaryEventSeries = { ...series, signature: planetaryEventsSignature(sourced.source, sourced.snapshot, request.bodies) }
		this.#series.set(key(sourced.snapshot), answer)
		return answer
	}
}

// Answers a computation, turning an unavailable kernel source into 503 with its reason and the state it lacked.
async function answer(compute: () => Promise<unknown>): Promise<Response> {
	try {
		return Response.json(await compute())
	} catch (error) {
		if (!(error instanceof EphemerisUnavailableError)) throw error
		return ephemerisUnavailableResponse(error)
	}
}

// Routes of the Planetary Events almanac. A request that left stops between chunks and is not answered.
export function createPlanetaryEventsRoutes(service: PlanetaryEventsService) {
	return {
		'/api/planetary-events/search': {
			// The events over the range of the body (PlanetaryEventsSearchRequest → PlanetaryEventsSearch).
			POST: async (req) => {
				const request = (await req.json()) as PlanetaryEventsSearchRequest
				return answer(() => service.search(request, req.signal))
			},
		},
		'/api/planetary-events/visibility': {
			// The visibility of the events of the body from its site (PlanetaryEventsVisibilityRequest → PlanetaryEventsVisibility).
			POST: async (req) => {
				const request = (await req.json()) as PlanetaryEventsVisibilityRequest
				return answer(() => service.visibility(request, req.signal))
			},
		},
		'/api/planetary-events/series': {
			// The sampled curves of the event of the body, for display only (PlanetaryEventSeriesRequest → PlanetaryEventSeries).
			POST: async (req) => {
				const request = (await req.json()) as PlanetaryEventSeriesRequest
				return answer(() => service.series(request, req.signal))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
