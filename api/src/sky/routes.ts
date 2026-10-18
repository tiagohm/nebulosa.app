import type { Database } from 'bun:sqlite'
import { searchSolarSystem } from './bodies'
import { type ConstellationSource, catalogObject, DEFAULT_DEEP_SKY_MAGNITUDE_LIMIT, renderConstellations, renderDeepSky, renderStars, searchCatalog } from './catalog'

// HTTP routes of the sky API under /api/sky, built over the services they need so tests can pass an
// in-memory catalog. Search and catalog data are local and never wait on the network.

// Services the sky routes read.
export interface SkyServices {
	// Sky catalog database.
	readonly catalog: Database
	// J2000 constellation data.
	readonly constellations: ConstellationSource
}

// Reads the `time` query parameter (Unix milliseconds); the current time when absent.
function timeParam(params: URLSearchParams) {
	const time = params.get('time')
	return time ? +time : Date.now()
}

// Creates the sky routes.
export function createSkyRoutes({ catalog, constellations }: SkyServices) {
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
		'/api/sky/objects/:id': {
			// Catalog data of a star or deep-sky object; 404 when unknown.
			GET: (req: Bun.BunRequest<'/api/sky/objects/:id'>) => {
				const object = catalogObject(catalog, +req.params.id)
				return object ? Response.json(object) : Response.json({ error: 'Object not found' }, { status: 404 })
			},
		},
	} as const
}
