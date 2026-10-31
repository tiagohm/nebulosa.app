import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readImageFromPath } from 'nebulosa/src/imaging/model/image'
import type { ApiError } from './http'
import { cropImage } from './imagedecode'
import { cfaPattern, type DisplaySettings, imageAcquisition, type ImageInfo, images, precisionOf, type RenderResult, type SaveRequest } from './images'
import { routes } from './index'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-images-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

// Size of a FITS block, in bytes.
const BLOCK = 2880

// Writes an 8-bit FITS file with a gradient (grayscale, or RGB with 3 channels) plus extra header
// cards, and returns its path.
function writeFits(name: string, width: number, height: number, channels = 1, extra: readonly string[] = []) {
	const axes = channels === 1 ? ['NAXIS   =                    2'] : ['NAXIS   =                    3']
	const cards = ['SIMPLE  =                    T', 'BITPIX  =                    8', ...axes, `NAXIS1  = ${String(width).padStart(20)}`, `NAXIS2  = ${String(height).padStart(20)}`, ...(channels === 1 ? [] : [`NAXIS3  = ${String(channels).padStart(20)}`]), "OBJECT  = 'M31     '", ...extra, 'END']
	const header = Buffer.alloc(BLOCK, ' ')
	for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
	const size = width * height * channels
	const data = Buffer.alloc(Math.ceil(size / BLOCK) * BLOCK)
	for (let i = 0; i < size; i++) data[i] = (i * 7) % 256
	const path = join(root, name)
	writeFileSync(path, Buffer.concat([header, data]))
	return path
}

// Display settings that leave everything neutral, with an auto linked stretch and no debayering.
const NEUTRAL: DisplaySettings = { debayer: { enabled: false }, stretch: { mode: 'auto', linked: true }, brightness: 1, contrast: 1, gamma: 1, saturation: 1, scnr: { enabled: false }, invert: false }

// Settings with some fields replaced.
function settings(patch: Partial<DisplaySettings>): DisplaySettings {
	return { ...NEUTRAL, ...patch }
}

// Opens a FITS file and returns its info.
async function openFits(path: string) {
	return (await (await call('/api/images', 'POST', {}, { path })).json()) as ImageInfo
}

// Renders a document and returns the response.
function render(id: string, value: DisplaySettings) {
	return call('/api/images/:id/render', 'POST', { id }, { settings: value })
}

// Returns the RenderResult of a rendering response.
function resultOf(response: Response) {
	return JSON.parse(response.headers.get('X-Image-Render')!) as RenderResult
}

type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>

