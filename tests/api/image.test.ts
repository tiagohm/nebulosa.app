import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Wcs } from 'nebulosa/src/bindings/astrometry/libwcs'
import { PI } from 'nebulosa/src/core/constants'
import { readImageFromPath, writeImageToFits, writeImageToXisf } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { bufferSink } from 'nebulosa/src/io/io'
import { sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import { normalizeAngle } from 'nebulosa/src/math/units/angle'
import { ImageHandler, effectiveCrosshairAngularSpacing, image as imageEndpoints } from 'src/api/image'
import { ImageProcessor } from 'src/api/image.processor'
import { DEFAULT_IMAGE_TRANSFORMATION, X_IMAGE_INFO_HEADER } from '#/image'
import type { ImageInfo, ImageTransformation } from '#/image'
import type { AnnotateImage } from '#/image.annotation'
import type { ImageCoordinateGrid } from '#/image.coordinategrid'
import type { ImageCrosshairProjection } from '#/image.crosshair'
import type { ImageHistogram } from '#/image.statistics'
import { json, noContent } from './util'

const EMPTY_ANNOTATE_IMAGE: Omit<AnnotateImage, 'solution'> = {
	stars: false,
	dsos: false,
	useSimbad: false,
	minorPlanets: false,
	minorPlanetsMagnitudeLimit: 0,
	includeMinorPlanetsWithoutMagnitude: false,
}

const SOLVED_IMAGE_SOLUTION = {
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

function readyCrosshairProjection(projection: ImageCrosshairProjection) {
	expect(projection.status).toBe('ready')
	if (projection.status !== 'ready') throw new Error('expected ready crosshair projection')
	return projection
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

function expectCoordinateGrid(grid: ImageCoordinateGrid) {
	expect(grid.lines.some((line) => line.axis === 'rightAscension')).toBeTrue()
	expect(grid.lines.some((line) => line.axis === 'declination')).toBeTrue()
	expect(grid.lines.some((line) => line.axis === 'rightAscension' && line.labels?.some((label) => label.y === 48))).toBeTrue()
	expect(grid.lines.some((line) => line.axis === 'declination' && line.labels?.some((label) => label.x === 48))).toBeTrue()

	function isOnFrame(x: number, y: number) {
		const epsilon = 1e-6
		return Math.abs(x) <= epsilon || Math.abs(y) <= epsilon || Math.abs(x - SOLVED_IMAGE_SOLUTION.widthInPixels) <= epsilon || Math.abs(y - SOLVED_IMAGE_SOLUTION.heightInPixels) <= epsilon
	}

	for (const line of grid.lines) {
		expect(line.points.length).toBeGreaterThanOrEqual(2)
		expect(line.labels?.length).toBeGreaterThanOrEqual(2)
		expect(Number.isFinite(line.value)).toBeTrue()
		const first = line.points[0]
		const last = line.points.at(-1)!

		for (const point of line.points) {
			expect(Number.isFinite(point.x)).toBeTrue()
			expect(Number.isFinite(point.y)).toBeTrue()
			expect(point.x).toBeGreaterThanOrEqual(0)
			expect(point.y).toBeGreaterThanOrEqual(0)
			expect(point.x).toBeLessThanOrEqual(SOLVED_IMAGE_SOLUTION.widthInPixels)
			expect(point.y).toBeLessThanOrEqual(SOLVED_IMAGE_SOLUTION.heightInPixels)
		}

		expect(isOnFrame(first.x, first.y)).toBeTrue()
		expect(isOnFrame(last.x, last.y)).toBeTrue()

		for (const label of line.labels ?? []) {
			expect(Number.isFinite(label.x)).toBeTrue()
			expect(Number.isFinite(label.y)).toBeTrue()
			expect(label.x).toBeGreaterThanOrEqual(48)
			expect(label.y).toBeGreaterThanOrEqual(48)
			expect(label.x).toBeLessThanOrEqual(SOLVED_IMAGE_SOLUTION.widthInPixels - 48)
			expect(label.y).toBeLessThanOrEqual(SOLVED_IMAGE_SOLUTION.heightInPixels - 48)
		}
	}
}

describe('annotate', () => {
	test('stars & dsos', async () => {
		const res = await image.annotate({ solution: SOLVED_IMAGE_SOLUTION, ...EMPTY_ANNOTATE_IMAGE, stars: true, dsos: true })

		expect(res).toHaveLength(8)
	})

	test('stars', async () => {
		const res = await image.annotate({ solution: SOLVED_IMAGE_SOLUTION, ...EMPTY_ANNOTATE_IMAGE, stars: true })

		expect(res).toHaveLength(1)
	})

	test('dsos', async () => {
		const res = await image.annotate({ solution: SOLVED_IMAGE_SOLUTION, ...EMPTY_ANNOTATE_IMAGE, dsos: true })

		expect(res).toHaveLength(7)
	})

	test.skip('minor planets', async () => {
		const res = await image.annotate({ solution: SOLVED_IMAGE_SOLUTION, ...EMPTY_ANNOTATE_IMAGE, minorPlanets: true, minorPlanetsMagnitudeLimit: 10 })

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
	})

	test('open endpoint propagates missing image read failures', () => {
		const handler = new ImageHandler(new ImageProcessor())
		const endpoints = imageEndpoints(handler)

		expect(endpoints['/image/open'].POST(request(imageRequest(join(root, 'missing.fit'))))).rejects.toThrow('ENOENT')
	})

	test('coordinate grid returns drawable RA and DEC line segments', () => {
		const handler = new ImageHandler(new ImageProcessor())
		const grid = handler.coordinateGrid(SOLVED_IMAGE_SOLUTION)

		expectCoordinateGrid(grid)
	})

	test('coordinate grid endpoint serializes drawable RA and DEC line segments', async () => {
		const handler = new ImageHandler(new ImageProcessor())
		const endpoints = imageEndpoints(handler)
		const grid = await json<ImageCoordinateGrid>(await endpoints['/image/coordinategrid'].POST(request(SOLVED_IMAGE_SOLUTION)))

		expectCoordinateGrid(grid)
	})

	test('crosshair projection converts the center and produces angular bullseye geometry', () => {
		const handler = new ImageHandler(new ImageProcessor())
		const projection = readyCrosshairProjection(
			handler.crosshairProjection({
				solution: SOLVED_IMAGE_SOLUTION,
				anchor: { space: 'image', point: { x: 640, y: 512 } },
				preset: 'bullseye',
				angularSpacing: { automatic: true, value: 0 },
			}),
		)

		expect(projection.center.x).toBeCloseTo(640, 6)
		expect(projection.center.y).toBeCloseTo(512, 6)
		expect(projection.center.rightAscension).toBeCloseTo(SOLVED_IMAGE_SOLUTION.rightAscension, 5)
		expect(projection.center.declination).toBeCloseTo(SOLVED_IMAGE_SOLUTION.declination, 5)
		expect(projection.center.inside).toBeTrue()
		expect(projection.axes).toHaveLength(4)
		expect(projection.rings).toHaveLength(3)
		expect(projection.ringIntersections).toHaveLength(3)
		expect(projection.cardinals).toHaveLength(4)
		expect(Math.hypot(projection.directions.north.x, projection.directions.north.y)).toBeCloseTo(1, 12)
		expect(Math.hypot(projection.directions.east.x, projection.directions.east.y)).toBeCloseTo(1, 12)

		using wcs = new Wcs(SOLVED_IMAGE_SOLUTION)
		for (let index = 0; index < projection.rings.length; index++) {
			const point = projection.rings[index][0]
			const sky = point && wcs.pixToSky(point.x, point.y)
			expect(sky).toBeDefined()
			if (sky) expect(sphericalSeparation(projection.center.rightAscension, projection.center.declination, sky[0], sky[1])).toBeCloseTo(projection.spacing! * 2 ** index, 5)

			const intersection = projection.ringIntersections[index]
			expect(intersection?.radius).toBeCloseTo(projection.spacing! * 2 ** index, 12)
			if (intersection) {
				const dx = intersection.x - projection.center.x
				const dy = intersection.y - projection.center.y
				expect(dx * projection.directions.north.x + dy * projection.directions.north.y).toBeLessThan(0)
			}
		}
	})

	test('crosshair projection uses a 1-2-5 automatic step and leaves axis clipping to the SVG', () => {
		const handler = new ImageHandler(new ImageProcessor())
		const request = {
			solution: SOLVED_IMAGE_SOLUTION,
			anchor: { space: 'sky' as const, coordinate: { rightAscension: SOLVED_IMAGE_SOLUTION.rightAscension, declination: SOLVED_IMAGE_SOLUTION.declination } },
			angularSpacing: { automatic: true, value: 0 },
		}
		const projection = readyCrosshairProjection(handler.crosshairProjection({ ...request, preset: 'crosshair' }))
		const spacing = effectiveCrosshairAngularSpacing(SOLVED_IMAGE_SOLUTION, true, 0)
		const degrees = (spacing * 180) / PI
		const scale = 10 ** Math.floor(Math.log10(degrees))

		expect([1, 2, 5]).toContain(Math.round((degrees / scale) * 1e12) / 1e12)
		expect(projection.spacing).toBe(spacing)
		expect(projection.axes).toHaveLength(4)
		expect(projection.ringIntersections).toHaveLength(0)
		expect(projection.axes.every((axis) => axis[0] !== undefined && Math.abs(axis[0].x - projection.center.x) < 1e-6 && Math.abs(axis[0].y - projection.center.y) < 1e-6)).toBeTrue()
		expect(projection.axes.some((axis) => axis.some((point) => point.x < 0 || point.y < 0 || point.x > projection.width || point.y > projection.height))).toBeTrue()
	})

	test('crosshair north/east directions follow WCS parity', () => {
		const handler = new ImageHandler(new ImageProcessor())
		const flipped = readyCrosshairProjection(handler.crosshairProjection({ solution: SOLVED_IMAGE_SOLUTION, anchor: { space: 'image', point: { x: 640, y: 512 } }, preset: 'crosshair' }))
		const normalSolution = { ...SOLVED_IMAGE_SOLUTION, CDELT1: Math.abs(SOLVED_IMAGE_SOLUTION.CDELT1), parity: 'NORMAL' as const }
		const normal = readyCrosshairProjection(handler.crosshairProjection({ solution: normalSolution, anchor: { space: 'image', point: { x: 640, y: 512 } }, preset: 'crosshair' }))
		const flippedHandedness = flipped.directions.east.x * flipped.directions.north.y - flipped.directions.east.y * flipped.directions.north.x
		const normalHandedness = normal.directions.east.x * normal.directions.north.y - normal.directions.east.y * normal.directions.north.x

		expect(Math.sign(flippedHandedness)).toBe(-Math.sign(normalHandedness))
	})

	test('crosshair projection reports outside and unprojectable celestial centers', () => {
		const handler = new ImageHandler(new ImageProcessor())
		const outside = readyCrosshairProjection(
			handler.crosshairProjection({
				solution: SOLVED_IMAGE_SOLUTION,
				anchor: { space: 'image', point: { x: -100, y: -100 } },
				preset: 'crosshair',
			}),
		)
		const unprojectable = handler.crosshairProjection({
			solution: SOLVED_IMAGE_SOLUTION,
			anchor: { space: 'sky', coordinate: { rightAscension: normalizeAngle(SOLVED_IMAGE_SOLUTION.rightAscension + PI), declination: -SOLVED_IMAGE_SOLUTION.declination } },
			preset: 'crosshair',
		})

		expect(outside.center.inside).toBeFalse()
		expect(unprojectable.status).toBe('unprojectable')
	})

	test('crosshair projection endpoint validates and serializes requests', async () => {
		const endpoints = imageEndpoints(new ImageHandler(new ImageProcessor()))
		expect(() => endpoints['/image/crosshairprojection'].POST(request({ preset: 'bullseye' }))).toThrow()
		const valid = await endpoints['/image/crosshairprojection'].POST(request({ solution: SOLVED_IMAGE_SOLUTION, anchor: { space: 'image', point: { x: 640, y: 512 } }, preset: 'crosshair' }))

		expect(readyCrosshairProjection(await json<ImageCrosshairProjection>(valid)).center.inside).toBeTrue()
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

		expect(imageInfo(opened).width).toBe(8)

		await noContent(await endpoints['/image/ping'].POST(request({ path: 'buffered.fit' })))

		expect(handler.imageProcessor.get('buffered.fit')?.byteLength).toBeGreaterThan(0)

		// Closing releases the payload, which for a frame that only exists in memory means losing it
		await noContent(await endpoints['/image/close'].POST(request({ path: 'buffered.fit' })))

		expect(handler.imageProcessor.get('buffered.fit')).toBeUndefined()
	})

	test('processor reuses the transformed frame when the request echoes the computed stretch', async () => {
		const processor = new ImageProcessor()
		const transformation = structuredClone(DEFAULT_IMAGE_TRANSFORMATION)
		const first = await processor.transform(fitsPath, transformation)

		expect(first).toBeDefined()
		expect(transformation.stretch.auto).toBeTrue()

		// The browser sends back the levels the automatic stretch computed, so an equivalent request is
		// never identical to the previous one
		const echoed = structuredClone(transformation)
		expect(await processor.transform(fitsPath, echoed)).toBe(first)

		// A disabled transformation and no transformation at all produce the same frame
		const untransformed = await processor.transform(fitsPath, false)

		expect(untransformed).toBeDefined()
		expect(untransformed).not.toBe(first!)
		expect(await processor.transform(fitsPath, { ...echoed, enabled: false })).toBe(untransformed)

		// A field that reaches the pipeline still separates them
		expect(await processor.transform(fitsPath, { ...echoed, invert: true })).not.toBe(first!)
	})

	test('processor ignores fields the pipeline never reads', async () => {
		const processor = new ImageProcessor()
		const transformation = structuredClone(DEFAULT_IMAGE_TRANSFORMATION)
		const first = await processor.transform(fitsPath, transformation)

		expect(first).toBeDefined()
		expect(transformation.filter.enabled).toBeFalse()

		const ignored = structuredClone(transformation)
		ignored.filter.blur.size = 9
		ignored.calibration.dark.path = 'unused.fit'
		ignored.format.jpeg.quality = 10

		expect(await processor.transform(fitsPath, ignored)).toBe(first)
	})

	test('processor opens a frame its producer already decoded', async () => {
		const handler = new ImageHandler(new ImageProcessor())
		const endpoints = imageEndpoints(handler)
		const decoded = (await readImageFromPath(fitsPath, 32))!
		const path = join(root, 'decoded.fit')

		handler.imageProcessor.saveImage(decoded, path)
		// The producer keeps its own instance and may reuse it on the next frame, so the buffered copy must
		// be independent of it.
		decoded.raw.fill(0)

		const opened = await endpoints['/image/open'].POST(request(imageRequest(path)))
		const info = imageInfo(opened)

		expect(info.width).toBe(8)
		expect(info.height).toBe(6)
		expect(await Bun.file(path).exists()).toBeFalse()

		const stats = await json<ImageHistogram[]>(await endpoints['/image/statistics'].POST(request({ ...imageRequest(path), bits: 8, transformed: false })))

		expect(stats[0].mean).toBeCloseTo(0.5, 1)
	})

	test('fov catalog endpoints return bundled camera and telescope data', async () => {
		const endpoints = imageEndpoints(new ImageHandler(new ImageProcessor()))
		const cameras = await json<unknown[]>(endpoints['/image/fovcameras'].GET)
		const telescopes = await json<unknown[]>(endpoints['/image/fovtelescopes'].GET)

		expect(cameras.length).toBeGreaterThan(0)
		expect(telescopes.length).toBeGreaterThan(0)
	})
})
