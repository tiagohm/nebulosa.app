import { describe, expect, test } from 'bun:test'
import type { SampleTileHeader } from 'api'
import { formatPixelReading } from './PixelCursorStatus'
import { cfaPhaseAt, decodeSampleTile, readPixel, SampleTileCache, type SampleTile, sourceValue, tileRect } from './pixeltiles'

const CONVERSION = { unit: 'adu', scale: 1000, offset: 10, rescaled: false } as const

// Builds an envelope as api/src/imagesamples.ts writes it.
function envelope(header: Omit<SampleTileHeader, 'version' | 'precision'>, samples: readonly number[], precision: 32 | 64 = 32, version = 1): ArrayBuffer {
	const json = new TextEncoder().encode(JSON.stringify({ ...header, version, precision }))
	const offset = Math.ceil((4 + json.length) / 8) * 8
	const bytes = new Uint8Array(offset + samples.length * (precision / 8))
	const view = new DataView(bytes.buffer)
	view.setUint32(0, json.length, true)
	bytes.set(json, 4)
	for (let i = 0; i < samples.length; i++) {
		if (precision === 64) view.setFloat64(offset + i * 8, samples[i], true)
		else view.setFloat32(offset + i * 4, samples[i], true)
	}
	return bytes.buffer
}

describe('tiles', () => {
	test('decodes 32 and 64-bit little-endian samples, keeping non-finite values', () => {
		const tile = decodeSampleTile(envelope({ left: 64, top: 0, width: 2, height: 2, channels: 1, conversion: CONVERSION }, [0.5, Number.NaN, Number.POSITIVE_INFINITY, -0.25]))
		expect(tile.samples).toBeInstanceOf(Float32Array)
		expect(Array.from(tile.samples)).toEqual([0.5, Number.NaN, Number.POSITIVE_INFINITY, -0.25])
		const wide = decodeSampleTile(envelope({ left: 0, top: 0, width: 1, height: 1, channels: 1, conversion: CONVERSION }, [1 / 3], 64))
		expect(wide.samples[0]).toBe(1 / 3)
		expect(() => decodeSampleTile(envelope({ left: 0, top: 0, width: 1, height: 1, channels: 1, conversion: CONVERSION }, [0], 32, 2))).toThrow()
	})

	test('aligns tiles to the grid, cut at the image edges', () => {
		expect(tileRect(70, 130, { width: 100, height: 150 })).toEqual({ left: 64, top: 128, width: 36, height: 22 })
		expect(tileRect(0, 0, { width: 100, height: 150 })).toEqual({ left: 0, top: 0, width: 64, height: 64 })
	})

	test('reads mono, RGB, and CFA pixels by absolute coordinates in source units', () => {
		const mono: SampleTile = { header: { version: 1, precision: 32, left: 64, top: 64, width: 2, height: 2, channels: 1, conversion: CONVERSION }, samples: new Float32Array([0.5, Number.NaN, Number.NEGATIVE_INFINITY, 0.25]) }
		expect(readPixel(mono, 64, 64)).toEqual({ values: [510] })
		expect(readPixel(mono, 65, 64)?.values[0]).toBeNaN()
		expect(readPixel(mono, 64, 65)).toEqual({ values: [Number.NEGATIVE_INFINITY] })
		expect(readPixel(mono, 63, 64)).toBeUndefined()

		const rgb: SampleTile = { header: { ...mono.header, left: 0, top: 0, width: 1, height: 1, channels: 3 }, samples: new Float32Array([0, 0.5, 1]) }
		expect(readPixel(rgb, 0, 0)).toEqual({ values: [10, 510, 1010] })

		const cfa: SampleTile = { header: { ...mono.header, left: 1, top: 1, cfa: 'GRBG' }, samples: new Float32Array([0.1, 0.2, 0.3, 0.4]) }
		expect(readPixel(cfa, 1, 1)?.phase).toBe('G2')
		expect(readPixel(cfa, 2, 1)?.phase).toBe('B')
		expect(readPixel(cfa, 1, 2)?.phase).toBe('R')
		expect(readPixel(cfa, 2, 2)?.phase).toBe('G1')
		expect(cfaPhaseAt('RGGB', 1, 0)).toBe('G1')
		expect(cfaPhaseAt('RGGB', 0, 1)).toBe('G2')
		expect(sourceValue(Number.POSITIVE_INFINITY, { ...CONVERSION, scale: 0 })).toBe(Number.POSITIVE_INFINITY)
	})

	test('formats readings by layout', () => {
		expect(formatPixelReading({ values: [1019.5] })).toBe('Value 1019.5')
		expect(formatPixelReading({ values: [1, 2, 3] })).toBe('R 1  G 2  B 3')
		expect(formatPixelReading({ values: [Number.NaN], phase: 'G2' })).toBe('G2 NaN')
	})
})