function call(route: keyof typeof routes, method: 'GET' | 'POST' | 'DELETE', params: Record<string, string>, body?: unknown, query = '') {
	const handler = (routes[route] as Record<string, Handler>)[method]
	const req = Object.assign(new Request(`http://localhost/${query}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params })
	return Promise.resolve(handler(req))
}

// Writes a 64-bit floating-point FITS file whose samples (1000 + 250.5 i) lie outside 0..1 and returns
// its path and samples.
function writeFloatFits(name: string) {
	const cards = ['SIMPLE  =                    T', 'BITPIX  =                  -64', 'NAXIS   =                    2', 'NAXIS1  =                   16', 'NAXIS2  =                    8', 'END']
	const header = Buffer.alloc(BLOCK, ' ')
	for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
	const samples = Array.from({ length: 16 * 8 }, (_, i) => 1000 + i * 250.5)
	const data = Buffer.alloc(Math.ceil((samples.length * 8) / BLOCK) * BLOCK)
	for (const [i, sample] of samples.entries()) data.writeDoubleBE(sample, i * 8)
	const path = join(root, name)
	writeFileSync(path, Buffer.concat([header, data]))
	return { path, samples }
}

// Adopts an unchanged full copy of a document as a derived document, as an empty pipeline would, and returns its info.
async function adoptCopy(source: ImageInfo) {
	const image = (await images.processingImage(source.id))!
	return images.adopt(image, { kind: 'processing', source: source.id, sourceName: source.name, steps: [], createdAt: new Date().toISOString() })
}

// Saves a document and returns the response.
function save(id: string, body: SaveRequest) {
	return call('/api/images/:id/save', 'POST', { id }, body)
}

describe('image documents', () => {
	test('open, render, and close a FITS file', async () => {
		const path = writeFits('m31.fits', 16, 8)
		const opened = await call('/api/images', 'POST', {}, { path })
		const info = (await opened.json()) as ImageInfo
		const { id } = info

		expect(opened.status).toBe(201)
		expect(id).toBeString()
		expect(info).toMatchObject({ name: 'm31.fits', path, format: 'fits', width: 16, height: 8, channels: 1 })
		expect(info.header.OBJECT).toBe('M31')
		expect(info.acquisition.object).toBe('M31')

		const auto = await render(id, NEUTRAL)
		const result = resultOf(auto)
		const jpeg = new Uint8Array(await auto.arrayBuffer())

		expect(auto.status).toBe(200)
		expect(auto.headers.get('Content-Type')).toBe('image/jpeg')
		expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8])
		expect(result.channels).toBe(1)
		expect(result.stretch).toHaveLength(1)
		for (const value of Object.values(result.stretch[0])) expect(value).toBeWithin(0, 1.000001)

		const stretch = { midtone: 0.25, shadow: 0.1, highlight: 0.9 }
		const manual = await render(id, settings({ stretch: { mode: 'manual', stretch } }))
		expect(resultOf(manual)).toEqual({ stretch: [stretch], channels: 1 })

		const linear = await render(id, settings({ stretch: { mode: 'linear' } }))
		expect(resultOf(linear).stretch).toEqual([{ midtone: 0.5, shadow: 0, highlight: 1 }])

		expect((await call('/api/images/:id', 'DELETE', { id })).status).toBe(204)
		expect((await render(id, NEUTRAL)).status).toBe(404)
		const closed = await call('/api/images/:id', 'DELETE', { id })
		expect(closed.status).toBe(404)
		expect(((await closed.json()) as ApiError).code).toBe('notFound')
	})

	test('renderings never modify the decoded image', async () => {
		const { id } = await openFits(writeFits('pristine.fits', 16, 8))
		const first = new Uint8Array(await (await render(id, NEUTRAL)).arrayBuffer())
		await render(id, settings({ brightness: 0.5, contrast: 2, gamma: 2, invert: true }))
		const again = new Uint8Array(await (await render(id, NEUTRAL)).arrayBuffer())

		expect(again).toEqual(first)
		images.close(id)
	})

	test('a CFA mosaic is debayered with its pattern shifted by the header offsets', async () => {
		const info = await openFits(writeFits('cfa.fits', 16, 8, 1, ["BAYERPAT= 'RGGB    '", 'XBAYROFF=                    1']))

		expect(info.bayer).toBe('RGGB')
		expect(info.cfa).toBe('GRBG')

		const debayered = await render(info.id, settings({ debayer: { enabled: true, pattern: 'auto' }, stretch: { mode: 'auto', linked: false } }))
		expect(resultOf(debayered)).toMatchObject({ cfa: 'GRBG', channels: 3 })
		expect(resultOf(debayered).stretch).toHaveLength(3)

		const explicit = await render(info.id, settings({ debayer: { enabled: true, pattern: 'BGGR' } }))
		expect(resultOf(explicit)).toMatchObject({ cfa: 'BGGR', channels: 3 })

		const mosaic = await render(info.id, NEUTRAL)
		expect(resultOf(mosaic)).toEqual({ stretch: resultOf(mosaic).stretch, channels: 1 })
		images.close(info.id)
	})

	test('debayering without a known pattern is 422', async () => {
		const info = await openFits(writeFits('unknown.fits', 16, 8, 1, ["BAYERPAT= 'XYZW    '"]))
		const response = await render(info.id, settings({ debayer: { enabled: true, pattern: 'auto' } }))

		expect(info.cfa).toBeUndefined()
		expect(response.status).toBe(422)
		images.close(info.id)
	})

	test('an RGB image is never debayered', async () => {
		const info = await openFits(writeFits('rgb.fits', 16, 8, 3))
		const response = await render(info.id, settings({ debayer: { enabled: true, pattern: 'RGGB' }, saturation: 1.5, scnr: { enabled: true, channel: 'GREEN', amount: 0.5, method: 'AVERAGE_NEUTRAL' } }))

		expect(info.channels).toBe(3)
		expect(resultOf(response)).toMatchObject({ channels: 3 })
		expect(resultOf(response).cfa).toBeUndefined()
		images.close(info.id)
	})

	test('a newer rendering of the same document supersedes a queued one', async () => {
		// A large rendering keeps the worker busy, so both renderings of the small image are queued behind it.
		const busy = await openFits(writeFits('busy.fits', 1500, 1500))
		const { id } = await openFits(writeFits('queued.fits', 16, 8))
		const [blocker, first, second] = await Promise.all([render(busy.id, NEUTRAL), render(id, NEUTRAL), render(id, settings({ invert: true }))])

		expect(blocker.status).toBe(200)
		expect(first.status).toBe(409)
		expect(second.status).toBe(200)
		images.close(busy.id)
		images.close(id)
	})

	test('an aborted request drops its queued rendering', async () => {
		const { id } = await openFits(writeFits('aborted.fits', 16, 8))
		const controller = new AbortController()
		const req = Object.assign(new Request('http://localhost/', { method: 'POST', body: JSON.stringify({ settings: NEUTRAL }), signal: controller.signal }), { params: { id } })
		const pending = Promise.resolve((routes['/api/images/:id/render'] as Record<string, Handler>).POST(req))
		controller.abort()

		expect((await pending).status).toBe(409)
		images.close(id)
	})

	test('opens and renders a 64-bit float FITS file outside 0..1', async () => {
		const info = await openFits(writeFloatFits('float64.fits').path)
		const response = await render(info.id, NEUTRAL)

		expect(info).toMatchObject({ width: 16, height: 8, channels: 1 })
		expect(response.status).toBe(200)
		images.close(info.id)
	})

	test('a file that is not FITS or XISF is 415', async () => {
		const path = join(root, 'notes.txt')
		writeFileSync(path, 'not an image')
		expect((await call('/api/images', 'POST', {}, { path })).status).toBe(415)
	})

	test('a missing file is 404', async () => {
		expect((await call('/api/images', 'POST', {}, { path: join(root, 'missing.fits') })).status).toBe(404)
	})
})

describe('derived images', () => {
	for (const format of ['fits', 'xisf'] as const) {
		test(`saving as ${format.toUpperCase()} restores the scale of the source`, async () => {
			const { path, samples } = writeFloatFits(`derive-float-${format}.fits`)
			const source = await openFits(path)
			const derived = await adoptCopy(source)
			const target = join(root, `saved.${format}`)

			const response = await save(derived.id, { path: target, format })
			const reread = (await readImageFromPath(target, { sampleScale: 'digital', raw: 64 }))!

			expect(response.status).toBe(200)
			expect(await response.json()).toEqual({ path: target })
			expect(reread.metadata.bitpix).toBe(-64)
			for (const [i, sample] of samples.entries()) expect(reread.raw[i]).toBeCloseTo(sample, 6)

			images.close(source.id)
			images.close(derived.id)
		})
	}

	test('saving never replaces an open file nor an existing one without overwrite', async () => {
		const path = writeFits('derive-guard.fits', 16, 8)
		const source = await openFits(path)
		const derived = await adoptCopy(source)
		const existing = join(root, 'existing.xisf')
		writeFileSync(existing, 'old')

		const original = await save(derived.id, { path, format: 'fits', overwrite: true })
		expect(original.status).toBe(409)
		expect(await original.json()).toMatchObject({ code: 'original' })

		const exists = await save(derived.id, { path: existing, format: 'xisf' })
		expect(exists.status).toBe(409)
		expect(await exists.json()).toMatchObject({ code: 'exists' })
		expect(readFileSync(existing, 'latin1')).toBe('old')

		expect((await save(derived.id, { path: existing, format: 'xisf', overwrite: true })).status).toBe(200)
		expect(readFileSync(existing, 'latin1').startsWith('XISF0100')).toBeTrue()
		expect(readdirSync(root).some((name) => name.endsWith('.tmp'))).toBeFalse()

		images.close(source.id)
		images.close(derived.id)
	})

	test('download returns the encoded file as a named attachment', async () => {
		const source = await openFits(writeFits('derive-download.fits', 16, 8))
		const derived = await adoptCopy(source)

		const fits = await call('/api/images/:id/file', 'GET', { id: derived.id }, undefined, '?format=fits')
		const xisf = await call('/api/images/:id/file', 'GET', { id: derived.id }, undefined, '?format=xisf')

		expect(fits.headers.get('Content-Disposition')).toBe(`attachment; filename="derive-download _ Processed.fits"; filename*=UTF-8''${encodeURIComponent('derive-download — Processed.fits')}`)
		expect(Buffer.from(await fits.arrayBuffer()).toString('latin1', 0, 6)).toBe('SIMPLE')
		expect(Buffer.from(await xisf.arrayBuffer()).toString('latin1', 0, 8)).toBe('XISF0100')

		images.close(source.id)
		images.close(derived.id)
		expect((await call('/api/images/:id/file', 'GET', { id: derived.id }, undefined, '?format=fits')).status).toBe(404)
	})
})

describe('copies of any document', () => {
	test('a file document is saved as the JPEG of its rendering and stays open as it was', async () => {
		const info = await openFits(writeFits('copy-jpeg.fits', 16, 8, 3))
		const brighter = settings({ brightness: 1.5 })
		const target = join(root, 'copy.jpg')

		const response = await save(info.id, { path: target, format: 'jpeg', settings: brighter })

		expect(response.status).toBe(200)
		expect(readFileSync(target)).toEqual(Buffer.from(await (await render(info.id, brighter)).arrayBuffer()))
		expect(readFileSync(target).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
		images.close(info.id)
	})

	test('a JPEG whose settings cannot be applied is 422 and writes nothing', async () => {
		const info = await openFits(writeFits('copy-unknown.fits', 16, 8, 1, ["BAYERPAT= 'XYZW    '"]))
		const target = join(root, 'copy-unknown.jpg')

		const response = await save(info.id, { path: target, format: 'jpeg', settings: settings({ debayer: { enabled: true, pattern: 'auto' } }) })

		expect(response.status).toBe(422)
		expect(await response.json()).toMatchObject({ code: 'invalidSettings' })
		expect(readdirSync(root)).not.toContain('copy-unknown.jpg')
		images.close(info.id)
	})

	test('a file document is downloaded under its name without a doubled extension', async () => {
		const info = await openFits(writeFits('copy-download.fit', 16, 8))

		const fits = await call('/api/images/:id/file', 'GET', { id: info.id }, undefined, '?format=fits')
		const xisf = await call('/api/images/:id/file', 'GET', { id: info.id }, undefined, '?format=xisf')

		expect(fits.headers.get('Content-Disposition')).toStartWith('attachment; filename="copy-download.fits";')
		expect(xisf.headers.get('Content-Disposition')).toStartWith('attachment; filename="copy-download.xisf";')
		images.close(info.id)
	})
})

describe('precision', () => {
	test('is 64 bits only for 32-bit integers and 64-bit floats', () => {
		expect([8, 16, 32, 64, -32, -64].map(precisionOf)).toEqual([32, 32, 64, 32, 32, 64])
	})
})

describe('CFA pattern', () => {
	test('is BAYERPAT shifted by integer offsets', () => {
		expect(cfaPattern({ BAYERPAT: 'RGGB' }, 1)).toBe('RGGB')
		expect(cfaPattern({ BAYERPAT: 'rggb', YBAYROFF: 1 }, 1)).toBe('GBRG')
		expect(cfaPattern({ BAYERPAT: 'RGGB', XBAYROFF: 1, YBAYROFF: 1 }, 1)).toBe('BGGR')
	})

	test('is absent when it cannot be trusted', () => {
		expect(cfaPattern({}, 1)).toBeUndefined()
		expect(cfaPattern({ BAYERPAT: 'RGGB' }, 3)).toBeUndefined()
		expect(cfaPattern({ BAYERPAT: 'RGB' }, 1)).toBeUndefined()
		expect(cfaPattern({ BAYERPAT: 'RGGB', XBAYROFF: 0.5 }, 1)).toBeUndefined()
	})
})

describe('acquisition', () => {
	test('resolves equivalent keywords once', () => {
		const acquisition = imageAcquisition({ EXPTIME: 30, EXPOSURE: 60, 'DATE-OBS': '2024-03-01T22:15:30.5', XBINNING: 2, YBINNING: 2, 'CCD-TEMP': -10, INSTRUME: 'ZWO ASI294MC Pro', FOCALLEN: '400' })

		expect(acquisition).toEqual({ exposure: 30, date: '2024-03-01T22:15:30.500Z', binning: { x: 2, y: 2 }, temperature: -10, camera: 'ZWO ASI294MC Pro', focalLength: 400 })
	})

	test('falls back to EXPOSURE and to the horizontal binning', () => {
		expect(imageAcquisition({ EXPOSURE: 5, XBINNING: 3 })).toEqual({ exposure: 5, binning: { x: 3, y: 3 } })
	})

	test('blank and non-numeric values are absent', () => {
		expect(imageAcquisition({ TELESCOP: '   ', GAIN: 'high', OBJECT: 'M42' })).toEqual({ object: 'M42' })
	})
})

describe('capture documents', () => {
	const capture = { connectionId: 'connection', deviceId: 'camera', frameId: 'session:1', time: Date.UTC(2026, 9, 19) }

	test('open a camera frame from its bytes', async () => {
		const bytes = new Uint8Array(readFileSync(writeFits('frame.fits', 16, 8)))
		const info = await images.openCapture(bytes, 'Camera #1', capture)

		expect(info).toMatchObject({ origin: 'capture', format: 'fits', name: 'Camera #1', width: 16, height: 8, channels: 1, ...capture })
		expect(info.acquisition.object).toBe('M31')
		expect(bytes.byteLength).toBe(0)
		expect((await render(info.id, NEUTRAL)).status).toBe(200)
		expect(images.close(info.id)).toBeTrue()
	})

	test('never replaces the file a frame is saved to', async () => {
		const path = writeFits('saved-frame.fits', 16, 8)
		const info = await images.openCapture(new Uint8Array(readFileSync(path)), 'saved-frame.fits', { ...capture, path })

		expect(info).toMatchObject({ origin: 'capture', path })
		expect(await images.save(info.id, { path, format: 'fits', overwrite: true })).toEqual({ status: 'original' })
		images.close(info.id)
	})

	test('refuses bytes that are not an image', () => {
		expect(images.openCapture(new TextEncoder().encode('not an image'), 'Camera #2', capture)).rejects.toThrow('The camera frame is not a FITS or XISF image')
	})
})

describe('retention', () => {
	test('a retained document closed meanwhile keeps its pixels until the last release', async () => {
		const info = await openFits(writeFits('retained.fits', 16, 8))
		const discarded: string[] = []
		const unsubscribe = images.onDiscard((id) => discarded.push(id))

		try {
			expect(images.retain(info.id)).toEqual({ width: 16, height: 8 })
			expect(images.retain(info.id)).toEqual({ width: 16, height: 8 })
			expect(images.close(info.id)).toBeTrue()

			// Closed for every route at once, still readable by the analyses retaining it.
			expect((await render(info.id, NEUTRAL)).status).toBe(404)
			expect(await images.encode(info.id, 'fits')).toBeUndefined()
			expect(images.retain(info.id)).toBeUndefined()
			expect(await images.detectionImage(info.id)).toBeDefined()
			expect(await images.detectionFile(info.id)).toBeDefined()

			images.release(info.id)
			expect(discarded).toEqual([])
			images.release(info.id)
			expect(discarded).toEqual([info.id])
			expect(await images.detectionImage(info.id)).toBeUndefined()
		} finally {
			unsubscribe()
		}
	})

	test('closing a document nobody retains releases it at once, and releasing an open one keeps it', async () => {
		const info = await openFits(writeFits('unretained.fits', 16, 8))
		const discarded: string[] = []
		const unsubscribe = images.onDiscard((id) => discarded.push(id))

		try {
			images.retain(info.id)
			images.release(info.id)
			expect(discarded).toEqual([])
			expect((await render(info.id, NEUTRAL)).status).toBe(200)
			expect(images.close(info.id)).toBeTrue()
			expect(discarded).toEqual([info.id])
		} finally {
			unsubscribe()
		}
	})
})

describe('detection image', () => {
	test('is an owned copy of a mono image without a Bayer pattern', async () => {
		const info = await openFits(writeFits('detect-mono.fits', 16, 8))
		const first = (await images.detectionImage(info.id))!
		const second = (await images.detectionImage(info.id))!

		expect(first.metadata).toMatchObject({ width: 16, height: 8, channels: 1, bayer: undefined })
		first.raw.fill(0)
		expect(second.raw.some((value) => value !== 0)).toBeTrue()
		images.close(info.id)
	})

	test('is the luminance of an RGB image', async () => {
		const info = await openFits(writeFits('detect-rgb.fits', 16, 8, 3))
		const image = (await images.detectionImage(info.id))!

		expect(image.metadata).toMatchObject({ width: 16, height: 8, channels: 1 })
		expect(image.raw).toHaveLength(16 * 8)
		images.close(info.id)
	})

	test('is the luminance of a CFA mosaic debayered with its trusted pattern', async () => {
		const info = await openFits(writeFits('detect-cfa.fits', 16, 8, 1, ["BAYERPAT= 'RGGB    '"]))
		const image = (await images.detectionImage(info.id))!
		const untrusted = await openFits(writeFits('detect-cfa-unknown.fits', 16, 8, 1, ["BAYERPAT= 'XYZW    '"]))
		const mosaic = (await images.detectionImage(untrusted.id))!

		expect(image.metadata).toMatchObject({ width: 16, height: 8, channels: 1, bayer: undefined })
		// A mosaic without a trusted pattern is measured as is, so its samples differ from the luminance of the
		// same samples debayered.
		expect(mosaic.metadata).toMatchObject({ channels: 1, bayer: undefined })
		expect(Array.from(image.raw)).not.toEqual(Array.from(mosaic.raw))
		images.close(info.id)
		images.close(untrusted.id)
	})
})

describe('detection region', () => {
	// Rectangles of a 16 × 8 image: inside it at odd and even origins, and against each of its edges.
	const RECTS = [
		{ left: 5, top: 3, width: 6, height: 3 },
		{ left: 4, top: 2, width: 6, height: 3 },
		{ left: 0, top: 0, width: 4, height: 4 },
		{ left: 11, top: 5, width: 5, height: 3 },
	]

	// Expects each rectangle of a document to hold the same samples as that rectangle of its whole detection image.
	async function expectSameAsDetectionImage(id: string) {
		const image = (await images.detectionImage(id))!

		for (const rect of RECTS) {
			const region = (await images.detectionRegion(id, rect))!
			expect(region.image.metadata).toMatchObject({ width: rect.width, height: rect.height, channels: 1, stride: rect.width, pixelCount: rect.width * rect.height, bayer: undefined })
			expect(Array.from(region.image.raw)).toEqual(Array.from(cropImage(image, rect).raw))
		}
	}

	test('is that rectangle of the detection image of a mono image', async () => {
		const info = await openFits(writeFits('region-mono.fits', 16, 8))
		await expectSameAsDetectionImage(info.id)
		images.close(info.id)
	})

	test('is that rectangle of the detection image of an RGB image', async () => {
		const info = await openFits(writeFits('region-rgb.fits', 16, 8, 3))
		await expectSameAsDetectionImage(info.id)
		images.close(info.id)
	})

	test('keeps the phase of a CFA mosaic at any origin, with or without header offsets', async () => {
		const plain = await openFits(writeFits('region-cfa.fits', 16, 8, 1, ["BAYERPAT= 'RGGB    '"]))
		const shifted = await openFits(writeFits('region-cfa-shifted.fits', 16, 8, 1, ["BAYERPAT= 'RGGB    '", 'XBAYROFF=                    1', 'YBAYROFF=                    1']))
		await expectSameAsDetectionImage(plain.id)
		await expectSameAsDetectionImage(shifted.id)
		images.close(plain.id)
		images.close(shifted.id)
	})

	test('measures a mosaic without a trusted pattern as is', async () => {
		const info = await openFits(writeFits('region-cfa-unknown.fits', 16, 8, 1, ["BAYERPAT= 'XYZW    '"]))
		await expectSameAsDetectionImage(info.id)
		images.close(info.id)
	})

	test('converts integer samples to ADU', async () => {
		const info = await openFits(writeFits('region-adu.fits', 16, 8))
		const { image, conversion } = (await images.detectionRegion(info.id, { left: 3, top: 1, width: 2, height: 1 }))!

		expect(conversion).toEqual({ unit: 'adu', scale: 255, offset: 0, rescaled: false })
		expect(image.raw[0] * conversion.scale + conversion.offset).toBeCloseTo(((16 + 3) * 7) % 256, 3)
		images.close(info.id)
	})

	test('restores the scale of a source rescaled by the read', async () => {
		const { path, samples } = writeFloatFits('region-float.fits')
		const info = await openFits(path)
		const { image, conversion } = (await images.detectionRegion(info.id, { left: 2, top: 1, width: 3, height: 2 }))!

		expect(image.metadata.normalization).toBeDefined()
		expect(conversion).toMatchObject({ unit: 'source', rescaled: true })
		expect(image.raw[0] * conversion.scale + conversion.offset).toBeCloseTo(samples[16 + 2], 6)
		images.close(info.id)
	})

	test('reads a retained document closed meanwhile, and nothing once it is released', async () => {
		const info = await openFits(writeFits('region-retained.fits', 16, 8))
		const rect = { left: 0, top: 0, width: 2, height: 2 }

		images.retain(info.id)
		images.close(info.id)
		expect(await images.detectionRegion(info.id, rect)).toBeDefined()
		images.release(info.id)
		expect(await images.detectionRegion(info.id, rect)).toBeUndefined()
	})
})

describe('processing image', () => {
	test('is an owned full copy naming the trusted CFA pattern at the image origin', async () => {
		const info = await openFits(writeFits('processing-cfa.fits', 16, 8, 1, ["BAYERPAT= 'RGGB    '", 'XBAYROFF=                    1']))
		const first = (await images.processingImage(info.id))!
		const second = (await images.processingImage(info.id))!

		expect(info.cfa).toBe('GRBG')
		expect(first.metadata).toMatchObject({ width: 16, height: 8, channels: 1, bayer: 'GRBG' })
		expect(first.header.BAYERPAT).toBe('GRBG')
		expect(first.header.XBAYROFF).toBeUndefined()
		first.raw.fill(0)
		expect(second.raw.some((value) => value !== 0)).toBeTrue()
		images.close(info.id)
	})

	test('is adopted as a derived document whose name and history come from its provenance', async () => {
		const source = await openFits(writeFits('processing-adopt.fits', 16, 8, 3))
		const image = (await images.processingImage(source.id))!
		const steps = [{ id: 'flip', operation: { type: 'horizontalFlip' } }] as const

		const info = await images.adopt(image, { kind: 'processing', source: source.id, sourceName: 'processing-adopt.fits', steps, createdAt: '2026-10-27T00:00:00.000Z' })

		expect(info).toMatchObject({ origin: 'derived', name: 'processing-adopt — Processed', channels: 3, header: { BITPIX: -32, NAXIS3: 3 } })
		expect(String(info.header.HISTORY)).toContain('Processing 1/1: {"type":"horizontalFlip"}')
		expect(images.name(info.id)).toBe('processing-adopt — Processed')
		images.close(source.id)
		images.close(info.id)
	})
})
