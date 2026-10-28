import { errorResponse } from '../http'
import { fetchUpstream, RemoteCache, type UpstreamBody, type UpstreamFetch, UpstreamUnavailableError } from './remote'

// Latest full-disk images of the Sun from NASA's Solar Dynamics Observatory, proxied for the Sun
// Inspector. Only the fixed public JPEGs of the SDO "latest" directory are read, one per channel and
// size of an allowlist, so no URL is built from a request. SDO tells only when a file was last
// modified, not when it was observed, so that time is answered as such. Images are kept for 15
// minutes, about the cadence SDO refreshes them at.

// Channels of the Sun Inspector: AIA extreme ultraviolet at 193, 171, and 304 Å, the HMI colored
// intensitygram (continuum, the visible photosphere and its sunspots), and the HMI magnetogram.
export type SunImageChannel = 'aia193' | 'aia171' | 'aia304' | 'hmiIntensitygram' | 'hmiMagnetogram'

// Width and height of an image in pixels.
export type SunImageSize = 512 | 1024

// Codes of the channels in the SDO file names.
const SDO_CHANNEL_CODES: Readonly<Record<SunImageChannel, string>> = { aia193: '0193', aia171: '0171', aia304: '0304', hmiIntensitygram: 'HMIIC', hmiMagnetogram: 'HMIB' }

// How long an image is fresh, in milliseconds (15 minutes).
const SDO_TTL_MS = 15 * 60_000

// Budget of one download in milliseconds.
const SDO_TIMEOUT_MS = 15_000

// Largest image accepted, in bytes (a 1024 px JPEG is about 200 KB).
const SDO_MAX_BYTES = 4 * 1024 * 1024

// Error codes of the solar image route.
export type SunImageErrorCode = 'upstreamUnavailable'

// Returns the SDO URL of the latest image of a channel at a size.
export function sdoImageUrl(channel: SunImageChannel, size: SunImageSize) {
	return `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_${size}_${SDO_CHANNEL_CODES[channel]}.jpg`
}

// Options of the solar image service.
export interface SolarImagesOptions {
	// Fetch of the SDO server; the global fetch by default.
	readonly fetch?: UpstreamFetch
	// Current time, Unix milliseconds; Date.now by default.
	readonly now?: () => number
}

// Latest SDO images by channel and size.
export class SolarImages {
	readonly #fetch: UpstreamFetch
	readonly #cache: RemoteCache<UpstreamBody>

	// Creates the service.
	constructor({ fetch: upstream = (url, init) => fetch(url, init), now }: SolarImagesOptions = {}) {
		this.#fetch = upstream
		this.#cache = new RemoteCache(SDO_TTL_MS, now)
	}

	// Returns the latest image of a channel at a size; rejects with UpstreamUnavailableError when SDO cannot be
	// read and no image was read before.
	image(channel: SunImageChannel, size: SunImageSize) {
		return this.#cache.get(`${channel}:${size}`, () => fetchUpstream(this.#fetch, sdoImageUrl(channel, size), 'image/jpeg', SDO_TIMEOUT_MS, SDO_MAX_BYTES))
	}
}

// Creates the solar image routes.
export function createSolarImageRoutes(service: SolarImages) {
	return {
		'/api/sky/sun/image': {
			// JPEG of the latest image of `channel` at `size` pixels (512 when absent). Last-Modified is when SDO
			// last modified the file, X-Sun-Fetched-At when it was downloaded (Unix milliseconds), and X-Sun-Stale
			// is 1 when SDO could not be read and the image is the last one downloaded. 502 upstreamUnavailable
			// when SDO cannot be read and no image was downloaded before.
			GET: async (req) => {
				const params = new URL(req.url).searchParams
				const channel = params.get('channel') as SunImageChannel
				const size = (+(params.get('size') ?? 512) as SunImageSize) || 512

				try {
					const { value, fetchedAt, stale } = await service.image(channel, size)
					const headers: Record<string, string> = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Sun-Fetched-At': `${fetchedAt}`, 'X-Sun-Stale': stale ? '1' : '0' }
					if (value.lastModified !== undefined) headers['Last-Modified'] = new Date(value.lastModified).toUTCString()
					return new Response(value.bytes, { headers })
				} catch (error) {
					if (error instanceof UpstreamUnavailableError) return errorResponse('The SDO image is unavailable', 502, 'upstreamUnavailable' satisfies SunImageErrorCode)
					throw error
				}
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
