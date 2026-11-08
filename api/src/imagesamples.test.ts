import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createImageRoutes, ImageStore } from './images'
import { encodeSampleTile, SAMPLE_TILE_VERSION, type SampleTileHeader } from './imagesamples'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-samples-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

// Size of a FITS block, in bytes.
const BLOCK = 2880

let files = 0

// Formats a FITS card of a numeric value.
function card(key: string, value: number) {
	return `${key.padEnd(8)}= ${String(value).padStart(20)}`
}

// Writes a FITS image of stored values value(x, y, c) and returns its path.
function writeFits(width: number, height: number, bitpix: 8 | 16 | 32, channels: 1 | 3, extra: readonly string[], value: (x: number, y: number, c: number) => number) {
	const axes = channels === 3 ? ['NAXIS   =                    3', card('NAXIS1', width), card('NAXIS2', height), card('NAXIS3', 3)] : ['NAXIS   =                    2', card('NAXIS1', width), card('NAXIS2', height)]
	const cards = ['SIMPLE  =                    T', card('BITPIX', bitpix), ...axes, ...extra, 'END']
	const header = Buffer.alloc(Math.ceil((cards.length * 80) / BLOCK) * BLOCK, ' ')
	for (const [i, line] of cards.entries()) header.write(line.padEnd(80), i * 80, 'latin1')
	const bytes = bitpix / 8
	const data = Buffer.alloc(Math.ceil((width * height * channels * bytes) / BLOCK) * BLOCK)

	for (let c = 0, offset = 0; c < channels; c++) {
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++, offset += bytes) {
				const sample = value(x, y, c)
				if (bitpix === 8) data.writeUInt8(sample, offset)
				else if (bitpix === 16) data.writeInt16BE(sample, offset)
				else data.writeInt32BE(sample, offset)
			}
		}
	}

	const path = join(root, `samples-${files++}.fits`)
	writeFileSync(path, Buffer.concat([header, data]))
	return path
}

// Decodes an envelope the way the web does, as an independent check of the format.
function decode(buffer: ArrayBuffer) {
	const view = new DataView(buffer)
	const length = view.getUint32(0, true)
	const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length))) as SampleTileHeader
	const offset = Math.ceil((4 + length) / 8) * 8
	const size = header.precision / 8
	const count = (buffer.byteLength - offset) / size
	const samples = Array.from({ length: count }, (_, i) => (size === 8 ? view.getFloat64(offset + i * 8, true) : view.getFloat32(offset + i * 4, true)))
	return { header, offset, samples }
}

type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>

// Fetches a tile through the route.
function tile(routes: ReturnType<typeof createImageRoutes>, id: string, query: string) {
	const handler = routes['/api/images/:id/samples'].GET as unknown as Handler
	return Promise.resolve(handler(Object.assign(new Request(`http://localhost/api/images/${id}/samples?${query}`), { params: { id } })))
}

test('encodes the header, the padding, and little-endian samples, keeping non-finite values', () => {
	const samples = new Float32Array([0.5, Number.NaN, Number.POSITIVE_INFINITY, -0.25])
	const bytes = encodeSampleTile({ left: 3, top: 4, width: 2, height: 2, channels: 1, conversion: { unit: 'adu', scale: 65535, offset: 0, rescaled: false }, cfa: 'RGGB' }, samples)
	const { header, offset, samples: decoded } = decode(bytes.buffer)
	expect(header).toEqual({ left: 3, top: 4, width: 2, height: 2, channels: 1, conversion: { unit: 'adu', scale: 65535, offset: 0, rescaled: false }, cfa: 'RGGB', version: SAMPLE_TILE_VERSION, precision: 32 })
	expect(offset % 8).toBe(0)
	expect(decoded).toEqual([0.5, Number.NaN, Number.POSITIVE_INFINITY, -0.25])
	expect(decode(encodeSampleTile({ left: 0, top: 0, width: 1, height: 1, channels: 1, conversion: { unit: 'source', scale: 1, offset: 0, rescaled: false } }, new Float64Array([1 / 3])).buffer).samples).toEqual([1 / 3])
})

test('serves the native interleaved samples of a rectangle with the source conversion', async () => {
	const images = new ImageStore()
	const routes = createImageRoutes(images)
	const info = await images.open(writeFits(8, 6, 8, 3, [], (x, y, c) => x + 10 * y + 60 * c))
	const response = await tile(routes, info.id, 'left=2&top=1&width=3&height=2')
	expect(response.status).toBe(200)
	expect(response.headers.get('Cache-Control')).toBe('no-store')
	const { header, samples } = decode(await response.arrayBuffer())
	expect(header).toMatchObject({ left: 2, top: 1, width: 3, height: 2, channels: 3, precision: 32, conversion: { unit: 'adu', scale: 255, offset: 0, rescaled: false } })
	// Pixel (3, 2) of the image is pixel (1, 1) of the tile, its blue sample the third channel.
	const codes = samples.map((value) => Math.round(value * header.conversion.scale + header.conversion.offset))
	expect(codes.slice((1 * 3 + 1) * 3, (1 * 3 + 1) * 3 + 3)).toEqual([23, 83, 143])
	expect((await tile(routes, 'unknown', 'left=0&top=0&width=1&height=1')).status).toBe(404)
	images[Symbol.dispose]()
})

test('names the trusted pattern of a mosaic and keeps 64-bit samples', async () => {
	const images = new ImageStore()
	const routes = createImageRoutes(images)
	const mosaic = await images.open(writeFits(4, 4, 16, 1, ['BZERO   =                32768', "BAYERPAT= 'GRBG    '"], (x, y) => 1000 + x + 4 * y - 32768))
	const mosaicTile = decode(await (await tile(routes, mosaic.id, 'left=1&top=1&width=2&height=2')).arrayBuffer())
	expect(mosaicTile.header.cfa).toBe('GRBG')
	expect(mosaicTile.samples.map((value) => Math.round(value * mosaicTile.header.conversion.scale))).toEqual([1005, 1006, 1009, 1010])

	const wide = await images.open(writeFits(2, 2, 32, 1, [], (x, y) => 100000 + x + 2 * y))
	const wideTile = decode(await (await tile(routes, wide.id, 'left=0&top=0&width=2&height=2')).arrayBuffer())
	expect(wideTile.header.precision).toBe(64)
	expect(wideTile.samples.map((value) => Math.round(value * wideTile.header.conversion.scale + wideTile.header.conversion.offset))).toEqual([100000, 100001, 100002, 100003])
	images[Symbol.dispose]()
})
