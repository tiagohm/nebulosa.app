import { WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from './worldmap.geometry'
import { TILE_SIZE } from './worldmap.tiles'

// Rasterizer of the world map's tiles, in a worker so a zoom never waits for the thousands of country paths to be
// drawn. The worker fetches web/assets/world.map.svg, turns its shapes into Path2D objects once, and draws each
// requested tile on an OffscreenCanvas, sending it back as an ImageBitmap. It is started from a Blob of the source
// of parseWorldMapSvg and tileWorker, which therefore reference nothing outside themselves; it needs a browser
// with OffscreenCanvas 2D contexts in workers.

// Message to the worker: what to rasterize the basemap from, once.
export interface TileWorkerInit {
	readonly type: 'init'
	// Absolute URL of world.map.svg.
	readonly url: string
	// Width of the map, in map units.
	readonly width: number
	// Height of the map, in map units.
	readonly height: number
	// Side of a tile, in device pixels.
	readonly tileSize: number
	// Colour of the sea and lakes, as CSS.
	readonly water: string
	// Colour of the land, as CSS.
	readonly land: string
	// Colour of the borders and coasts, as CSS.
	readonly border: string
	// Width of the borders, in map units, as world.map.svg draws them.
	readonly borderWidth: number
	// Largest width of the borders, in device pixels, so they stay thin when zoomed in.
	readonly maxBorderPixels: number
}

// Tile requested from the worker.
export interface TileRequest {
	// Cache key of the tile.
	readonly key: string
	// Level, the whole map 2^level tiles wide.
	readonly level: number
	// Column from the west edge.
	readonly x: number
	// Row from the north edge.
	readonly y: number
}

// Message to the worker: the tiles to rasterize, in order, replacing those still waiting.
export interface TileWorkerWant {
	readonly type: 'want'
	// Tiles to rasterize, most wanted first.
	readonly tiles: readonly TileRequest[]
}

// Message from the worker: a rasterized tile, or why the basemap cannot be drawn.
export type TileWorkerMessage = { readonly type: 'tile'; readonly tile: TileRequest; readonly bitmap: ImageBitmap } | { readonly type: 'error'; readonly message: string }

// Shapes of world.map.svg as SVG path data.
export interface WorldMapShapes {
	// Path data of each country, filled with the land colour and outlined with the border colour.
	readonly countries: readonly string[]
	// Path data of each lake, filled with the water colour over the land.
	readonly lakes: readonly string[]
}

// Colours of world.map.svg, from its stylesheet.
export const WORLD_MAP_STYLE = { water: '#0e0e0e', land: '#272727', border: '#313131', borderWidth: 0.25 } as const

// Largest width of the borders on screen, in device pixels.
const MAX_BORDER_PIXELS = 1.5

// Returns the shapes of the countries and lakes groups of world.map.svg as path data; polygons and polylines become
// paths through their points. Self-contained: it runs in the worker from its source.
export function parseWorldMapSvg(svg: string): WorldMapShapes {
	function group(name: string) {
		const start = svg.indexOf(`<g class="${name}">`)
		return start < 0 ? '' : svg.slice(start, svg.indexOf('</g>', start))
	}

	function shapes(content: string) {
		const paths: string[] = []

		for (const [, tag, data] of content.matchAll(/<(path|polygon|polyline)\b[^>]*?\s(?:d|points)="([^"]*)"/g)) {
			if (tag === 'path') paths.push(data ?? '')
			else paths.push(`M${(data ?? '').trim()}${tag === 'polygon' ? 'Z' : ''}`)
		}

		return paths
	}

	return { countries: shapes(group('countries')), lakes: shapes(group('lakes')) }
}

