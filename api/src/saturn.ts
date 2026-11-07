import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import { LruCache } from './lrucache'
import { type PlanetarySourceErrorCode, unavailableResponse } from './planetary.source'
import { SiteNightCache } from './planetary.visibility'
import {
	computeElongations,
	computeMoonsState,
	computeRingState,
	computeRingTimeline,
	computeSource,
	computeTrack,
	SATURN_MODEL_VERSION,
	SATURN_RING_DRAWING,
	type SaturnElongations,
	type SaturnElongationsRequest,
	type SaturnKernels,
	type SaturnMoonsState,
	type SaturnRingState,
	type SaturnRingTimeline,
	type SaturnRingTimelineRequest,
	type SaturnSignature,
	saturnSignature,
	type SaturnSourceReport,
	type SaturnSourceRequest,
	SaturnSourceUnavailableError,
	type SaturnStateRequest,
	type SaturnTrack,
	type SaturnTrackRequest,
	withSaturnianSource,
} from './saturn.astronomy'
import { computeEvents, type SaturnEvent, type SaturnEventsRequest, type SaturnNight } from './saturn.events'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'

// Saturn Observing Planner service: read-only predictions of Saturn's rings (the geometry at an instant and the ring-plane
// seasons over a range) and of its seven major moons (the view at an instant, their tracks, their greatest separations,
// and their phenomena with their visibility from a site). Each answer is computed on request from one ephemeris source of its scope (see saturn.astronomy.ts), so
// a rings answer survives a missing satellite kernel, and kept in bounded in-memory caches whose keys hold every input
// that changes it, including the kernel generation and the ephemeris policy. Nothing is stored; nothing here moves a
// device, changes the Sky clock or a site, starts an operation, or asks a remote service.

// Stable codes of the planner's error responses: 503 when the spkOnly policy finds the kernels unable to give a
// computation of a scope (coverageUnavailable, missingDependency, unsupportedKernel) or the kernel set kept changing
// during one (generationChanged).
export type SaturnErrorCode = PlanetarySourceErrorCode

// Dependencies of the planner.
export interface SaturnPlannerOptions {
	// Kernels of the SPICE Kernel Library and its ephemeris policy.
	readonly kernels: SaturnKernels
	// Night of a site containing an instant (Astro Weather's local night).
	readonly night: (request: AstroWeatherNightRequest) => AstroWeatherNight
}

// Events over a range.
export interface SaturnEvents {
	// First instant of the range, Unix milliseconds.
	readonly start: number
	// End of the range, exclusive, Unix milliseconds.
	readonly end: number
	// Events overlapping the range, chronologically by maximum.
	readonly events: readonly SaturnEvent[]
	// Nights of the site over the range; empty without a site.
	readonly nights: readonly SaturnNight[]
	readonly signature: SaturnSignature
}

// Ring timelines kept: a few tabs, each with a season and a zoom.
const TIMELINE_CACHE_LIMIT = 8

// Track answers kept.
const TRACK_CACHE_LIMIT = 16

// Separation answers kept.
const ELONGATIONS_CACHE_LIMIT = 16

// Event answers kept: a few tabs, each with a range and a site.
const EVENTS_CACHE_LIMIT = 16

// Read-only Saturn predictions.
export class SaturnPlannerService {
	readonly #timelines = new LruCache<SaturnRingTimeline>(TIMELINE_CACHE_LIMIT)
	readonly #tracks = new LruCache<SaturnTrack>(TRACK_CACHE_LIMIT)
	readonly #elongations = new LruCache<SaturnElongations>(ELONGATIONS_CACHE_LIMIT)
	readonly #events = new LruCache<SaturnEvents>(EVENTS_CACHE_LIMIT)
	// Nights of the sites, which hold a whole range of nights where the provider keeps fewer.
	readonly #nights: SiteNightCache

	constructor(readonly options: SaturnPlannerOptions) {
		this.#nights = new SiteNightCache(options.night)
	}

	// The disk and ring geometry at an instant, from a rings source.
	async ringState({ time }: SaturnStateRequest, signal?: AbortSignal): Promise<SaturnRingState> {
		const { results, source, snapshot } = await withSaturnianSource(this.options.kernels, 'rings', 1, (ephemeris) => computeRingState(ephemeris, time), undefined, signal)
		return { time, rings: results[0], model: SATURN_RING_DRAWING, signature: saturnSignature('rings', source, snapshot) }
	}

	// The ring openings and ring-plane events over a range, cached by range and kernel identity.
	async ringTimeline(request: SaturnRingTimelineRequest, signal?: AbortSignal): Promise<SaturnRingTimeline> {
		const cached = this.#timelines.get(rangeKey('timeline', request, this.options.kernels.current()))
		if (cached) return cached

		const { sourced, ...timeline } = await computeRingTimeline(this.options.kernels, request, signal)
		const answer: SaturnRingTimeline = { ...timeline, signature: saturnSignature('rings', sourced.source, sourced.snapshot) }
		this.#timelines.set(rangeKey('timeline', request, sourced.snapshot), answer)
		return answer
	}

	// Saturn, its rings and its moons at an instant, all from one moons source.
	async moonsState({ time }: SaturnStateRequest, signal?: AbortSignal): Promise<SaturnMoonsState> {
		const { results, source, snapshot } = await withSaturnianSource(this.options.kernels, 'moons', 1, (ephemeris) => computeMoonsState(ephemeris, time), undefined, signal)
		return { ...results[0], model: SATURN_RING_DRAWING, signature: saturnSignature('moons', source, snapshot) }
	}

