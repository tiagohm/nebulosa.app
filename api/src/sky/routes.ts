import type { Database } from 'bun:sqlite'
import { errorResponse } from '../http'
import { SOLAR_SYSTEM_BODIES, searchSolarSystem } from './bodies'
import { type ConstellationSource, catalogObject, DEFAULT_DEEP_SKY_MAGNITUDE_LIMIT, renderConstellations, renderDeepSky, renderStars, searchCatalog } from './catalog'
import { constellationDetails, searchConstellations } from './constellations'
import { type EphemerisTarget, EphemerisUnavailableError, HorizonsEphemerisError, type PositionRequest, type SkyEphemeris, type SkyObserver, type SkyPosition } from './ephemeris'
import { type MinorBodies, SbdbUnavailableError } from './minorbodies'
import type { SkyBodiesRequest, SkyBodyPosition, SkyObjectRef, SkyPositionRequest, SkyPositionResponse, SkySearchResult } from './types'

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
	// Artificial satellites of the satellite catalog; absent when the server has none.
	readonly satellites?: SkySatellites
	// Meteor shower radiants of the Meteor Showers catalog; absent when the server has none.
	readonly meteorShowers?: SkyMeteorShowers
}

// Meteor showers as the sky routes search them. A radiant is a direction: it has no position of an object, no rise, transit,
// or set, and no ephemeris target, so the position route refuses it and a mount never locates one; the Sky reads its state
// from the Meteor Showers routes.
export interface SkyMeteorShowers {
	// Showers whose name, code, or IAU number match a text, at most `limit`.
	readonly search: (text: string, limit: number) => Promise<readonly SkySearchResult[]>
}

// Satellites of the satellite catalog, as the sky routes search and locate them. They have no rise, transit, or set, and
// no ephemeris target of the Sky, so a mount never locates one.
export interface SkySatellites {
	// Satellites whose NORAD id, international designator, or name match a text, at most `limit`, from the local catalog.
	readonly search: (text: string, limit: number) => readonly SkySearchResult[]
	// Position of a satellite at an instant (Unix milliseconds) for an observer, or from the Earth's center. Throws
	// SkySatelliteError.
	readonly position: (noradId: string, time: number, observer?: SkyObserver) => SkyPosition
}

// Failure to locate a satellite, answered with its status and code: 404 notFound or noElements, 422 predictionUnreliable.
export class SkySatelliteError extends Error {
	// Creates the error.
	constructor(
		message: string,
		readonly status: number,
		readonly code: string,
	) {
		super(message)
	}
}

// Most satellites a search lists, after the bodies and constellations and before the catalog.
const SATELLITE_SEARCH_LIMIT = 5

// Most meteor showers a search lists, after the satellites and before the catalog.
const METEOR_SHOWER_SEARCH_LIMIT = 5

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
	if (ref.kind === 'satellite') return `satellite:${ref.noradId}`
	if (ref.kind === 'meteorShower') return `meteor:${ref.id}`
	return `minor:${ref.spkId}`
}

// Locates an object at an instant (PositionRequest.time) for an observer. Resolves undefined for an
// unknown object; rejects with EphemerisUnavailableError when no provider can compute it and with
// HorizonsEphemerisError when Horizons rejects the target.
export type SkyLocator = (ref: SkyObjectRef, request: PositionRequest) => Promise<SkyPosition | undefined>

