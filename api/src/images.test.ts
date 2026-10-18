import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cfaPattern, type DisplaySettings, imageAcquisition, type ImageInfo, images, precisionOf, type RenderResult } from './images'
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

function call(route: keyof typeof routes, method: 'POST' | 'DELETE', params: Record<string, string>, body?: unknown) {
	const handler = (routes[route] as Record<string, Handler>)[method]
	const req = Object.assign(new Request('http://localhost/', { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params })
	return Promise.resolve(handler(req))
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
		expect((await call('/api/images/:id', 'DELETE', { id })).status).toBe(404)
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
		const cards = ['SIMPLE  =                    T', 'BITPIX  =                  -64', 'NAXIS   =                    2', 'NAXIS1  =                   16', 'NAXIS2  =                    8', 'END']
		const header = Buffer.alloc(BLOCK, ' ')
		for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
		const data = Buffer.alloc(Math.ceil((16 * 8 * 8) / BLOCK) * BLOCK)
		for (let i = 0; i < 16 * 8; i++) data.writeDoubleBE(1000 + i * 250.5, i * 8)
		const path = join(root, 'float64.fits')
		writeFileSync(path, Buffer.concat([header, data]))

		const info = await openFits(path)
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
