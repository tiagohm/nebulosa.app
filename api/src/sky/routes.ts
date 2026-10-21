import type { Database } from 'bun:sqlite'
import { SOLAR_SYSTEM_BODIES, searchSolarSystem } from './bodies'
import { type ConstellationSource, catalogObject, DEFAULT_DEEP_SKY_MAGNITUDE_LIMIT, renderConstellations, renderDeepSky, renderStars, searchCatalog } from './catalog'
import { constellationDetails, searchConstellations } from './constellations'
import { type EphemerisTarget, EphemerisUnavailableError, HorizonsEphemerisError, type PositionRequest, type SkyEphemeris, type SkyPosition } from './ephemeris'
import { type MinorBodies, SbdbUnavailableError } from './minorbodies'
import type { SkyBodiesRequest, SkyBodyPosition, SkyObjectRef, SkyPositionRequest, SkyPositionResponse } from './types'

// HTTP routes of the sky API under /api/sky, built over the services they need so tests can pass an
// in-memory catalog and mocked remote services. Search and catalog data are local and never wait on
// the network; positions of solar-system objects and minor body searches may, within their budgets.

// Services the sky routes read.
export interface SkyServices {
	// Sky catalog database.
	readonly catalog: Database
	// J2000 constellation data.
	readonly constellations: ConstellationSource
	// Ephemeris service.
	readonly ephemeris: SkyEphemeris
	// Minor body lookups.
	readonly minorBodies: MinorBodies
}

// Reads the `time` query parameter (Unix milliseconds); the current time when absent.
function timeParam(params: URLSearchParams) {
	const time = params.get('time')
	return time ? +time : Date.now()
}

// Stable key of an object identity, used to cache its events.
function refKey(ref: SkyObjectRef) {
	if (ref.kind === 'catalog') return `catalog:${ref.id}`
	if (ref.kind === 'body') return `body:${ref.code}`
	if (ref.kind === 'constellation') return `constellation:${ref.code}`
	return `minor:${ref.spkId}`
}

// Responds with an error message and a status.
function errorResponse(message: string, status: number) {
	return Response.json({ error: message }, { status })
}

// Locates an object at an instant (PositionRequest.time) for an observer. Resolves undefined for an
// unknown object; rejects with EphemerisUnavailableError when no provider can compute it and with
// HorizonsEphemerisError when Horizons rejects the target.
export type SkyLocator = (ref: SkyObjectRef, request: PositionRequest) => Promise<SkyPosition | undefined>

// Resolves an object identity to an ephemeris target; undefined for an unknown catalog id or
// constellation. A minor body whose elements cannot be read from SBDB is still resolved, for Horizons alone.
async function resolveTarget({ catalog, constellations, minorBodies }: SkyServices, ref: SkyObjectRef, signal?: AbortSignal): Promise<EphemerisTarget | undefined> {
	if (ref.kind === 'catalog') {
		const object = catalogObject(catalog, ref.id)
		return object && { type: 'catalog', object }
	}

	if (ref.kind === 'body') return { type: 'body', code: ref.code }

	if (ref.kind === 'constellation') {
		const constellation = constellationDetails(constellations, ref.code)
		return constellation && { type: 'catalog', object: { rightAscension: constellation.rightAscension, declination: constellation.declination, pmRA: 0, pmDEC: 0 } }
	}

	try {
		const body = await minorBodies.body(ref.spkId, signal)
		return { type: 'minorBody', spkId: ref.spkId, elements: body?.elements }
	} catch (error) {
		if (error instanceof SbdbUnavailableError) return { type: 'minorBody', spkId: ref.spkId }
		throw error
	}
}

// Creates the locator of the objects the sky routes know, for services outside the sky API.
export function createSkyLocator(services: SkyServices): SkyLocator {
	return async (ref, request) => {
		const target = await resolveTarget(services, ref, request.signal)
		return target && (await services.ephemeris.position(target, request))
	}
}

