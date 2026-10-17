import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ImageInfo, RenderResult } from './images'
import { routes } from './index'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-images-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

// Size of a FITS block, in bytes.
const BLOCK = 2880

// Writes an 8-bit grayscale FITS file with a gradient and returns its path.
function writeFits(name: string, width: number, height: number) {
	const cards = ['SIMPLE  =                    T', 'BITPIX  =                    8', 'NAXIS   =                    2', `NAXIS1  = ${String(width).padStart(20)}`, `NAXIS2  = ${String(height).padStart(20)}`, "OBJECT  = 'M31     '", 'END']
	const header = Buffer.alloc(BLOCK, ' ')
	for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
	const data = Buffer.alloc(Math.ceil((width * height) / BLOCK) * BLOCK)
	for (let i = 0; i < width * height; i++) data[i] = (i * 7) % 256
	const path = join(root, name)
	writeFileSync(path, Buffer.concat([header, data]))
	return path
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

		const auto = await call('/api/images/:id/render', 'POST', { id }, { stretch: 'auto' })
		const result = JSON.parse(auto.headers.get('X-Image-Render')!) as RenderResult
		const jpeg = new Uint8Array(await auto.arrayBuffer())

		expect(auto.status).toBe(200)
		expect(auto.headers.get('Content-Type')).toBe('image/jpeg')
		expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8])
		for (const value of Object.values(result.stretch)) expect(value).toBeWithin(0, 1.000001)

		const manual = await call('/api/images/:id/render', 'POST', { id }, { stretch: { midtone: 0.25, shadow: 0.1, highlight: 0.9 } })
		expect(JSON.parse(manual.headers.get('X-Image-Render')!)).toEqual({ stretch: { midtone: 0.25, shadow: 0.1, highlight: 0.9 } })

		expect((await call('/api/images/:id', 'DELETE', { id })).status).toBe(204)
		expect((await call('/api/images/:id/render', 'POST', { id }, { stretch: 'auto' })).status).toBe(404)
		expect((await call('/api/images/:id', 'DELETE', { id })).status).toBe(404)
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
