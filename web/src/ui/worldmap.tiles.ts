import type { Size, ViewTransform } from '../viewer/transform'
import { WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from './worldmap.geometry'

// Tile pyramid of the world map's basemap: which tiles a view needs, and the cache that draws them on a
// canvas. Level L shows the whole map 2^L tiles wide; each tile is TILE_SIZE device pixels square and is
// rasterized off the main thread (see worldmap.worker.ts). A tile not rasterized yet is drawn from the matching
// part of the nearest coarser level in the cache, so the map is never blank while it refines; the coarsest
// levels are always kept for that.

// Width and height of a tile, in device pixels.
export const TILE_SIZE = 256

// Finest level: 2^11 tiles across, about 2 device pixels per map unit beyond the largest zoom of a 5K screen.
export const MAX_TILE_LEVEL = 11

// Levels fetched first and never evicted, so every tile has a coarser one to stand in for it.
export const PERMANENT_TILE_LEVELS = 3

// Largest number of tiles kept, about 64 MB of bitmaps; more than any screen shows at once.
const MAX_CACHED_TILES = 256

// Duration of the fade of a tile that has just arrived over what stood in for it, in milliseconds.
const TILE_FADE = 120

// Tile of the pyramid.
export interface TileId {
	// Level, in [0, MAX_TILE_LEVEL].
	readonly level: number
	// Column from the west edge, in [0, 2^level).
	readonly x: number
	// Row from the north edge, in [0, tileRows(level)).
	readonly y: number
}

// Tile of a view: its id and the column it is drawn at, which is outside [0, 2^level) on the copies of a wrapping map.
export interface PlacedTile {
	// Tile shown.
	readonly id: TileId
	// Column it is drawn at, counted from the west edge of the map.
	readonly column: number
}

// Returns the device pixels per map unit of the tiles of a level.
export function tileScale(level: number): number {
	return (TILE_SIZE * 2 ** level) / WORLD_MAP_WIDTH
}

// Returns the number of tile rows of a level, the last one partly below the map.
export function tileRows(level: number): number {
	return Math.max(1, Math.ceil((2 ** level * WORLD_MAP_HEIGHT) / WORLD_MAP_WIDTH - 1e-9))
}

// Returns the coarsest level whose tiles are at least as detailed as a scale, in device pixels per map unit, so
// they are drawn at most at their size, never enlarged, up to MAX_TILE_LEVEL.
export function tileLevel(scale: number): number {
	if (!(scale > 0)) return 0
	const level = Math.ceil(Math.log2((scale * WORLD_MAP_WIDTH) / TILE_SIZE) - 1e-9)
	return Math.max(0, Math.min(MAX_TILE_LEVEL, level))
}

// Returns the cache key of a tile.
export function tileKey({ level, x, y }: TileId): string {
	return `${level}/${x}/${y}`
}

// Returns the tiles of a level covering a region of the map, in map units, nearest the region's center first. A
// wrapping map repeats the columns east and west; otherwise columns and rows outside the map are left out.
export function visibleTiles(level: number, region: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, wrap: boolean): PlacedTile[] {
	const columns = 2 ** level
	const rows = tileRows(level)
	const size = WORLD_MAP_WIDTH / columns
	let x0 = Math.floor(region.x / size)
	let x1 = Math.ceil((region.x + region.width) / size) - 1
	const y0 = Math.max(0, Math.floor(region.y / size))
	const y1 = Math.min(rows - 1, Math.ceil((region.y + region.height) / size) - 1)

	if (!wrap) {
		x0 = Math.max(0, x0)
		x1 = Math.min(columns - 1, x1)
	}

	const cx = (region.x + region.width / 2) / size - 0.5
	const cy = (region.y + region.height / 2) / size - 0.5
	const tiles: PlacedTile[] = []

	for (let y = y0; y <= y1; y++) {
		for (let column = x0; column <= x1; column++) {
			tiles.push({ id: { level, x: ((column % columns) + columns) % columns, y }, column })
		}
	}

	return tiles.sort((a, b) => (a.column - cx) ** 2 + (a.id.y - cy) ** 2 - ((b.column - cx) ** 2 + (b.id.y - cy) ** 2))
}

// Returns every tile of the levels below PERMANENT_TILE_LEVELS and up to it, coarsest first.
export function permanentTiles(): TileId[] {
	const tiles: TileId[] = []

	for (let level = 0; level <= PERMANENT_TILE_LEVELS; level++) {
		for (let y = 0; y < tileRows(level); y++) {
			for (let x = 0; x < 2 ** level; x++) tiles.push({ level, x, y })
		}
	}

	return tiles
}

// Part of a coarser tile that covers a tile: the ancestor depth levels up and the square inside it, in its pixels.
export interface TileSource {
	// Ancestor tile.
	readonly id: TileId
	// Left of the square, in pixels of the ancestor.
	readonly sx: number
	// Top of the square, in pixels of the ancestor.
	readonly sy: number
	// Side of the square, in pixels of the ancestor; below 1 for an ancestor more than 8 levels up.
	readonly size: number
}

// Returns the part of the ancestor depth levels up (1 for the parent) that covers a tile.
export function ancestorSource({ level, x, y }: TileId, depth: number): TileSource {
	const factor = 2 ** depth
	const size = TILE_SIZE / factor
	return { id: { level: level - depth, x: Math.floor(x / factor), y: Math.floor(y / factor) }, sx: (x % factor) * size, sy: (y % factor) * size, size }
}

// Tile in the cache.
interface CachedTile {
	// Rasterized tile, TILE_SIZE device pixels square.
	readonly bitmap: ImageBitmap
	// Level of the tile.
	readonly level: number
	// When it arrived, from performance.now(), in milliseconds.
	readonly arrived: number
}

// Result of drawing a view.
export interface TileFrame {
	// Tiles of the view not rasterized yet, nearest the center first.
	readonly missing: readonly TileId[]
	// Whether a tile is still fading in, so another frame is needed.
	readonly fading: boolean
}

// Cache of rasterized tiles that draws a view of the map on a canvas.
export class TileCache {
	// Rasterized tiles by key, least recently drawn first.
	private readonly tiles = new Map<string, CachedTile>()

	// Keeps a tile that has just been rasterized, replacing and releasing an older copy, and evicts the least
	// recently drawn tiles beyond MAX_CACHED_TILES, except those of the permanent levels.
	add(id: TileId, bitmap: ImageBitmap) {
		const key = tileKey(id)
		this.tiles.get(key)?.bitmap.close()
		this.tiles.delete(key)
		this.tiles.set(key, { bitmap, level: id.level, arrived: performance.now() })
		if (this.tiles.size <= MAX_CACHED_TILES) return

		for (const [oldest, tile] of this.tiles) {
			if (this.tiles.size <= MAX_CACHED_TILES) break
			if (tile.level <= PERMANENT_TILE_LEVELS) continue
			tile.bitmap.close()
			this.tiles.delete(oldest)
		}
	}

	// Returns whether a tile is cached.
	has(id: TileId): boolean {
		return this.tiles.has(tileKey(id))
	}

	// Releases every tile.
	clear() {
		for (const tile of this.tiles.values()) tile.bitmap.close()
		this.tiles.clear()
	}

	// Returns a cached tile and marks it as the most recently drawn.
	private use(key: string): CachedTile | undefined {
		const tile = this.tiles.get(key)
		if (!tile) return undefined
		this.tiles.delete(key)
		this.tiles.set(key, tile)
		return tile
	}

	// Draws a view on a canvas context whose pixels are device pixels: the tiles of the level of the view's scale,
	// each placed on whole device pixels so neighbours leave no seam, and the nearest cached ancestor wherever a
	// tile is missing or still fading in. dpr is the device pixels per CSS pixel and now the frame's time, from
	// performance.now().
	draw(context: CanvasRenderingContext2D, transform: ViewTransform, viewport: Size, dpr: number, wrap: boolean, now: number): TileFrame {
		const { scale } = transform
		const level = tileLevel(scale * dpr)
		const size = WORLD_MAP_WIDTH / 2 ** level
		const region = { x: -transform.x / scale, y: -transform.y / scale, width: viewport.width / scale, height: viewport.height / scale }
		const missing: TileId[] = []
		let fading = false

		context.setTransform(1, 0, 0, 1, 0, 0)
		context.clearRect(0, 0, context.canvas.width, context.canvas.height)

		for (const { id, column } of visibleTiles(level, region, wrap)) {
			const left = Math.round((transform.x + column * size * scale) * dpr)
			const top = Math.round((transform.y + id.y * size * scale) * dpr)
			const width = Math.round((transform.x + (column + 1) * size * scale) * dpr) - left
			const height = Math.round((transform.y + (id.y + 1) * size * scale) * dpr) - top
			const tile = this.use(tileKey(id))
			const opacity = tile ? Math.min(1, (now - tile.arrived) / TILE_FADE) : 0

			if (opacity < 1) {
				for (let depth = 1; depth <= level; depth++) {
					const source = ancestorSource(id, depth)
					const ancestor = this.use(tileKey(source.id))
					if (!ancestor) continue
					context.drawImage(ancestor.bitmap, source.sx, source.sy, source.size, source.size, left, top, width, height)
					break
				}
			}

			if (tile) {
				context.globalAlpha = opacity
				context.drawImage(tile.bitmap, left, top, width, height)
				context.globalAlpha = 1
				fading ||= opacity < 1
			} else {
				missing.push(id)
			}
		}

		return { missing, fading }
	}
}
