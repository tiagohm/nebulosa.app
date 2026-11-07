import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import { errorResponse } from './http'
import {
	computeEvents,
	computeState,
	computeTrack,
	grsStatus,
	JUPITER_MODEL_VERSION,
	type JupiterEvents,
	type JupiterEventsRequest,
	type JupiterGrsStatus,
	type JupiterKernels,
	type JupiterSignature,
	type JupiterSource,
	type JupiterSourceReport,
	type JupiterSourceRequest,
	JupiterSourceUnavailableError,
	type JupiterState,
	type JupiterStateRequest,
	type JupiterTrack,
	type JupiterTrackRequest,
	kernelReadiness,
	withJovianSource,
} from './jupiter.astronomy'
import type { JupiterGrsSaveOutcome, JupiterGrsSaveRequest, JupiterGrsSettings, JupiterGrsStore } from './jupiter.store'
import { LruCache } from './lrucache'
import { type PlanetarySourceErrorCode, unavailableResponse } from './planetary.source'
import { SiteNightCache } from './planetary.visibility'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'

// Jupiter Observing Planner service: read-only predictions of Jupiter and its Galilean satellites (the view at an
// instant, the satellite tracks over a range, and the phenomena over a range with their visibility from a site), and
// the server's Great Red Spot model, the only thing it stores. Predictions are computed on request from one ephemeris
// source each (see jupiter.astronomy.ts) and kept in bounded in-memory caches whose keys hold every input that changes
// them, including the kernel generation, the ephemeris policy, and the Great Red Spot revision. Nothing here moves a
// device, changes the Sky clock or a site, starts an operation, or asks a remote service.

// Stable codes of the planner's error responses: 409 conflict of a Great Red Spot save, 500 writeFailed, and 503 when the
// spkOnly policy finds the kernels unable to give a computation (coverageUnavailable, missingDependency,
// unsupportedKernel) or the kernel set kept changing during one (generationChanged).
export type JupiterErrorCode = 'conflict' | 'writeFailed' | PlanetarySourceErrorCode

// Great Red Spot model with its state now.
export interface JupiterGrsResponse extends JupiterGrsSettings {
	// State of the model at the time of the answer.
	readonly status: JupiterGrsStatus
}

// Dependencies of the planner.
export interface JupiterPlannerOptions {
	// Kernels of the SPICE Kernel Library and its ephemeris policy.
	readonly kernels: JupiterKernels
	// Night of a site containing an instant (Astro Weather's local night).
	readonly night: (request: AstroWeatherNightRequest) => AstroWeatherNight
	// The server's Great Red Spot model.
	readonly store: JupiterGrsStore
}

// Event answers kept, most recent first: a few tabs, each with a range and a site.
const EVENTS_CACHE_LIMIT = 16

// Track answers kept.
const TRACK_CACHE_LIMIT = 16

// Read-only Jupiter predictions and the Great Red Spot model.
export class JupiterPlannerService {
	readonly #events = new LruCache<JupiterEvents>(EVENTS_CACHE_LIMIT)
	readonly #tracks = new LruCache<JupiterTrack>(TRACK_CACHE_LIMIT)
	// Nights of the sites, which hold a whole range of nights where the provider keeps fewer.
	readonly #nights: SiteNightCache

	constructor(readonly options: JupiterPlannerOptions) {
		this.#nights = new SiteNightCache(options.night)
	}

	// The Great Red Spot model and its state at `now` (Unix milliseconds).
	grs(now: number = Date.now()): JupiterGrsResponse {
		const settings = this.options.store.get()
		return { ...settings, status: grsStatus(settings.model, settings.revision, now) }
	}

	// Saves the Great Red Spot model edited from a revision; the store publishes it. Throws when the database cannot be written.
	saveGrs({ model, revision }: JupiterGrsSaveRequest): JupiterGrsSaveOutcome {
		return this.options.store.save(model, revision)
	}

	// The view of Jupiter and its moons at an instant, with the Great Red Spot marker when a model exists.
	async state({ time }: JupiterStateRequest, signal?: AbortSignal): Promise<JupiterState> {
		const { model, revision } = this.options.store.get()
		const { results, source, snapshot } = await withJovianSource(this.options.kernels, 1, (ephemeris) => computeState(ephemeris, time, model), false, signal)
		return { ...results[0], grsStatus: grsStatus(model, revision, time), signature: signature(source, snapshot, model ? revision : undefined) }
	}

	// The sampled tracks of the moons over a range, cached by range and kernel identity.
	async track(request: JupiterTrackRequest, signal?: AbortSignal): Promise<JupiterTrack> {
		const before = this.options.kernels.current()
		const cached = this.#tracks.get(trackKey(request, before))
		if (cached) return cached

		const { sourced, ...track } = await computeTrack(this.options.kernels, request, signal)
		const answer: JupiterTrack = { ...track, signature: signature(sourced.source, sourced.snapshot) }
		this.#tracks.set(trackKey(request, sourced.snapshot), answer)
		return answer
	}

