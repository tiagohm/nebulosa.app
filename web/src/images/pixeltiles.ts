import type { ImageRect, SampleConversion, SampleTileHeader } from 'api'
import type { CfaPattern } from 'nebulosa/src/imaging/model/types'
import { proxy } from 'valtio'
import { type ApiFetch, browserFetch } from '../http'
import type { Size } from '../viewer/transform'

// Raw sample tiles of the pixel readout of the Images viewer: small tiles of the native decoded samples of an image
// document (GET /api/images/:id/samples, the binary envelope of api/src/imagesamples.ts), never the rendered JPEG nor
// anything the display applies. The pointer reads its pixel from the tile of the 64-pixel grid it is in, so moving inside
// a tile already fetched asks the server nothing; entering another tile fetches it once, aborting a fetch of another tile
// still on its way. Tiles are kept in a least-recently-used cache bounded in bytes, and those of other images are dropped
// as soon as another image is read. Values are converted to the scale of the source; NaN and infinities stay as they are,
// and a mosaic photosite is labelled by its CFA phase at absolute image coordinates.

// Side of the tiles, in pixels (SAMPLE_TILE_SIZE of the API).
export const PIXEL_TILE_SIZE = 64

// Version of the envelope this decoder reads (SAMPLE_TILE_VERSION of the API).
const SAMPLE_TILE_VERSION = 1

// Bytes of decoded tiles kept at most.
export const MAX_TILE_BYTES = 8 * 1024 * 1024

// A decoded tile: its header and its samples, still in the normalized scale of the document.
export interface SampleTile {
	// Rectangle, channels, conversion, and CFA pattern of the tile.
	readonly header: SampleTileHeader
	// Samples interleaved by channel in row-major order.
	readonly samples: Float32Array | Float64Array
}

// Phase of a photosite of a CFA mosaic: red, the first or second green of the pattern, or blue.
export type CfaPhase = 'R' | 'G1' | 'G2' | 'B'

// Samples of one pixel in the scale of the source, with the CFA phase of a mosaic photosite.
export interface PixelReading {
	// One value per channel: mono or a photosite, or red, green, and blue.
	readonly values: readonly number[]
	// Phase of the photosite of a mosaic with a trusted pattern.
	readonly phase?: CfaPhase
}

// Decodes a sample tile envelope; throws for another version.
export function decodeSampleTile(buffer: ArrayBuffer): SampleTile {
	const view = new DataView(buffer)
	const length = view.getUint32(0, true)
	const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length))) as SampleTileHeader
	if (header.version !== SAMPLE_TILE_VERSION) throw new Error(`Unsupported sample tile version ${header.version}`)
	const offset = Math.ceil((4 + length) / 8) * 8
	const count = header.width * header.height * header.channels
	const samples = header.precision === 64 ? new Float64Array(count) : new Float32Array(count)
	if (header.precision === 64) for (let i = 0; i < count; i++) samples[i] = view.getFloat64(offset + i * 8, true)
	else for (let i = 0; i < count; i++) samples[i] = view.getFloat32(offset + i * 4, true)
	return { header, samples }
}

// Returns the tile of the grid holding pixel (x, y), cut at the right and bottom edges of the image.
export function tileRect(x: number, y: number, image: Size): ImageRect {
	const left = Math.floor(x / PIXEL_TILE_SIZE) * PIXEL_TILE_SIZE
	const top = Math.floor(y / PIXEL_TILE_SIZE) * PIXEL_TILE_SIZE
	return { left, top, width: Math.min(PIXEL_TILE_SIZE, image.width - left), height: Math.min(PIXEL_TILE_SIZE, image.height - top) }
}

// Returns the CFA phase of the photosite at absolute image coordinates (x, y) of a pattern at the image origin.
export function cfaPhaseAt(pattern: CfaPattern, x: number, y: number): CfaPhase {
	const slot = ((y & 1) << 1) | (x & 1)
	const color = pattern[slot]
	if (color === 'R') return 'R'
	if (color === 'B') return 'B'
	return pattern.indexOf('G') === slot ? 'G1' : 'G2'
}

// Converts a normalized sample to the scale of the source; a non-finite one stays as it is.
export function sourceValue(sample: number, { scale, offset }: SampleConversion): number {
	return Number.isFinite(sample) ? scale * sample + offset : sample
}

