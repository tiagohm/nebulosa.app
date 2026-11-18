import { HIPS2FITS_ALTERNATIVE_URL, HIPS2FITS_BASE_URL, hips2FitsUrl } from 'nebulosa/src/adapters/sky/hips2fits'
import { errorResponse } from './http'
import { fetchUpstream, RemoteCache, type UpstreamBody, type UpstreamFetch, UpstreamUnavailableError } from './remote'

// Survey cutouts of the preview of the Framing tool, proxied from the CDS hips2fits service (the survey list is bundled
// with the web client, see framings.surveys.ts): a JPEG in the TAN projection centered on an ICRS position, north up and
// east left (no rotation), whose field of view spans the larger side of the image, so a gnomonic projection of the same
// center and scale draws the framings on it without a WCS. A cutout of a URL never changes, so it is kept for a day, the
// latest ones in memory; the mirror is asked when the main host fails, and a failure is remembered for a minute so an
// unreachable service answers at once.

// How long a cutout is fresh, in milliseconds (one day: a survey does not change).
const CUTOUT_TTL_MS = 24 * 60 * 60_000

// Cutouts kept in memory, the least recently used dropped first.
const CUTOUT_LIMIT = 24

// Budget of one download from one host, in milliseconds; hips2fits resamples the survey before it answers.
const CUTOUT_TIMEOUT_MS = 45_000

// Largest cutout accepted, in bytes (a 2000 px JPEG is about 1 MB).
const CUTOUT_MAX_BYTES = 8 * 1024 * 1024

// Error codes of the cutout route.
export type FramingCutoutErrorCode = 'upstreamUnavailable'

// Cutout asked by the preview: GET /api/framings/cutout?survey=&ra=&dec=&fov=&width=&height=.
export interface FramingCutoutRequest {
	// Survey id of the bundled survey catalog, such as "CDS/P/DSS2/color".
	readonly survey: string
	// Right ascension of the center (ICRS), in radians.
	readonly rightAscension: number
	// Declination of the center, in radians.
	readonly declination: number
	// Field of view along the larger side of the image, in radians (the tangent-plane extent of TAN).
	readonly fov: number
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
}

// Options of the cutout service.
export interface HipsCutoutsOptions {
	// Fetch of the hips2fits hosts; the global fetch by default.
	readonly fetch?: UpstreamFetch
	// Current time, Unix milliseconds; Date.now by default.
	readonly now?: () => number
}

// Returns the hips2fits URL of a cutout on a host: TAN, ICRS, no rotation, JPEG.
export function cutoutUrl({ survey, rightAscension, declination, fov, width, height }: FramingCutoutRequest, baseUrl: string = HIPS2FITS_BASE_URL) {
	return hips2FitsUrl(survey, rightAscension, declination, { width, height, fov, rotation: 0, projection: 'TAN', coordSystem: 'icrs', format: 'jpg', baseUrl })
}

// Survey cutouts by request.
export class HipsCutouts {
	readonly #fetch: UpstreamFetch
	readonly #cache: RemoteCache<UpstreamBody>

	// Creates the service.
	constructor({ fetch: upstream = (url, init) => fetch(url, init), now }: HipsCutoutsOptions = {}) {
		this.#fetch = upstream
		this.#cache = new RemoteCache(CUTOUT_TTL_MS, now, { limit: CUTOUT_LIMIT, rememberFailure: true })
	}

	// Returns the cutout of a request, from the main host or else its mirror; rejects with UpstreamUnavailableError when
	// neither answers a JPEG and no cutout of the same request was read before.
	cutout(request: FramingCutoutRequest) {
		const url = cutoutUrl(request)

		return this.#cache.get(url, async () => {
			try {
				return await fetchUpstream(this.#fetch, url, 'image/jpeg', CUTOUT_TIMEOUT_MS, CUTOUT_MAX_BYTES)
			} catch (error) {
				if (!(error instanceof UpstreamUnavailableError)) throw error
				return await fetchUpstream(this.#fetch, cutoutUrl(request, HIPS2FITS_ALTERNATIVE_URL), 'image/jpeg', CUTOUT_TIMEOUT_MS, CUTOUT_MAX_BYTES)
			}
		})
	}
}

// Reads the cutout request of a query string.
function cutoutRequest(params: URLSearchParams): FramingCutoutRequest {
	return { survey: params.get('survey')!, rightAscension: +params.get('ra')!, declination: +params.get('dec')!, fov: +params.get('fov')!, width: +params.get('width')!, height: +params.get('height')! }
}

// Creates the cutout route.
export function createHipsCutoutRoutes(service: HipsCutouts) {
	return {
		'/api/framings/cutout': {
			// JPEG of the cutout of ?survey, ra, dec, fov (radians), width, and height (pixels) (FramingCutoutRequest).
			// X-Framing-Fetched-At is when it was downloaded (Unix milliseconds). 502 upstreamUnavailable when neither
			// hips2fits host answers a JPEG.
			GET: async (req) => {
				try {
					const { value, fetchedAt } = await service.cutout(cutoutRequest(new URL(req.url).searchParams))
					return new Response(value.bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Framing-Fetched-At': `${fetchedAt}` } })
				} catch (error) {
					if (error instanceof UpstreamUnavailableError) return errorResponse('The survey image is unavailable', 502, 'upstreamUnavailable' satisfies FramingCutoutErrorCode)
					throw error
				}
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
