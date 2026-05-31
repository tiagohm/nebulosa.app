import { describe, expect, spyOn, test } from 'bun:test'
import type { Image } from 'nebulosa/src/image.types'
import type { DetectedStar } from 'nebulosa/src/star.detector'
import { ImageProcessor, type TransformedImageItem } from 'src/api/image'
import { starDetection as starDetectionEndpoints, StarDetectionHandler } from 'src/api/stardetection'
import { DEFAULT_STAR_DETECTION, type ImageTransformation, type StarDetection } from 'src/shared/types'
import { json } from './util'

const imageProcessor = new ImageProcessor()
const starDetectionHandler = new StarDetectionHandler(imageProcessor)
const endpoints = starDetectionEndpoints(starDetectionHandler)

function request(body: unknown) {
	return {
		url: 'http://localhost/stardetection',
		params: {},
		json: () => body,
	} as unknown as Bun.BunRequest
}

function starDetection(overrides: Partial<StarDetection> = {}): StarDetection {
	return {
		...structuredClone(DEFAULT_STAR_DETECTION),
		type: 'nebulosa',
		path: 'image.fit',
		...overrides,
	}
}

function transformedImage(path: string, image: Image, transformation: ImageTransformation | false): TransformedImageItem {
	return {
		buffered: { path },
		image,
		transformation,
		hash: 'synthetic-image',
	}
}

function syntheticStarImage(): Image {
	const width = 64
	const height = 64
	const raw = new Float32Array(width * height)

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const dx = x - 32
			const dy = y - 32
			raw[y * width + x] = 100 + 60000 * Math.exp(-(dx * dx + dy * dy) / 6)
		}
	}

	return {
		header: {},
		raw,
		metadata: {
			width,
			height,
			channels: 1,
			stride: width,
			pixelCount: width * height,
			strideInBytes: width * 4,
			pixelSizeInBytes: 4,
			bitpix: -32,
			bayer: undefined,
		},
	}
}

describe('star detection handler', () => {
	test('detect endpoint delegates to the handler and returns detected stars as json', async () => {
		const payload = starDetection({ path: 'endpoint.fit' })
		const stars: DetectedStar[] = [{ x: 10, y: 12, flux: 1200, hfd: 2.5, fwhm: 3.1, snr: 42 }]
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(() => Promise.resolve(stars))

		try {
			const result = await json<DetectedStar[]>(await endpoints['/stardetection'].POST(request(payload)))

			expect(result).toEqual(stars)
			expect(detect).toHaveBeenCalledWith(payload)
		} finally {
			detect.mockRestore()
		}
	})

	test('returns an empty star list and skips image storage when path is empty', async () => {
		const store = spyOn(imageProcessor, 'store')
		const transform = spyOn(imageProcessor, 'transform')

		try {
			const result = await starDetectionHandler.detect(starDetection({ path: '' }))

			expect(result).toEqual([])
			expect(store).not.toHaveBeenCalled()
			expect(transform).not.toHaveBeenCalled()
		} finally {
			store.mockRestore()
			transform.mockRestore()
		}
	})

	test('detects stars with nebulosa using stored image path and normalized max star count', async () => {
		const image = syntheticStarImage()
		const store = spyOn(imageProcessor, 'store').mockImplementation(() => Promise.resolve('stored.fit'))
		const transform = spyOn(imageProcessor, 'transform').mockImplementation((path, transformation) => Promise.resolve(transformedImage(path, image, transformation)))

		try {
			const result = await starDetectionHandler.detect(starDetection({ path: 'input.fit', maxStars: 0, minSNR: 0 }))
			const [, transformation] = transform.mock.calls[0]

			expect(store).toHaveBeenCalledWith('input.fit')
			expect(transform.mock.calls[0][0]).toBe('stored.fit')
			expect(transformation).not.toBeFalse()
			expect(transformation && transformation.stretch.auto).toBeFalse()
			expect(result).toHaveLength(1)
			expect(result[0].x).toBe(32)
			expect(result[0].y).toBe(32)
			expect(result[0].snr).toBeGreaterThan(0)
			expect(result[0].flux).toBeGreaterThan(0)
		} finally {
			store.mockRestore()
			transform.mockRestore()
		}
	})

	test('uses original path when image storage does not return a buffered path', async () => {
		const store = spyOn(imageProcessor, 'store').mockImplementation(() => Promise.resolve(undefined))
		const transform = spyOn(imageProcessor, 'transform').mockImplementation(() => Promise.resolve(undefined))

		try {
			const result = await starDetectionHandler.detect(starDetection({ path: 'fallback.fit' }))

			expect(result).toEqual([])
			expect(store).toHaveBeenCalledWith('fallback.fit')
			expect(transform.mock.calls[0][0]).toBe('fallback.fit')
		} finally {
			store.mockRestore()
			transform.mockRestore()
		}
	})

	test('returns an empty star list for unsupported detector type', async () => {
		const store = spyOn(imageProcessor, 'store').mockImplementation(() => Promise.resolve('stored.fit'))
		const transform = spyOn(imageProcessor, 'transform')

		try {
			const result = await starDetectionHandler.detect(
				starDetection({
					type: 'unsupported' as StarDetection['type'],
					path: 'unsupported.fit',
				}),
			)

			expect(result).toEqual([])
			expect(store).toHaveBeenCalledWith('unsupported.fit')
			expect(transform).not.toHaveBeenCalled()
		} finally {
			store.mockRestore()
			transform.mockRestore()
		}
	})

	test('returns an empty star list on failure', async () => {
		const error = new Error('transform failed')
		const store = spyOn(imageProcessor, 'store').mockImplementation(() => Promise.resolve('stored.fit'))
		const transform = spyOn(imageProcessor, 'transform').mockImplementation(() => Promise.reject(error))

		try {
			const result = await starDetectionHandler.detect(starDetection({ path: 'broken.fit' }))

			expect(result).toEqual([])
			expect(store).toHaveBeenCalledWith('broken.fit')
			expect(transform.mock.calls[0][0]).toBe('stored.fit')
		} finally {
			store.mockRestore()
			transform.mockRestore()
		}
	})
})
