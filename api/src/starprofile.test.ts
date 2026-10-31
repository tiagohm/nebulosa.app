import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ApiError } from './http'
import { type ImageInfo, images } from './images'
import { routes } from './index'
import { MAX_QUEUED, StarProfileService } from './starprofile'
import type { StarProfileRequest, StarProfileResult } from './starprofile.analysis'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-starprofile-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

const BLOCK = 2880
const SIZE = 128
const STAR_X = 60
const STAR_Y = 50
const REQUEST: StarProfileRequest = { x: STAR_X + 2, y: STAR_Y - 1, model: 'moments', searchRadius: 8, maximumRadius: 32, minSNR: 5 }

// Writes an 8-bit FITS file of a sky of 20 with one star of peak 200 at (STAR_X, STAR_Y), and returns its path.
function writeFits(name: string) {
	const cards = ['SIMPLE  =                    T', 'BITPIX  =                    8', 'NAXIS   =                    2', `NAXIS1  = ${String(SIZE).padStart(20)}`, `NAXIS2  = ${String(SIZE).padStart(20)}`, 'END']
	const header = Buffer.alloc(BLOCK, ' ')
	for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
	const data = Buffer.alloc(Math.ceil((SIZE * SIZE) / BLOCK) * BLOCK)

	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			data[y * SIZE + x] = Math.round(20 + ((x * 7 + y * 13) % 3) + 200 * Math.exp(-((x - STAR_X) ** 2 + (y - STAR_Y) ** 2) / (2 * 1.5 ** 2)))
		}
	}

	const path = join(root, name)
	writeFileSync(path, Buffer.concat([header, data]))
	return path
}

// Opens a new FITS document.
function open(name: string): Promise<ImageInfo> {
	return images.open(writeFits(name))
}

// Posts a request to the route of a document.
function post(id: string, body: StarProfileRequest, signal?: AbortSignal) {
	const handler = (routes['/api/images/:id/star-profile'] as Record<string, (req: Request & { params: Record<string, string> }) => Promise<Response>>).POST
	return handler(Object.assign(new Request('http://localhost/', { method: 'POST', body: JSON.stringify(body), signal }), { params: { id } }))
}

test('the route measures the star near a point, in ADU, without keeping the image', async () => {
	const info = await open('route.fits')
	const discarded: string[] = []
	const unsubscribe = images.onDiscard((id) => discarded.push(id))

	try {
		const response = await post(info.id, REQUEST)
		const result = (await response.json()) as StarProfileResult

		expect(response.status).toBe(200)
		expect(result).toMatchObject({ status: 'measured', imageId: info.id, seed: { x: REQUEST.x, y: REQUEST.y }, conversion: { unit: 'adu', scale: 255 } })
		if (result.status !== 'measured') return
		expect(result.profile.x).toBeCloseTo(STAR_X, 0)
		expect(result.profile.y).toBeCloseTo(STAR_Y, 0)

		images.close(info.id)
		expect(discarded).toEqual([info.id])
	} finally {
		unsubscribe()
	}
})

test('the route answers noStar for the sky, and 404 for an image that is not open', async () => {
	const info = await open('sky.fits')
	const response = await post(info.id, { ...REQUEST, x: 110, y: 110 })

	expect(response.status).toBe(200)
	expect(await response.json()).toMatchObject({ status: 'noStar', reason: 'noPeak' })

	images.close(info.id)
	const missing = await post(info.id, REQUEST)
	expect(missing.status).toBe(404)
	expect(((await missing.json()) as ApiError).code).toBe('notFound')
})

test('a request beyond the queue is refused, and the others complete', async () => {
	const info = await open('queue.fits')
	const service = new StarProfileService(images)
	const outcomes = await Promise.all(Array.from({ length: MAX_QUEUED + 2 }, () => service.inspect(info.id, REQUEST)))

	expect(outcomes.filter(({ status }) => status === 'completed')).toHaveLength(MAX_QUEUED + 1)
	expect(outcomes.at(-1)?.status).toBe('queueFull')
	images.close(info.id)
})

test('an aborted request leaves the queue and its retention, and never touches another one', async () => {
	const info = await open('abort.fits')
	const service = new StarProfileService(images)
	const discarded: string[] = []
	const unsubscribe = images.onDiscard((id) => discarded.push(id))
	const controller = new AbortController()

	try {
		const first = service.inspect(info.id, REQUEST)
		const aborted = service.inspect(info.id, REQUEST, controller.signal)
		const last = service.inspect(info.id, REQUEST)
		controller.abort()

		expect(await aborted).toEqual({ status: 'cancelled' })
		expect((await first).status).toBe('completed')
		expect((await last).status).toBe('completed')

		images.close(info.id)
		expect(discarded).toEqual([info.id])
	} finally {
		unsubscribe()
	}
})

test('a request aborted on the worker drops its result and frees the turn', async () => {
	const info = await open('running.fits')
	const service = new StarProfileService(images)
	const controller = new AbortController()
	const running = service.inspect(info.id, REQUEST, controller.signal)
	const next = service.inspect(info.id, REQUEST)
	controller.abort()

	expect(await running).toEqual({ status: 'cancelled' })
	expect((await next).status).toBe('completed')
	images.close(info.id)
})

test('closing an image while a request waits lets it finish on the retained pixels', async () => {
	const info = await open('closed.fits')
	const service = new StarProfileService(images)
	const pending = service.inspect(info.id, REQUEST)
	images.close(info.id)

	expect((await pending).status).toBe('completed')
	expect((await service.inspect(info.id, REQUEST)).status).toBe('missing')
})
