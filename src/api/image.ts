import Elysia from 'elysia'
import fs from 'fs/promises'
import { eraPvstar } from 'nebulosa/src/erfa'
import { declinationKeyword, type Fits, observationDateKeyword, readFits, rightAscensionKeyword } from 'nebulosa/src/fits'
import { type Image, type ImageFormat, readImageFromFits, type WriteImageToFormatOptions, writeImageToFits, writeImageToFormat } from 'nebulosa/src/image'
import { adf } from 'nebulosa/src/image.computation'
import { debayer, horizontalFlip, invert, scnr, stf, verticalFlip } from 'nebulosa/src/image.transformation'
import { bufferSource, fileHandleSink, fileHandleSource } from 'nebulosa/src/io'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import { spaceMotion, star } from 'nebulosa/src/star'
import { timeUnix } from 'nebulosa/src/time'
import { Wcs } from 'nebulosa/src/wcs'
import { join } from 'path'
import type { JpegOptions, PngOptions, WebpOptions } from 'sharp'
import fovCameras from '../../data/cameras.json' with { type: 'json' }
import nebulosa from '../../data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
import fovTelescopes from '../../data/telescopes.json' with { type: 'json' }
import type { AnnotatedSkyObject, AnnotateImage, CloseImage, ImageCoordinateInterpolation, ImageInfo, ImageTransformation, OpenImage, SaveImage } from '../shared/types'
import { X_IMAGE_INFO_HEADER } from '../shared/types'
import { decodePath } from './camera'
import type { NotificationManager } from './notification'

const JPEG_OPTIONS: JpegOptions = {
	quality: 70, // Lower quality for faster processing
	progressive: true, // Enable progressive JPEG for better loading
	chromaSubsampling: '4:2:0', // Use 4:2:0 chroma subsampling for smaller file size
}

const PNG_OPTIONS: PngOptions = {
	effort: 1, // Low effort for faster processing
	quality: 100, // Maximum quality
	compressionLevel: 9, // Maximum compression level
	adaptiveFiltering: false, // Disable adaptive filtering for faster processing
	progressive: false, // Disable progressive PNG
}

const WEBP_OPTIONS: WebpOptions = {
	effort: 0, // Low effort for faster processing
	quality: 70, // Lower quality for faster processing
	lossless: false, // Use lossy compression for smaller file size
	nearLossless: false, // Disable near-lossless compression
}

const IMAGE_FORMAT_OPTIONS: Partial<Record<ImageFormat, WriteImageToFormatOptions['format']>> = {
	jpg: JPEG_OPTIONS,
	jpeg: JPEG_OPTIONS,
	webp: WEBP_OPTIONS,
	png: PNG_OPTIONS,
}

export class ImageManager {
	constructor(
		readonly cache: Map<string, Buffer>,
		readonly notification?: NotificationManager,
	) {}

	private readonly images = new Map<string, number>()

	async open(req: OpenImage, savePath?: string) {
		if (!req.path) return undefined

		if (req.path.startsWith(':')) {
			const [path, key] = decodePath(req.path)
			const buffer = this.cache.get(key)

			if (buffer) {
				const source = bufferSource(buffer)
				const fits = await readFits(source)

				if (fits) {
					return await this.readAndTransformImageFromFits(fits, req.transformation, path, savePath)
				}

				return undefined
			} else {
				req.path = path
			}
		}

		const handle = await fs.open(req.path)
		await using source = fileHandleSource(handle)
		const fits = await readFits(source)

		if (fits) {
			return await this.readAndTransformImageFromFits(fits, req.transformation, req.path, savePath)
		}

		return undefined
	}

	async readAndTransformImageFromFits(fits: Fits, transformation: ImageTransformation, realPath: string, savePath?: string) {
		if (fits) {
			const image = await readImageFromFits(fits)

			if (image) {
				const id = Bun.randomUUIDv7()
				const { format } = transformation
				const path = savePath ?? join(Bun.env.tmpDir, `${id}.${format}`)
				const output = await this.transformImageAndSave(image, path, format, transformation)

				if (output) {
					const info: ImageInfo = {
						path,
						realPath,
						width: output.width,
						height: output.height,
						mono: output.channels === 1,
						metadata: image.metadata,
						transformation,
						headers: image.header,
						rightAscension: rightAscensionKeyword(image.header, undefined),
						declination: declinationKeyword(image.header, undefined),
					}

					this.images.set(info.path, Date.now())

					return info
				} else if (savePath) {
					return undefined
				} else {
					this.notification?.send({ body: 'Failed to generate image', severity: 'error' })
				}
			} else {
				this.notification?.send({ body: 'Failed to read image from FITS', severity: 'error' })
			}
		} else {
			this.notification?.send({ body: 'No image FITS found', severity: 'error' })
		}
	}

