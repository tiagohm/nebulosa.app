import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readImageFromPath, writeImageToFits, writeImageToXisf } from 'nebulosa/src/image'
import type { Image } from 'nebulosa/src/image.types'
import { bufferSink } from 'nebulosa/src/io'
import { ImageHandler, ImageProcessor, image as imageEndpoints } from 'src/api/image'
import { DEFAULT_IMAGE_TRANSFORMATION, X_IMAGE_INFO_HEADER, type AnnotateImage, type ImageHistogram, type ImageInfo, type ImageTransformation } from 'src/shared/types'
import { json, noContent } from './util'

const EMPTY_ANNOTATE_IMAGE: Omit<AnnotateImage, 'solution'> = {
	stars: false,
	dsos: false,
	useSimbad: false,
	minorPlanets: false,
	minorPlanetsMagnitudeLimit: 0,
	includeMinorPlanetsWithoutMagnitude: false,
}

const processor = new ImageProcessor()
const image = new ImageHandler(processor)
const previousTmpDir = Bun.env.tmpDir

let root = ''
let fitsPath = ''
let xisfPath = ''

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'image-'))
	Bun.env.tmpDir = root
	fitsPath = join(root, 'synthetic.fit')
	xisfPath = join(root, 'synthetic.xisf')

	await writeImageFixture(fitsPath, 'fits')
	await writeImageFixture(xisfPath, 'xisf')
})

afterAll(async () => {
	if (!previousTmpDir) {
		Bun.env.tmpDir = ''
	} else {
		Bun.env.tmpDir = previousTmpDir
	}

	await rm(root, { recursive: true, force: true })
})

function request(body: unknown) {
	return {
		url: 'http://localhost/image',
		params: {},
		json: () => body,
	} as unknown as Bun.BunRequest
}

