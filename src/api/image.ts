import Elysia from 'elysia'
import fs from 'fs/promises'
import { eraPvstar } from 'nebulosa/src/erfa'
import { declinationKeyword, type Fits, observationDateKeyword, readFits, rightAscensionKeyword } from 'nebulosa/src/fits'
import { adf, debayer, horizontalFlip, type Image, type ImageFormat, invert, readImageFromFits, scnr, stf, verticalFlip, type WriteImageToFormatOptions, writeImageToFormat } from 'nebulosa/src/image'
import { bufferSource, fileHandleSource } from 'nebulosa/src/io'
import { spaceMotion, star } from 'nebulosa/src/star'
import { timeUnix } from 'nebulosa/src/time'
import { Wcs } from 'nebulosa/src/wcs'
import os from 'os'
import { join } from 'path'
import type { JpegOptions, PngOptions, WebpOptions } from 'sharp'
import fovCameras from '../../data/cameras.json' with { type: 'json' }
import nebulosa from '../../data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
import fovTelescopes from '../../data/telescopes.json' with { type: 'json' }
import type { AnnotatedSkyObject, AnnotateImage, CloseImage, ImageInfo, ImageTransformation, OpenImage } from '../shared/types'
import { X_IMAGE_INFO_HEADER, X_IMAGE_PATH_HEADER } from '../shared/types'
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

	async open(req: OpenImage) {
		if (!req.path) return undefined

		if (req.path?.startsWith(':')) {
			const [path, key] = decodePath(req.path)
			const buffer = this.cache.get(key)

			if (buffer) {
				const source = bufferSource(buffer)
				const fits = await readFits(source)

				if (fits) {
					return await this.readAndTransformImageFromFits(fits, req.transformation, path)
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
			return await this.readAndTransformImageFromFits(fits, req.transformation, req.path)
		}

		return undefined
	}

	async readAndTransformImageFromFits(fits: Fits, transformation: ImageTransformation, originalPath: string) {
		if (fits) {
			const image = await readImageFromFits(fits)

			if (image) {
				const id = Bun.randomUUIDv7()
				const { format } = transformation
				const path = join(process.platform === 'linux' ? '/dev/shm' : os.tmpdir(), `${id}.${format}`)
				const output = await this.transformImageAndSave(image, path, format, transformation)

				if (output) {
					const info: ImageInfo = {
						path,
						originalPath,
						width: output.width,
						height: output.height,
						mono: output.channels === 1,
						metadata: image.metadata,
						transformation,
						headers: image.header,
						rightAscension: rightAscensionKeyword(image.header, undefined),
						declination: declinationKeyword(image.header, undefined),
					}

					return info
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

	transformImageAndSave(image: Image, path: string, format: ImageFormat, transformation: ImageTransformation) {
		if (transformation.debayer) {
			image = debayer(image) ?? image
		}

		if (transformation.horizontalMirror) {
			image = horizontalFlip(image)
		}
		if (transformation.verticalMirror) {
			image = verticalFlip(image)
		}

		if (transformation.scnr.channel) {
			const { channel, amount, method } = transformation.scnr
			image = scnr(image, channel, amount, method)
		}

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

		if (transformation.invert) {
			image = invert(image)
		}

		const { adjustment, filter } = transformation

		const options: WriteImageToFormatOptions = {
			format: IMAGE_FORMAT_OPTIONS[format],
			brightness: adjustment.enabled ? adjustment.brightness : undefined,
			contrast: adjustment.enabled ? adjustment.contrast : undefined,
			normalize: adjustment.enabled ? adjustment.normalize : undefined,
			gamma: adjustment.enabled ? adjustment.gamma : undefined,
			saturation: adjustment.enabled ? adjustment.saturation : undefined,
			sharpen: filter.enabled && filter.sharpen,
			blur: filter.enabled && filter.blur,
			median: filter.enabled && filter.median,
		}

		return writeImageToFormat(image, path, format as never, options) // TODO: Handle FITS and XISF
	}

	save() {}

	analyze() {}

	annotate(req: AnnotateImage) {
		using wcs = new Wcs(req.solution)

		const res: AnnotatedSkyObject[] = []
		const { rightAscension, declination, radius, widthInPixels, heightInPixels } = req.solution
		const q = `SELECT d.id, d.type, d.rightAscension, d.declination, d.magnitude, d.pmRa, d.pmDec, d.distance, d.rv, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ORDER BY n.type ASC LIMIT 1) as name FROM dsos d WHERE (acos(sin(d.declination) * ${Math.sin(declination)} + cos(d.declination) * ${Math.cos(declination)} * cos(d.rightAscension - ${rightAscension})) <= ${radius}) ORDER BY d.magnitude DESC LIMIT 100`

		const date = observationDateKeyword(req.solution) || Date.now()
		const utc = timeUnix(date / 1000.0)

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

	coordinateInterpolation() {}

	statistics() {}

	close(req: CloseImage) {
		this.cache.delete(req.id)
	}
}

export function image(image: ImageManager) {
	const app = new Elysia({ prefix: '/image' })
		// Endpoints!
		.post('/open', async ({ body, set }) => {
			const info = await image.open(body as never)

			if (!info) return undefined

			set.headers[X_IMAGE_INFO_HEADER] = encodeURIComponent(JSON.stringify(info))
			set.headers[X_IMAGE_PATH_HEADER] = encodeURIComponent(info.path)

			return Bun.file(info.path)
		})
		.post('/close', ({ body }) => image.close(body as never))
		.post('/analyze', () => image.analyze())
		.post('/annotate', ({ body }) => image.annotate(body as never))
		.post('/coordinateInterpolation', () => image.coordinateInterpolation())
		.post('/statistics', () => image.statistics())
		.get('/fovCameras', () => fovCameras)
		.get('/fovTelescopes', () => fovTelescopes)

	return app
}
