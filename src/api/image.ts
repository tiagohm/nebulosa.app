import Elysia from 'elysia'
import fs from 'fs/promises'
import { declination, readFits, rightAscension } from 'nebulosa/src/fits'
import { adf, debayer, horizontalFlip, type Image, type ImageFormat, invert, readImageFromFits, scnr, stf, verticalFlip, type WriteImageToFormatOptions, writeImageToFormat } from 'nebulosa/src/image'
import { fileHandleSource } from 'nebulosa/src/io'
import os from 'os'
import { join } from 'path'
import type { JpegOptions, PngOptions, WebpOptions } from 'sharp'
import fovCameras from '../../data/cameras.json' with { type: 'json' }
import fovTelescopes from '../../data/telescopes.json' with { type: 'json' }
import type { ImageInfo, ImageTransformation, OpenImage } from './types'
import { X_IMAGE_INFO_HEADER } from './types'

// Image API

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

// Endpoint for opening and transforming images
// This endpoint processes FITS files, applies transformations, and returns image information
// It supports various transformations like debayering, flipping, SCNR, stretching, and inversion
export class ImageEndpoint {
	// Opens an image file, reads its FITS/XISF data, and applies transformations
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
							rightAscension: rightAscension(image.header),
							declination: declination(image.header),
						}

						return info
					}
				}
			}
		}

		return undefined
	}

	private transformImageAndSave(image: Image, path: string, format: ImageFormat, transformation: ImageTransformation) {
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

// Creates an instance of Elysia with image endpoints
export function image(image: ImageEndpoint) {
	const app = new Elysia({ prefix: '/image' })

	app.post('/open', async ({ body, status }) => {
		const info = await image.open(body as never)

		if (info) {
			return new Response(Bun.file(info.path), {
				headers: {
					[X_IMAGE_INFO_HEADER]: encodeURIComponent(JSON.stringify(info)),
				},
			})
		} else {
			return status(500)
		}
	})

	app.post('/analyze', () => {
		return image.analyze()
	})

	app.post('/annotate', () => {
		return image.annotate()
	})

	app.post('/coordinateInterpolation', () => {
		return image.coordinateInterpolation()
	})

	app.post('/statistics', () => {
		return image.statistics()
	})

	app.get('/fovCameras', fovCameras)
	app.get('/fovTelescopes', fovTelescopes)

	return app
}
