import type { Database } from 'bun:sqlite'
import { SOLAR_SYSTEM_BODIES, searchSolarSystem } from './bodies'
import { type ConstellationSource, catalogObject, DEFAULT_DEEP_SKY_MAGNITUDE_LIMIT, renderConstellations, renderDeepSky, renderStars, searchCatalog } from './catalog'
import { type EphemerisTarget, EphemerisUnavailableError, HorizonsEphemerisError, type SkyEphemeris } from './ephemeris'
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
	return ref.kind === 'catalog' ? `catalog:${ref.id}` : ref.kind === 'body' ? `body:${ref.code}` : `minor:${ref.spkId}`
}

// Responds with an error message and a status.
function errorResponse(message: string, status: number) {
	return Response.json({ error: message }, { status })
}

// Creates the sky routes.
export function createSkyRoutes({ catalog, constellations, ephemeris, minorBodies }: SkyServices) {
	// Resolves an object identity to an ephemeris target; undefined for an unknown catalog id. A minor
	// body whose elements cannot be read from SBDB is still resolved, for Horizons alone.
	async function resolveTarget(ref: SkyObjectRef, signal: AbortSignal): Promise<EphemerisTarget | undefined> {
		if (ref.kind === 'catalog') {
			const object = catalogObject(catalog, ref.id)
			return object && { type: 'catalog', object }
		}

		if (ref.kind === 'body') return { type: 'body', code: ref.code }

		try {
			const body = await minorBodies.body(ref.spkId, signal)
			return { type: 'minorBody', spkId: ref.spkId, elements: body?.elements }
		} catch (error) {
			if (error instanceof SbdbUnavailableError) return { type: 'minorBody', spkId: ref.spkId }
			throw error
		}
	}

	return {
		'/api/sky/catalog/stars': {
			// Every star to render at the equator of `time`.
			GET: (req: Request) => Response.json(renderStars(catalog, timeParam(new URL(req.url).searchParams))),
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
		'/api/sky/search': {
			// Local search: solar-system bodies, then catalog designations and names; `limit` caps the catalog
			// results.
			GET: (req: Request) => {
				const params = new URL(req.url).searchParams
				const query = params.get('q') ?? ''
				const limit = params.get('limit')
				return Response.json([...searchSolarSystem(query), ...searchCatalog(catalog, query, limit ? +limit : undefined)])
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
			GET: (req: Bun.BunRequest<'/api/sky/objects/:id'>) => {
				const object = catalogObject(catalog, +req.params.id)
				return object ? Response.json(object) : errorResponse('Object not found', 404)
			},
		},
		'/api/sky/position': {
			// Position of an object, with its events for an observer. 404 for an unknown catalog object, 502
			// when Horizons rejects the target, and 503 when no provider can compute it.
			POST: async (req: Request) => {
				const { target: ref, time, observer, mode } = (await req.json()) as SkyPositionRequest
				const target = await resolveTarget(ref, req.signal)
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
			POST: async (req: Request) => {
				const { time, observer } = (await req.json()) as SkyBodiesRequest
				const bodies: SkyBodyPosition[] = []

				for (const body of SOLAR_SYSTEM_BODIES) {
					const position = await ephemeris.position({ type: 'body', code: body.code }, { time, observer, mode: 'fast' })
					bodies.push({ code: body.code, kind: body.kind, name: body.name, rightAscension: position.rightAscension, declination: position.declination, magnitude: position.magnitude })
				}

				return Response.json(bodies)
			},
		},
	} as const
}