	// The events over a range with their visibility from the site, cached by every input and the kernel identity.
	async events(request: JupiterEventsRequest, signal?: AbortSignal): Promise<JupiterEvents> {
		const { model, revision } = this.options.store.get()
		const cached = this.#events.get(eventsKey(request, this.options.kernels.current(), revision))
		if (cached) return cached

		const { sourced, grsUsed, ...events } = await computeEvents(this.options.kernels, this.#nights.night, request, model, signal)
		const answer: JupiterEvents = { ...events, grsStatus: grsStatus(model, revision, request.start), signature: signature(sourced.source, sourced.snapshot, grsUsed ? revision : undefined) }
		this.#events.set(eventsKey(request, sourced.snapshot, revision), answer)
		return answer
	}

	// Readiness of the kernels over a range and the source a computation would use; never cached.
	source(request: JupiterSourceRequest): JupiterSourceReport {
		return kernelReadiness(this.options.kernels.current(), request)
	}
}

// Signature of a result computed from a source and a kernel snapshot.
function signature(source: JupiterSource, snapshot: SpiceKernelSnapshot, grsRevision?: number): JupiterSignature {
	return { modelVersion: JUPITER_MODEL_VERSION, source, policy: snapshot.policy, generation: snapshot.generation, ...(grsRevision !== undefined && { grsRevision }) }
}

// Cache key of a track: the model, the range, and the kernel identity.
function trackKey({ start, end }: JupiterTrackRequest, snapshot: SpiceKernelSnapshot) {
	return JSON.stringify([JUPITER_MODEL_VERSION, start, end, snapshot.policy, snapshot.generation])
}

// Cache key of the events: the model, every input of the request, the kernel identity, and the Great Red Spot revision.
function eventsKey({ start, end, site, kinds, moons }: JupiterEventsRequest, snapshot: SpiceKernelSnapshot, grsRevision: number) {
	const place = site ? [site.latitude, site.longitude, site.elevation, site.timeZone] : null
	return JSON.stringify([JUPITER_MODEL_VERSION, start, end, place, kinds ?? null, moons ?? null, snapshot.policy, snapshot.generation, grsRevision])
}

// Answers a computation, turning an unavailable kernel source into 503 with its reason and the state it lacked.
async function answer(compute: () => Promise<unknown>): Promise<Response> {
	try {
		return Response.json(await compute())
	} catch (error) {
		if (!(error instanceof JupiterSourceUnavailableError)) throw error
		return unavailableResponse(error)
	}
}

// Routes of the Jupiter Observing Planner.
export function createJupiterRoutes(service: JupiterPlannerService) {
	return {
		'/api/jupiter/grs': {
			// The Great Red Spot model and its state now (JupiterGrsResponse); revision 0 without a model.
			GET: () => Response.json(service.grs()),
			// Saves the model of the body (JupiterGrsSaveRequest) and answers it (JupiterGrsResponse); 409 conflict with the
			// current one (grs) when another revision was saved since; 500 writeFailed when the database cannot be written.
			PUT: async (req) => {
				const request = (await req.json()) as JupiterGrsSaveRequest

				try {
					const outcome = service.saveGrs(request)
					if (outcome.status === 'conflict') return errorResponse('The Great Red Spot model was changed by another tab', 409, 'conflict' satisfies JupiterErrorCode, { grs: service.grs() })
					return Response.json(service.grs())
				} catch (error) {
					return errorResponse(`Unable to save the Great Red Spot model: ${Error.isError(error) ? error.message : String(error)}`, 500, 'writeFailed' satisfies JupiterErrorCode)
				}
			},
		},
		'/api/jupiter/state': {
			// The view at the instant of the body (JupiterStateRequest → JupiterState); 503 under spkOnly without kernels.
			POST: async (req) => {
				const request = (await req.json()) as JupiterStateRequest
				return answer(() => service.state(request, req.signal))
			},
		},
		'/api/jupiter/track': {
			// The satellite tracks over the range of the body (JupiterTrackRequest → JupiterTrack); a request that left stops
			// between chunks and is not answered; 503 under spkOnly without kernels.
			POST: async (req) => {
				const request = (await req.json()) as JupiterTrackRequest
				return answer(() => service.track(request, req.signal))
			},
		},
		'/api/jupiter/events': {
			// The events over the range of the body (JupiterEventsRequest → JupiterEvents); a request that left stops between
			// chunks and is not answered; 503 under spkOnly without kernels.
			POST: async (req) => {
				const request = (await req.json()) as JupiterEventsRequest
				return answer(() => service.events(request, req.signal))
			},
		},
		'/api/jupiter/source': {
			// Readiness of the kernels over the range of the body (JupiterSourceRequest → JupiterSourceReport).
			POST: async (req) => Response.json(service.source((await req.json()) as JupiterSourceRequest)),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
