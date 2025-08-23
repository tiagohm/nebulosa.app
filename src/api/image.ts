import Elysia from 'elysia'
import fs from 'fs/promises'
import { declinationKeyword, readFits, rightAscensionKeyword } from 'nebulosa/src/fits'
import { adf, debayer, horizontalFlip, type Image, type ImageFormat, invert, readImageFromFits, scnr, stf, verticalFlip, type WriteImageToFormatOptions, writeImageToFormat } from 'nebulosa/src/image'
import { fileHandleSource } from 'nebulosa/src/io'
import os from 'os'
import { join } from 'path'
import type { JpegOptions, PngOptions, WebpOptions } from 'sharp'
import fovCameras from '../../data/cameras.json' with { type: 'json' }
import fovTelescopes from '../../data/telescopes.json' with { type: 'json' }
import type { ImageInfo, ImageTransformation, OpenImage } from '../shared/types'
import { X_IMAGE_INFO_HEADER } from '../shared/types'
import { badRequest, internalServerError, notFound } from './exceptions'

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
	async open(req: OpenImage) {
		if (req.path) {
			const handle = await fs.open(req.path)
			await using source = fileHandleSource(handle)
			const fits = await readFits(source)

			if (fits) {
				const image = await readImageFromFits(fits)

				if (image) {
					const id = Bun.MD5.hash(req.path, 'hex')
					const format = req.transformation.format
					const path = join(os.tmpdir(), `${id}.${format}`)
					const output = await this.transformImageAndSave(image, path, format, req.transformation)

					if (output) {
						const info: ImageInfo = {
							path,
							originalPath: req.path,
							width: output.width,
							height: output.height,
							mono: output.channels === 1,
							metadata: image.metadata,
							transformation: req.transformation,
							headers: image.header,
							rightAscension: rightAscensionKeyword(image.header),
							declination: declinationKeyword(image.header),
						}

						return info
					} else {
						throw internalServerError('Failed to generate image')
					}
				} else {
					throw internalServerError('Failed to read image from file')
				}
			} else {
				throw notFound('No image file found')
			}
		}

		throw badRequest('Image path is required')
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

	annotate() {}

	coordinateInterpolation() {}

	statistics() {}
}

export function image(image: ImageManager) {
	const app = new Elysia({ prefix: '/image' })
		// Endpoints!
		.post('/open', async ({ body }) => {
			const info = await image.open(body as never)
			const headers: HeadersInit = { [X_IMAGE_INFO_HEADER]: encodeURIComponent(JSON.stringify(info)) }
			return new Response(Bun.file(info.path), { headers })
		})
		.post('/analyze', () => image.analyze())
		.post('/annotate', () => image.annotate())
		.post('/coordinateInterpolation', () => image.coordinateInterpolation())
		.post('/statistics', () => image.statistics())
		.get('/fovCameras', fovCameras)
		.get('/fovTelescopes', fovTelescopes)

	return app
}