function syntheticImage(): Image {
	const width = 8
	const height = 6
	const raw = new Float32Array(width * height)

	for (let i = 0; i < raw.length; i++) {
		raw[i] = i / (raw.length - 1)
	}

	return {
		header: {
			SIMPLE: true,
			BITPIX: -32,
			NAXIS: 2,
			NAXIS1: width,
			NAXIS2: height,
			OBJECT: 'SYNTHETIC',
			EXPTIME: 1.5,
		},
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

async function writeImageFixture(path: string, format: 'fits' | 'xisf') {
	const buffer = Buffer.alloc(1024 * 1024)
	const sink = bufferSink(buffer)
	const image = syntheticImage()

	if (format === 'fits') {
		await writeImageToFits(image, sink)
	} else {
		await writeImageToXisf(image, sink)
	}

	await Bun.write(path, buffer.subarray(0, sink.position))
}

function transformation(format: ImageTransformation['format']['type'] = 'jpeg'): ImageTransformation {
	return {
		...structuredClone(DEFAULT_IMAGE_TRANSFORMATION),
		enabled: false,
		format: {
			...structuredClone(DEFAULT_IMAGE_TRANSFORMATION.format),
			type: format,
		},
	}
}

function imageRequest(path: string, format: ImageTransformation['format']['type'] = 'jpeg') {
	return { path, transformation: transformation(format) }
}

function imageInfo(response: Response) {
	return JSON.parse(decodeURIComponent(response.headers.get(X_IMAGE_INFO_HEADER)!)) as ImageInfo
}

describe('annotate', () => {
	const solution = {
		'DATE-OBS': '2024-07-11T04:00:00.000',
		SIMPLE: true,
		BITPIX: 16,
		NAXIS: 2,
		NAXIS1: 1280,
		NAXIS2: 1024,
		WCSAXES: 2,
		CRPIX1: 640,
		CRPIX2: 512,
		CDELT1: -0.002282778583712,
		CDELT2: 0.002282778583712,
		CUNIT1: 'deg',
		CUNIT2: 'deg',
		CTYPE1: 'RA---TAN',
		CTYPE2: 'DEC--TAN',
		CRVAL1: 284.84583333333,
		CRVAL2: -29.661666666667,
		LONPOLE: 180,
		LATPOLE: -29.661666666667,
		RADESYS: 'ICRS',
		orientation: -Math.PI,
		scale: 0.000039842002379787396,
		rightAscension: 4.971497652253623,
		declination: -0.5176937449623905,
		width: 0.05099776304612787,
		height: 0.040798210436902294,
		radius: 0.03265450126155186,
		parity: 'FLIPPED',
		widthInPixels: 1280,
		heightInPixels: 1024,
	} as const

	test('stars & dsos', async () => {
		const res = await image.annotate({ solution, ...EMPTY_ANNOTATE_IMAGE, stars: true, dsos: true })

		expect(res).toHaveLength(8)
	})

	test('stars', async () => {
		const res = await image.annotate({ solution, ...EMPTY_ANNOTATE_IMAGE, stars: true })

		expect(res).toHaveLength(1)
	})

	test('dsos', async () => {
		const res = await image.annotate({ solution, ...EMPTY_ANNOTATE_IMAGE, dsos: true })

		expect(res).toHaveLength(7)
	})

	test.skip('minor planets', async () => {
		const res = await image.annotate({ solution, ...EMPTY_ANNOTATE_IMAGE, minorPlanets: true, minorPlanetsMagnitudeLimit: 10 })

		expect(res).toHaveLength(1)
		expect(res.filter((e) => e.name.includes('1 Ceres'))).toHaveLength(1)
	}, 120000)
})

describe('image handler', () => {
	test('reads small FITS and XISF test images with expected dimensions and headers', async () => {
		const fits = await readImageFromPath(fitsPath, 32)
		const xisf = await readImageFromPath(xisfPath, 32)

		expect(fits?.metadata.width).toBe(8)
		expect(fits?.metadata.height).toBe(6)
		expect(fits?.metadata.channels).toBe(1)
		expect(fits?.header.NAXIS1).toBe(8)
		expect(fits?.header.NAXIS2).toBe(6)
		expect(fits?.header.OBJECT).toBe('SYNTHETIC')
		expect(xisf?.metadata).toEqual(fits?.metadata)
		expect(xisf?.header.OBJECT).toBe('SYNTHETIC')
	})

	test('open endpoint exports JPEG bytes and image info header from FITS', async () => {
		const handler = new ImageHandler(new ImageProcessor())
		const endpoints = imageEndpoints(handler)
		const response = await endpoints['/image/open'].POST(request(imageRequest(fitsPath)))
		const output = Buffer.from(await response.arrayBuffer())
		const info = imageInfo(response)

		expect(response.status).toBe(200)
		expect(output[0]).toBe(0xff)
		expect(output[1]).toBe(0xd8)
		expect(info.path).toBe(fitsPath)
		expect(info.width).toBe(8)
		expect(info.height).toBe(6)
		expect(info.mono).toBeTrue()
		expect(info.metadata.width).toBe(8)
		expect(info.headers.OBJECT).toBe('SYNTHETIC')
		expect(info.hash).toBeString()
	})

	test('open endpoint propagates missing image read failures', () => {
		const handler = new ImageHandler(new ImageProcessor())
		const endpoints = imageEndpoints(handler)

		expect(endpoints['/image/open'].POST(request(imageRequest(join(root, 'missing.fit'))))).rejects.toThrow('ENOENT')
	})

	test('save endpoint exports FITS and XISF files that can be read back', async () => {
		const handler = new ImageHandler(new ImageProcessor())
		const endpoints = imageEndpoints(handler)
		const exportedFits = join(root, 'exported.fit')
		const exportedXisf = join(root, 'exported.xisf')

		await noContent(await endpoints['/image/save'].POST(request({ ...imageRequest(fitsPath, 'fits'), saveAt: exportedFits })))
		await noContent(await endpoints['/image/save'].POST(request({ ...imageRequest(fitsPath, 'xisf'), saveAt: exportedXisf })))

		const fits = await readImageFromPath(exportedFits, 32)
		const xisf = await readImageFromPath(exportedXisf, 32)

		expect(fits?.metadata.width).toBe(8)
		expect(fits?.metadata.height).toBe(6)
		expect(fits?.header.OBJECT).toBe('SYNTHETIC')
		expect(xisf?.metadata).toEqual(fits?.metadata)
		expect(xisf?.header.OBJECT).toBe('SYNTHETIC')
	})

	test('statistics endpoint returns histogram data for raw FITS pixels', async () => {
		const handler = new ImageHandler(new ImageProcessor())
		const endpoints = imageEndpoints(handler)
		const stats = await json<ImageHistogram[]>(await endpoints['/image/statistics'].POST(request({ ...imageRequest(fitsPath), bits: 8, transformed: false })))

		expect(stats).toHaveLength(1)
		expect(stats[0].count[0]).toBe(48)
		expect(stats[0].data).toHaveLength(256)
		expect(stats[0].minimum[0]).toBeCloseTo(0)
		expect(stats[0].maximum[0]).toBeCloseTo(1)
		expect(stats[0].mean).toBeCloseTo(0.5, 1)
	})

	test('processor buffers, stores, pings, and closes cached images', async () => {
		const handler = new ImageHandler(new ImageProcessor())
		const endpoints = imageEndpoints(handler)
		const source = await Bun.file(fitsPath).arrayBuffer()
		handler.imageProcessor.save(Buffer.from(source), 'buffered.fit')

		expect(handler.imageProcessor.get('buffered.fit')?.byteLength).toBeGreaterThan(0)

		const stored = await handler.imageProcessor.store('buffered.fit')
		expect(stored).toBe(join(root, 'buffered.fit'))
		expect((await readImageFromPath(stored!, 32))?.metadata.width).toBe(8)

		const opened = await endpoints['/image/open'].POST(request(imageRequest('buffered.fit')))
		const info = imageInfo(opened)

		await noContent(await endpoints['/image/ping'].POST(request({ path: 'buffered.fit', hash: info.hash })))
		await noContent(await endpoints['/image/close'].POST(request({ path: 'buffered.fit', hash: info.hash })))

		expect(handler.imageProcessor.get('buffered.fit')?.byteLength).toBeGreaterThan(0)
	})

	test('fov catalog endpoints return bundled camera and telescope data', async () => {
		const endpoints = imageEndpoints(new ImageHandler(new ImageProcessor()))
		const cameras = await json<unknown[]>(endpoints['/image/fovcameras'].GET)
		const telescopes = await json<unknown[]>(endpoints['/image/fovtelescopes'].GET)

		expect(cameras.length).toBeGreaterThan(0)
		expect(telescopes.length).toBeGreaterThan(0)
	})
})