	async transformImageAndSave(image: Image, path: string, format: ImageFormat, transformation: ImageTransformation) {
		if (transformation.enabled && transformation.debayer) {
			image = debayer(image) ?? image
		}

		if (transformation.enabled && transformation.horizontalMirror) {
			image = horizontalFlip(image)
		}
		if (transformation.enabled && transformation.verticalMirror) {
			image = verticalFlip(image)
		}

		if (transformation.enabled && transformation.scnr.channel) {
			const { channel, amount, method } = transformation.scnr
			image = scnr(image, channel, amount, method)
		}

		if (transformation.enabled) {
			if (transformation.stretch.auto) {
				const [midtone, shadow, highlight] = adf(image, undefined, transformation.stretch.meanBackground)

				image = stf(image, midtone, shadow, highlight)

				transformation.stretch.midtone = Math.trunc(midtone * 65536)
				transformation.stretch.shadow = Math.trunc(shadow * 65536)
				transformation.stretch.highlight = Math.trunc(highlight * 65536)
			} else {
				const { midtone, shadow, highlight } = transformation.stretch
				image = stf(image, midtone / 65536, shadow / 65536, highlight / 65536)
			}
		}

		if (transformation.enabled && transformation.invert) {
			image = invert(image)
		}

		// TODO: handle XISF format
		if (format === 'fits' || format === 'xisf') {
			const handle = await fs.open(path, 'w')
			await using sink = fileHandleSink(handle)
			await writeImageToFits(image, sink)
			return undefined
		}

		const { adjustment, filter } = transformation

		const hasAdjustment = transformation.enabled && adjustment.enabled
		const hasFilter = transformation.enabled && filter.enabled

		const options: WriteImageToFormatOptions = {
			format: IMAGE_FORMAT_OPTIONS[format],
			brightness: hasAdjustment ? adjustment.brightness : undefined,
			contrast: hasAdjustment ? adjustment.contrast : undefined,
			normalize: hasAdjustment ? adjustment.normalize : undefined,
			gamma: hasAdjustment ? adjustment.gamma : undefined,
			saturation: hasAdjustment ? adjustment.saturation : undefined,
			sharpen: hasFilter && filter.sharpen,
			blur: hasFilter && filter.blur,
			median: hasFilter && filter.median,
		}

		return writeImageToFormat(image, path, format, options)
	}

	save(req: SaveImage) {
		req.transformation.enabled = req.transformed
		return this.open(req, req.savePath)
	}

	annotate(req: AnnotateImage) {
		using wcs = new Wcs(req.solution)

		const res: AnnotatedSkyObject[] = []
		const { rightAscension, declination, radius, widthInPixels, heightInPixels } = req.solution
		const q = `SELECT d.id, d.type, d.rightAscension, d.declination, d.magnitude, d.pmRa, d.pmDec, d.distance, d.rv, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ORDER BY n.type ASC LIMIT 1) as name FROM dsos d WHERE (acos(sin(d.declination) * ${Math.sin(declination)} + cos(d.declination) * ${Math.cos(declination)} * cos(d.rightAscension - ${rightAscension})) <= ${radius}) ORDER BY d.magnitude DESC LIMIT 100`

		const date = observationDateKeyword(req.solution) || Date.now()
		const utc = timeUnix(date / 1000)

		for (const o of nebulosa.query<AnnotatedSkyObject, []>(q)) {
			const sa = star(o.rightAscension, o.declination, o.pmRa, o.pmDec, o.distance === 0 ? 0 : 1 / o.distance, o.rv)
			const sb = eraPvstar(...spaceMotion(sa, utc))

			if (sb) {
				const [x, y] = wcs.skyToPix(sb[0], sb[1])!

				if (x >= 0 && y >= 0 && x < widthInPixels && y < heightInPixels) {
					o.x = x
					o.y = y
					res.push(o)
				}
			}
		}

		return res
	}

	coordinateInterpolation(solution: PlateSolution): ImageCoordinateInterpolation {
		using wcs = new Wcs(solution)
		const { widthInPixels, heightInPixels } = solution

		const delta = 24
		const width = widthInPixels + (widthInPixels % delta === 0 ? 0 : delta - (widthInPixels % delta))
		const height = heightInPixels + (heightInPixels % delta === 0 ? 0 : delta - (heightInPixels % delta))

		const md = new Array<number>((width / 24 + 1) * (height / 24 + 1))
		const ma = new Array<number>(md.length)
		var n = 0

		for (let y = 0; y <= height; y += delta) {
			for (let x = 0; x <= width; x += delta, n++) {
				const [rightAscension, declination] = wcs.pixToSky(x, y)!
				ma[n] = rightAscension
				md[n] = declination
			}
		}

		return { ma, md, x0: 0, y0: 0, x1: width, y1: height, delta }
	}

	statistics() {}

	close(req: CloseImage) {
		this.cache.delete(req.id)
	}

	async cleanUp() {
		const now = Date.now()

		for (const [path, timestamp] of this.images) {
			if (now - timestamp >= 60000) {
				await fs.unlink(path)
				this.images.delete(path)
			}
		}
	}
}

export function image(image: ImageManager) {
	const app = new Elysia({ prefix: '/image' })
		// Endpoints!
		.post('/open', async ({ body, set }) => {
			const info = await image.open(body as never)

			if (!info) return undefined

			set.headers[X_IMAGE_INFO_HEADER] = encodeURIComponent(JSON.stringify(info))

			return Bun.file(info.path)
		})
		.post('/close', ({ body }) => image.close(body as never))
		.post('/save', ({ body }) => image.save(body as never))
		.post('/annotate', ({ body }) => image.annotate(body as never))
		.post('/coordinateinterpolation', ({ body }) => image.coordinateInterpolation(body as never))
		.post('/statistics', () => image.statistics())
		.get('/fovcameras', () => fovCameras)
		.get('/fovtelescopes', () => fovTelescopes)

	return app
}