	// The sampled tracks of the moons over a range, cached by range and kernel identity.
	async track(request: SaturnTrackRequest, signal?: AbortSignal): Promise<SaturnTrack> {
		const cached = this.#tracks.get(rangeKey('track', request, this.options.kernels.current()))
		if (cached) return cached

		const { sourced, ...track } = await computeTrack(this.options.kernels, request, signal)
		const answer: SaturnTrack = { ...track, signature: saturnSignature('moons', sourced.source, sourced.snapshot) }
		this.#tracks.set(rangeKey('track', request, sourced.snapshot), answer)
		return answer
	}

	// The greatest separations of the moons over a range, cached by range, moons and kernel identity.
	async elongations(request: SaturnElongationsRequest, signal?: AbortSignal): Promise<SaturnElongations> {
		const key = (snapshot: SpiceKernelSnapshot) => JSON.stringify([rangeKey('elongations', request, snapshot), request.moons ?? null])
		const cached = this.#elongations.get(key(this.options.kernels.current()))
		if (cached) return cached

		const { sourced, ...elongations } = await computeElongations(this.options.kernels, request, signal)
		const answer: SaturnElongations = { ...elongations, signature: saturnSignature('moons', sourced.source, sourced.snapshot) }
		this.#elongations.set(key(sourced.snapshot), answer)
		return answer
	}

	// The phenomena over a range with their visibility from the site, cached by every input and the kernel identity.
	async events(request: SaturnEventsRequest, signal?: AbortSignal): Promise<SaturnEvents> {
		const key = (snapshot: SpiceKernelSnapshot) => {
			const { site, kinds, moons } = request
			const place = site ? [site.latitude, site.longitude, site.elevation, site.timeZone] : null
			return JSON.stringify([rangeKey('events', request, snapshot), place, kinds ?? null, moons ?? null])
		}
		const cached = this.#events.get(key(this.options.kernels.current()))
		if (cached) return cached

		const { sourced, ...events } = await computeEvents(this.options.kernels, this.#nights.night, request, signal)
		const answer: SaturnEvents = { ...events, signature: saturnSignature('moons', sourced.source, sourced.snapshot) }
		this.#events.set(key(sourced.snapshot), answer)
		return answer
	}

	// Readiness of the kernels over a range for the rings and for the moons; never cached.
	source(request: SaturnSourceRequest): SaturnSourceReport {
		return computeSource(this.options.kernels.current(), request)
	}
}

// Cache key of a range answer: what it is, the model versions, the range, and the kernel identity.
function rangeKey(kind: string, { start, end }: { readonly start: number; readonly end: number }, snapshot: SpiceKernelSnapshot) {
	return JSON.stringify([kind, SATURN_MODEL_VERSION, SATURN_RING_DRAWING.version, start, end, snapshot.policy, snapshot.generation])
}

// Answers a computation, turning an unavailable kernel source into 503 with its reason and the state it lacked.
async function answer(compute: () => Promise<unknown>): Promise<Response> {
	try {
		return Response.json(await compute())
	} catch (error) {
		if (!(error instanceof SaturnSourceUnavailableError)) throw error
		return unavailableResponse(error)
	}
}

// Routes of the Saturn Observing Planner. A request that left stops between chunks and is not answered; a computation
// of a scope answers 503 under spkOnly when the kernels cannot give it, without affecting the other scope.
export function createSaturnRoutes(service: SaturnPlannerService) {
	return {
		'/api/saturn/rings/state': {
			// The disk and ring geometry at the instant of the body (SaturnStateRequest → SaturnRingState).
			POST: async (req) => {
				const request = (await req.json()) as SaturnStateRequest
				return answer(() => service.ringState(request, req.signal))
			},
		},
		'/api/saturn/rings/timeline': {
			// The ring openings and ring-plane events over the range of the body (SaturnRingTimelineRequest → SaturnRingTimeline).
			POST: async (req) => {
				const request = (await req.json()) as SaturnRingTimelineRequest
				return answer(() => service.ringTimeline(request, req.signal))
			},
		},
		'/api/saturn/moons/state': {
			// Saturn, its rings and its moons at the instant of the body (SaturnStateRequest → SaturnMoonsState).
			POST: async (req) => {
				const request = (await req.json()) as SaturnStateRequest
				return answer(() => service.moonsState(request, req.signal))
			},
		},
		'/api/saturn/moons/track': {
			// The moon tracks over the range of the body (SaturnTrackRequest → SaturnTrack).
			POST: async (req) => {
				const request = (await req.json()) as SaturnTrackRequest
				return answer(() => service.track(request, req.signal))
			},
		},
		'/api/saturn/moons/elongations': {
			// The greatest separations over the range of the body (SaturnElongationsRequest → SaturnElongations).
			POST: async (req) => {
				const request = (await req.json()) as SaturnElongationsRequest
				return answer(() => service.elongations(request, req.signal))
			},
		},
		'/api/saturn/moons/events': {
			// The phenomena over the range of the body with their visibility from its site (SaturnEventsRequest → SaturnEvents).
			POST: async (req) => {
				const request = (await req.json()) as SaturnEventsRequest
				return answer(() => service.events(request, req.signal))
			},
		},
		'/api/saturn/source': {
			// Readiness of the kernels over the range of the body for each scope (SaturnSourceRequest → SaturnSourceReport).
			POST: async (req) => Response.json(service.source((await req.json()) as SaturnSourceRequest)),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