// Returns the samples of pixel (x, y), in absolute image coordinates, of a tile, or undefined when it is outside it.
export function readPixel({ header, samples }: SampleTile, x: number, y: number): PixelReading | undefined {
	const { left, top, width, height, channels, conversion, cfa } = header
	const u = x - left
	const v = y - top
	if (u < 0 || v < 0 || u >= width || v >= height) return undefined
	const start = (v * width + u) * channels
	const values = Array.from(samples.subarray(start, start + channels), (sample) => sourceValue(sample, conversion))
	return cfa && channels === 1 ? { values, phase: cfaPhaseAt(cfa, x, y) } : { values }
}

// Least-recently-used cache of the tiles of the image read last, fetching one tile at a time.
export class SampleTileCache {
	// Bumped whenever a tile arrives, so a reader re-renders.
	readonly state = proxy({ version: 0 })
	// Tiles of the image read last, least recently used first, by tile key.
	readonly #tiles = new Map<string, SampleTile>()
	// Bytes of the tiles kept.
	#bytes = 0
	// Image whose tiles are kept.
	#imageId?: string
	// Tile being fetched and its controller.
	#loading?: { readonly key: string; readonly controller: AbortController }
	// Tiles whose fetch failed, never fetched again for the same image.
	readonly #failed = new Set<string>()

	// Creates a cache fetching with request and keeping at most maxBytes of tiles.
	constructor(
		readonly request: ApiFetch = browserFetch,
		readonly maxBytes: number = MAX_TILE_BYTES,
	) {}

	// Number of tiles kept.
	get size(): number {
		return this.#tiles.size
	}

	// Returns the tile holding pixel (x, y) of an image when it is kept, marking it as used.
	get(imageId: string, x: number, y: number, image: Size): SampleTile | undefined {
		if (imageId !== this.#imageId) return undefined
		const key = tileKey(tileRect(x, y, image))
		const tile = this.#tiles.get(key)
		if (!tile) return undefined
		this.#tiles.delete(key)
		this.#tiles.set(key, tile)
		return tile
	}

	// Fetches the tile holding pixel (x, y) of an image unless it is kept, being fetched, or failed already. Reading
	// another image drops the tiles of the previous one; a fetch of another tile still on its way is aborted.
	load(imageId: string, x: number, y: number, image: Size): void {
		if (imageId !== this.#imageId) this.#reset(imageId)
		const rect = tileRect(x, y, image)
		const key = tileKey(rect)
		if (this.#tiles.has(key) || this.#failed.has(key) || this.#loading?.key === key) return
		this.#loading?.controller.abort()
		const controller = new AbortController()
		this.#loading = { key, controller }
		void this.#fetch(imageId, key, rect, controller)
	}

	// Fetches a tile and keeps it, unless it was aborted or the image changed meanwhile.
	async #fetch(imageId: string, key: string, { left, top, width, height }: ImageRect, controller: AbortController) {
		try {
			// Called unbound: the global fetch throws when called as a method of another object.
			const request = this.request
			const response = await request(`/api/images/${encodeURIComponent(imageId)}/samples?left=${left}&top=${top}&width=${width}&height=${height}`, { signal: controller.signal })
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			const tile = decodeSampleTile(await response.arrayBuffer())
			if (imageId === this.#imageId && !controller.signal.aborted) this.#store(key, tile)
		} catch {
			if (imageId === this.#imageId && !controller.signal.aborted) this.#failed.add(key)
		} finally {
			if (this.#loading?.controller === controller) this.#loading = undefined
		}
	}

	// Keeps a tile, evicting the least recently used ones beyond the byte bound.
	#store(key: string, tile: SampleTile) {
		this.#tiles.set(key, tile)
		this.#bytes += tile.samples.byteLength

		for (const [oldest, kept] of this.#tiles) {
			if (this.#bytes <= this.maxBytes || oldest === key) break
			this.#tiles.delete(oldest)
			this.#bytes -= kept.samples.byteLength
		}

		this.state.version++
	}

	// Drops every tile and fetch, keeping the tiles of imageId from now on.
	#reset(imageId: string) {
		this.#loading?.controller.abort()
		this.#loading = undefined
		this.#tiles.clear()
		this.#failed.clear()
		this.#bytes = 0
		this.#imageId = imageId
	}
}

// Returns the key of a tile.
function tileKey({ left, top }: ImageRect): string {
	return `${left},${top}`
}

// Tiles of the pixel readout of the tab.
export const pixelTiles = new SampleTileCache()

// Whether the status line of the viewer reads the samples under the pointer, set from the Image Inspector and kept in
// browser storage (pixelInspectionEntry of profile/view.ts).
export const pixelInspection = proxy<{ enabled: boolean }>({ enabled: false })
