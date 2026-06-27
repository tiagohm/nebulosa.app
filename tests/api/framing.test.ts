import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { HIPS2FITS_ALTERNATIVE_URL, HIPS2FITS_BASE_URL } from 'nebulosa/src/adapters/sky/hips2fits'
import { framing as framingEndpoints, FramingHandler } from 'src/api/framing'
import { ImageProcessor } from 'src/api/image'
import { DEFAULT_FRAMING, type Framing } from 'src/shared/types'
import { json, noContent, spyFetch } from './util'

type FetchRequest = {
	readonly url: URL
	readonly init?: RequestInit
}

const imageProcessor = new ImageProcessor()
const framingHandler = new FramingHandler(imageProcessor)
const endpoints = framingEndpoints(framingHandler)
const previousTmpDir = Bun.env.tmpDir
let tmpDir = ''

beforeAll(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), 'framing-'))
	Bun.env.tmpDir = tmpDir
})

afterAll(async () => {
	if (!previousTmpDir) {
		Bun.env.tmpDir = ''
	} else {
		Bun.env.tmpDir = previousTmpDir
	}

	await rm(tmpDir, { recursive: true, force: true })
})

function request(body: unknown) {
	return {
		url: 'http://localhost/framing',
		params: {},
		json: () => body,
	} as unknown as Bun.BunRequest
}

function framing(overrides: Partial<Framing> = {}): Framing {
	return { ...structuredClone(DEFAULT_FRAMING), id: 'framing', ...overrides }
}

function fetchResponse(body: BodyInit = new Uint8Array([1, 2, 3, 4]), status = 200) {
	return new Response(body, { status })
}

function mockSave() {
	return spyOn(imageProcessor, 'save').mockImplementation((buffer, path, camera) => ({ buffer, path, camera: camera?.id }))
}

function mockFetch(...responses: (Response | Error)[]) {
	const requests: FetchRequest[] = []
	let index = 0

	const fetch = spyFetch((input: URL | string, init) => {
		requests.push({ url: new URL(input), init })

		const response = responses[Math.min(index++, responses.length - 1)]
		if (response instanceof Error) return Promise.reject(response)
		return Promise.resolve(response.clone())
	})

	return { fetch, requests } as const
}