// Creates the sky routes.
export function createSkyRoutes(services: SkyServices) {
	const { catalog, constellations, ephemeris, minorBodies } = services

	return {
		'/api/sky/catalog/stars': {
			// Stars to render at the equator of `time`, up to the `magnitude` limit (all when absent).
			GET: (req: Request) => {
				const params = new URL(req.url).searchParams
				const magnitude = params.get('magnitude')
				return Response.json(renderStars(catalog, timeParam(params), magnitude ? +magnitude : undefined))
			},
		},
		'/api/sky/catalog/dsos': {
			// Deep-sky objects to render at the equator of `time`, up to the `magnitude` limit.
			GET: (req: Request) => {
				const params = new URL(req.url).searchParams
				const magnitude = params.get('magnitude')
				return Response.json(renderDeepSky(catalog, timeParam(params), magnitude ? +magnitude : DEFAULT_DEEP_SKY_MAGNITUDE_LIMIT))
			},
		},
		'/api/sky/constellations': {
			// Constellation figures, boundaries, and labels at the equator of `time`.
			GET: (req: Request) => Response.json(renderConstellations(constellations, timeParam(new URL(req.url).searchParams))),
		},
		'/api/sky/constellations/:code': {
			// A constellation by its upper-case IAU code; 404 when unknown.
			GET: (req) => {
				const constellation = constellationDetails(constellations, req.params.code.toUpperCase())
				return constellation ? Response.json(constellation) : errorResponse('Constellation not found', 404)
			},
		},
		'/api/sky/search': {
			// Local search: solar-system bodies, constellations, then catalog designations and names; `limit` caps the catalog
			// results.
			GET: (req: Request) => {
				const params = new URL(req.url).searchParams
				const query = params.get('q') ?? ''
				const limit = params.get('limit')
				return Response.json([...searchSolarSystem(query), ...searchConstellations(query), ...searchCatalog(catalog, query, limit ? +limit : undefined)])
			},
		},
		'/api/sky/minorbodies/search': {
			// Asteroid and comet search in SBDB; 503 when SBDB cannot be reached in time.
			GET: async (req: Request) => {
				try {
					return Response.json(await minorBodies.search(new URL(req.url).searchParams.get('q') ?? '', req.signal))
				} catch (error) {
					if (error instanceof SbdbUnavailableError) return errorResponse(error.message, 503)
					throw error
				}
			},
		},
		'/api/sky/objects/:id': {
			// Catalog data of a star or deep-sky object; 404 when unknown.
			GET: (req) => {
				const object = catalogObject(catalog, +req.params.id)
				return object ? Response.json(object) : errorResponse('Object not found', 404)
			},
		},
		'/api/sky/position': {
			// Position of an object, with its events for an observer. 404 for an unknown catalog object, 502
			// when Horizons rejects the target, and 503 when no provider can compute it.
			POST: async (req) => {
				const { target: ref, time, observer, mode } = (await req.json()) as SkyPositionRequest
				const target = await resolveTarget(services, ref, req.signal)
				if (!target) return errorResponse('Object not found', 404)

				try {
					const position = await ephemeris.position(target, { time, observer, mode, signal: req.signal })
					const events = observer && mode !== 'fast' ? ephemeris.events(target, time, observer, refKey(ref)) : undefined
					return Response.json({ position, events } satisfies SkyPositionResponse)
				} catch (error) {
					if (error instanceof EphemerisUnavailableError) return errorResponse(error.message, 503)
					if (error instanceof HorizonsEphemerisError) return errorResponse(error.message, 502)
					throw error
				}
			},
		},
		'/api/sky/bodies': {
			// Local positions of the Sun, the Moon, the planets, and Pluto, for drawing them on the map.
			POST: async (req) => {
				const { time, observer } = (await req.json()) as SkyBodiesRequest
				const bodies: SkyBodyPosition[] = []

				for (const body of SOLAR_SYSTEM_BODIES) {
					const position = await ephemeris.position({ type: 'body', code: body.code }, { time, observer, mode: 'fast' })
					bodies.push({ code: body.code, kind: body.kind, name: body.name, rightAscension: position.rightAscension, declination: position.declination, magnitude: position.magnitude })
				}

				return Response.json(bodies)
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