// Resolves an object identity to an ephemeris target; undefined for an unknown catalog id or
// constellation. A minor body whose elements cannot be read from SBDB is still resolved, for Horizons or the SPK kernels
// alone; when the ephemeris policy forbids requests to JPL, its elements come only from what SBDB already answered. A
// satellite and a meteor shower radiant have no ephemeris target.
async function resolveTarget({ catalog, constellations, ephemeris, minorBodies }: SkyServices, ref: SkyObjectRef, signal?: AbortSignal): Promise<EphemerisTarget | undefined> {
	if (ref.kind === 'catalog') {
		const object = catalogObject(catalog, ref.id)
		return object && { type: 'catalog', object }
	}

	if (ref.kind === 'body') return { type: 'body', code: ref.code }
	if (ref.kind === 'satellite' || ref.kind === 'meteorShower') return undefined

	if (ref.kind === 'constellation') {
		const constellation = constellationDetails(constellations, ref.code)
		return constellation && { type: 'catalog', object: { rightAscension: constellation.rightAscension, declination: constellation.declination, pmRA: 0, pmDEC: 0 } }
	}

	if (!ephemeris.remoteAllowed) return { type: 'minorBody', spkId: ref.spkId, elements: minorBodies.cached(ref.spkId)?.elements }

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
				return constellation ? Response.json(constellation) : errorResponse('Constellation not found', 404, 'notFound')
			},
		},
		'/api/sky/search': {
			// Local search: solar-system bodies, constellations, satellites of the satellite catalog, meteor showers, then catalog
			// designations and names; `limit` caps the catalog results.
			GET: async (req: Request) => {
				const params = new URL(req.url).searchParams
				const query = params.get('q') ?? ''
				const limit = params.get('limit')
				const satellites = query.trim() && services.satellites ? services.satellites.search(query, SATELLITE_SEARCH_LIMIT) : []
				const meteorShowers = query.trim() && services.meteorShowers ? await services.meteorShowers.search(query, METEOR_SHOWER_SEARCH_LIMIT) : []
				return Response.json([...searchSolarSystem(query), ...searchConstellations(query), ...satellites, ...meteorShowers, ...searchCatalog(catalog, query, limit ? +limit : undefined)])
			},
		},
		'/api/sky/minorbodies/search': {
			// Asteroid and comet search in SBDB; 503 when SBDB cannot be reached in time.
			GET: async (req: Request) => {
				try {
					return Response.json(await minorBodies.search(new URL(req.url).searchParams.get('q') ?? '', req.signal))
				} catch (error) {
					if (error instanceof SbdbUnavailableError) return errorResponse(error.message, 503, 'serviceUnavailable')
					throw error
				}
			},
		},
		'/api/sky/objects/:id': {
			// Catalog data of a star or deep-sky object; 404 when unknown.
			GET: (req) => {
				const object = catalogObject(catalog, +req.params.id)
				return object ? Response.json(object) : errorResponse('Object not found', 404, 'notFound')
			},
		},
		'/api/sky/position': {
			// Position of an object, with its events for an observer. 404 for an unknown catalog object, 502
			// when Horizons rejects the target, and 503 when no provider can compute it: serviceUnavailable, or the
			// coverageUnavailable, missingDependency, or offline of the ephemeris policy. A satellite is located by the satellite catalog,
			// without events: 404 notFound or noElements, 422 predictionUnreliable. A meteor shower radiant is 422 unsupportedTarget.
			POST: async (req) => {
				const { target: ref, time, observer, mode } = (await req.json()) as SkyPositionRequest
				if (ref.kind === 'meteorShower') return errorResponse('A meteor shower radiant is a direction, not an object with a position', 422, 'unsupportedTarget')

				if (ref.kind === 'satellite') {
					if (!services.satellites) return errorResponse('Satellite not found', 404, 'notFound')

					try {
						return Response.json({ position: services.satellites.position(ref.noradId, time, observer) } satisfies SkyPositionResponse)
					} catch (error) {
						if (error instanceof SkySatelliteError) return errorResponse(error.message, error.status, error.code)
						throw error
					}
				}

				const target = await resolveTarget(services, ref, req.signal)
				if (!target) return errorResponse('Object not found', 404, 'notFound')

				try {
					const position = await ephemeris.position(target, { time, observer, mode, signal: req.signal })
					const events = observer ? ephemeris.events(target, time, observer, refKey(ref)) : undefined
					return Response.json({ position, events } satisfies SkyPositionResponse)
				} catch (error) {
					if (error instanceof EphemerisUnavailableError) return errorResponse(error.message, 503, error.code ?? 'serviceUnavailable')
					if (error instanceof HorizonsEphemerisError) return errorResponse(error.message, 502, 'rejected')
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