describe('framing handler', () => {
	test('frame endpoint delegates to the handler and returns generated path as json', async () => {
		const payload = framing({ id: 'endpoint-frame' })
		const frame = spyOn(framingHandler, 'frame').mockImplementation(() => Promise.resolve({ path: 'endpoint-frame.fit' }))

		try {
			const result = await json<{ path: string }>(await endpoints['/framing'].POST(request(payload)))

			expect(result).toEqual({ path: 'endpoint-frame.fit' })
			expect(frame).toHaveBeenCalledWith(payload)
		} finally {
			frame.mockRestore()
		}
	})

	test('fetches a framing FITS, saves it, and normalizes request parameters', async () => {
		const { fetch, requests } = mockFetch(fetchResponse())
		const save = mockSave()
		const payload = framing({
			id: 'M 42/frame',
			hipsSurvey: 'CDS/P/DSS2/color',
			rightAscension: '05 35 17.3',
			declination: '-05 23 28',
			width: 64.9,
			height: 32.1,
			focalLength: 0,
			pixelSize: 0,
			fov: 2.5,
			rotation: 45,
			projection: 'SIN',
			timeout: 1234,
		})

		try {
			const result = await framingHandler.frame(payload)
			const query = requests[0].url.searchParams

			expect(result).toEqual({ path: join(Bun.env.tmpDir, 'M_42_frame.fit') })
			expect(requests).toHaveLength(1)
			expect(requests[0].url.href.startsWith(`${HIPS2FITS_ALTERNATIVE_URL}hips-image-services/hips2fits`)).toBeTrue()
			expect(query.get('hips')).toBe('CDS/P/DSS2/color')
			expect(Number(query.get('ra'))).toBeCloseTo(83.822083, 5)
			expect(Number(query.get('dec'))).toBeCloseTo(-5.391111, 5)
			expect(query.get('width')).toBe('64')
			expect(query.get('height')).toBe('32')
			expect(query.get('projection')).toBe('SIN')
			expect(Number(query.get('fov'))).toBeCloseTo(2.5, 8)
			expect(Number(query.get('rotation_angle'))).toBeCloseTo(45, 8)
			expect(query.get('coordsys')).toBe('icrs')
			expect(query.get('format')).toBe('fits')
			expect(Buffer.compare(save.mock.calls[0][0], Buffer.from([1, 2, 3, 4]))).toBe(0)
			expect(save.mock.calls[0][1]).toBe(result!.path)
		} finally {
			fetch.mockRestore()
			save.mockRestore()
		}
	})

	test('falls back to the secondary hips2fits URL when the first request fails', async () => {
		const error = new Error('primary failed')
		const { fetch, requests } = mockFetch(error, fetchResponse(new Uint8Array([9, 8, 7])))
		const save = mockSave()
		const consoleError = spyOn(console, 'error').mockImplementation(() => {})

		try {
			const result = await framingHandler.frame(framing({ id: 'fallback' }))

			expect(result).toEqual({ path: join(Bun.env.tmpDir, 'fallback.fit') })
			expect(requests).toHaveLength(2)
			expect(requests[0].url.href.startsWith(`${HIPS2FITS_ALTERNATIVE_URL}hips-image-services/hips2fits`)).toBeTrue()
			expect(requests[1].url.href.startsWith(`${HIPS2FITS_BASE_URL}hips-image-services/hips2fits`)).toBeTrue()
			expect(consoleError).toHaveBeenCalledWith('failed to fetch framing image from hips2fits', HIPS2FITS_ALTERNATIVE_URL, error)
			expect(Buffer.compare(save.mock.calls[0][0], Buffer.from([9, 8, 7]))).toBe(0)
		} finally {
			fetch.mockRestore()
			save.mockRestore()
			consoleError.mockRestore()
		}
	})

	test('returns no content through endpoint and does not save when no service returns a FITS', async () => {
		const { fetch, requests } = mockFetch(fetchResponse(undefined, 500))
		const save = mockSave()

		try {
			await noContent(await endpoints['/framing'].POST(request(framing({ id: 'not-found' }))))

			expect(requests).toHaveLength(2)
			expect(save).not.toHaveBeenCalled()
		} finally {
			fetch.mockRestore()
			save.mockRestore()
		}
	})

	test('uses default dimensions, fov, rotation, and generated file id for invalid values', async () => {
		const { fetch, requests } = mockFetch(fetchResponse())
		const save = mockSave()

		try {
			const result = await framingHandler.frame(
				framing({
					id: '   ',
					rightAscension: 'invalid',
					declination: 'invalid',
					width: -1,
					height: Number.NaN,
					focalLength: 0,
					pixelSize: 0,
					fov: -5,
					rotation: Number.POSITIVE_INFINITY,
					timeout: Number.NaN,
				}),
			)
			const query = requests[0].url.searchParams

			expect(result!.path.startsWith(Bun.env.tmpDir)).toBeTrue()
			expect(basename(result!.path).endsWith('.fit')).toBeTrue()
			expect(basename(result!.path)).not.toBe('   .fit')
			expect(query.get('ra')).toBe('0')
			expect(query.get('dec')).toBe('0')
			expect(query.get('width')).toBe('800')
			expect(query.get('height')).toBe('600')
			expect(Number(query.get('fov'))).toBeCloseTo(1, 8)
			expect(Number(query.get('rotation_angle'))).toBeCloseTo(0, 8)
			expect(save.mock.calls[0][1]).toBe(result!.path)
		} finally {
			fetch.mockRestore()
			save.mockRestore()
		}
	})

	test('computes field of view from focal length and pixel size when both are valid', async () => {
		const { fetch, requests } = mockFetch(fetchResponse())
		const save = mockSave()

		try {
			await framingHandler.frame(
				framing({
					width: 100,
					height: 50,
					focalLength: 500,
					pixelSize: 3.5,
					fov: 5,
				}),
			)

			expect(Number(requests[0].url.searchParams.get('fov'))).toBeCloseTo(0.040107, 6)
		} finally {
			fetch.mockRestore()
			save.mockRestore()
		}
	})
})