describe('cache', () => {
	const IMAGE = { width: 200, height: 100 }

	// Fake fetch answering tiles of a constant value after resolve() is called, recording the URLs and aborts.
	function server() {
		const calls: string[] = []
		const aborted: string[] = []
		const pending: (() => void)[] = []

		const request = ((input: string, init?: RequestInit) => {
			calls.push(input)
			const query = new URL(input, 'http://localhost').searchParams
			const header = { left: Number(query.get('left')), top: Number(query.get('top')), width: Number(query.get('width')), height: Number(query.get('height')), channels: 1, conversion: CONVERSION }
			const { promise, resolve, reject } = Promise.withResolvers<Response>()
			init?.signal?.addEventListener('abort', () => {
				aborted.push(input)
				reject(new DOMException('aborted', 'AbortError'))
			})
			pending.push(() => resolve(new Response(envelope(header, new Array(header.width * header.height).fill(0.5)))))
			return promise
		}) as unknown as typeof fetch

		const flush = async () => {
			for (const answer of pending.splice(0)) answer()
			await Bun.sleep(0)
		}

		return { request, calls, aborted, flush }
	}

	test('fetches a tile once and reads every pixel of it without another request', async () => {
		const { request, calls, flush } = server()
		const cache = new SampleTileCache(request)
		cache.load('image', 10, 10, IMAGE)
		cache.load('image', 11, 12, IMAGE)
		expect(cache.get('image', 10, 10, IMAGE)).toBeUndefined()
		await flush()
		expect(cache.state.version).toBe(1)
		for (const [x, y] of [
			[0, 0],
			[63, 63],
			[30, 5],
		] as const) {
			cache.load('image', x, y, IMAGE)
			expect(readPixel(cache.get('image', x, y, IMAGE)!, x, y)).toEqual({ values: [510] })
		}
		expect(calls).toEqual(['/api/images/image/samples?left=0&top=0&width=64&height=64'])
	})

	test('aborts a superseded fetch and drops the tiles of another image', async () => {
		const { request, calls, aborted, flush } = server()
		const cache = new SampleTileCache(request)
		cache.load('image', 10, 10, IMAGE)
		cache.load('image', 70, 10, IMAGE)
		await flush()
		expect(aborted).toEqual(['/api/images/image/samples?left=0&top=0&width=64&height=64'])
		expect(cache.get('image', 70, 10, IMAGE)).toBeDefined()
		expect(cache.get('image', 10, 10, IMAGE)).toBeUndefined()

		cache.load('other', 70, 10, IMAGE)
		expect(cache.size).toBe(0)
		expect(cache.get('image', 70, 10, IMAGE)).toBeUndefined()
		await flush()
		expect(calls).toHaveLength(3)
	})

	test('keeps the most recently used tiles within its byte bound', async () => {
		const { request, flush } = server()
		// Room for two 64x64 float32 tiles.
		const cache = new SampleTileCache(request, 2 * 64 * 64 * 4)
		for (const x of [0, 64, 128]) {
			cache.load('image', x, 0, { width: 192, height: 64 })
			await flush()
		}
		expect(cache.size).toBe(2)
		expect(cache.get('image', 0, 0, { width: 192, height: 64 })).toBeUndefined()
		expect(cache.get('image', 128, 0, { width: 192, height: 64 })).toBeDefined()
	})
})