// Body of the worker: waits for the init message and rasterizes the requested tiles in order, nearest first, in
// batches of about BATCH_TIME, yielding between batches through a message channel (a timer would be clamped to 4
// ms) so a new request replaces the queue before the next batch. A tile takes 1 to 4 ms. Self-contained: it runs
// in the worker from its source, with parseWorldMapSvg.
export function tileWorker() {
	interface Scope {
		addEventListener: (type: 'message', listener: (event: MessageEvent<TileWorkerInit | TileWorkerWant>) => void) => void
		postMessage: (message: TileWorkerMessage, transfer?: Transferable[]) => void
	}

	// Time a batch of tiles may take before the worker yields to new requests, in milliseconds.
	const BATCH_TIME = 8

	// Time during which a tile just sent is not rasterized again, in milliseconds: a request sent before the tile
	// reached the page still lists it.
	const SENT_TIME = 1000

	const scope = globalThis as unknown as Scope
	const channel = new MessageChannel()
	let init: TileWorkerInit | undefined
	let countries: Path2D[] = []
	let lakes: Path2D[] = []
	let queue: TileRequest[] = []
	// When each tile was last sent, by key, from performance.now().
	const sent = new Map<string, number>()
	let scheduled = false
	let canvas: OffscreenCanvas | undefined
	let context: OffscreenCanvasRenderingContext2D | null = null

	function schedule() {
		if (scheduled || !context || queue.length === 0) return
		scheduled = true
		channel.port2.postMessage(undefined, [])
	}

	function batch() {
		scheduled = false
		const start = performance.now()
		while (queue.length > 0 && performance.now() - start < BATCH_TIME) render()
		schedule()
	}

	function render() {
		const tile = queue.shift()
		if (!tile || !init || !canvas || !context) return
		const scale = (init.tileSize * 2 ** tile.level) / init.width
		context.setTransform(1, 0, 0, 1, 0, 0)
		context.clearRect(0, 0, init.tileSize, init.tileSize)
		context.setTransform(scale, 0, 0, scale, -tile.x * init.tileSize, -tile.y * init.tileSize)
		context.fillStyle = init.water
		context.fillRect(0, 0, init.width, init.height)
		context.fillStyle = init.land
		for (const path of countries) context.fill(path)
		context.strokeStyle = init.border
		context.lineWidth = Math.min(init.borderWidth, init.maxBorderPixels / scale)
		context.lineCap = 'round'
		context.lineJoin = 'round'
		for (const path of countries) context.stroke(path)
		context.fillStyle = init.water
		for (const path of lakes) context.fill(path)
		const bitmap = canvas.transferToImageBitmap()
		scope.postMessage({ type: 'tile', tile, bitmap }, [bitmap])
		sent.set(tile.key, performance.now())
	}

	// Replaces the queue with the requested tiles not sent in the last SENT_TIME, forgetting older sends.
	function request(tiles: readonly TileRequest[]) {
		const now = performance.now()
		for (const [key, time] of sent) if (now - time > SENT_TIME) sent.delete(key)
		queue = tiles.filter((tile) => !sent.has(tile.key))
	}

	async function start(message: TileWorkerInit) {
		try {
			const response = await fetch(message.url)
			const shapes = parseWorldMapSvg(await response.text())
			countries = shapes.countries.map((data) => new Path2D(data))
			lakes = shapes.lakes.map((data) => new Path2D(data))
			canvas = new OffscreenCanvas(message.tileSize, message.tileSize)
			context = canvas.getContext('2d')
			if (!context) throw new Error('OffscreenCanvas 2D is not available')
			schedule()
		} catch (error) {
			scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }, [])
		}
	}

	channel.port1.addEventListener('message', batch)
	channel.port1.start()

	scope.addEventListener('message', ({ data }) => {
		if (data.type === 'init') {
			init = data
			void start(data)
		} else {
			request(data.tiles)
			schedule()
		}
	})
}

// Starts a tile worker for world.map.svg at a URL, resolved against the page.
export function startTileWorker(url: string): Worker {
	const source = `${parseWorldMapSvg.toString()}\n(${tileWorker.toString()})()`
	const blob = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
	const worker = new Worker(blob)
	URL.revokeObjectURL(blob)
	const init: TileWorkerInit = { type: 'init', url: new URL(url, location.href).href, width: WORLD_MAP_WIDTH, height: WORLD_MAP_HEIGHT, tileSize: TILE_SIZE, ...WORLD_MAP_STYLE, maxBorderPixels: MAX_BORDER_PIXELS }
	worker.postMessage(init, [])
	return worker
}
