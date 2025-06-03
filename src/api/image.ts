import Elysia from 'elysia'
import fs from 'fs/promises'
import { readFits } from 'nebulosa/src/fits'
import { type Image, type ImageFormat, type WriteImageToFormatOptions, adf, debayer, horizontalFlip, invert, readImageFromFits, scnr, stf, verticalFlip, writeImageToFormat } from 'nebulosa/src/image'
import { fileHandleSource } from 'nebulosa/src/io'
import os from 'os'
import { join } from 'path'
import fovCameras from '../../data/cameras.json' with { type: 'json' }
import fovTelescopes from '../../data/telescopes.json' with { type: 'json' }
import type { ImageInfo, ImageTransformation, OpenImage } from './types'
import { X_IMAGE_INFO_HEADER } from './types'

export class ImageEndpoint {
	async open(req: OpenImage) {
		if (req.path) {
			const handle = await fs.open(req.path)
			await using source = fileHandleSource(handle)
			const fits = await readFits(source)

			if (fits) {
				const image = await readImageFromFits(fits)

				if (image) {
					const id = Bun.MD5.hash(req.path, 'hex')
					const format = req.transformation.useJPEG ? 'jpeg' : 'png'
					const path = join(os.tmpdir(), `${id}.${format}`)
					const output = await this.transformImageAndSave(image, path, format, req.transformation)

					if (output) {
						const info: ImageInfo = {
							path,
							width: output.width,
							height: output.height,
							mono: output.channels === 1,
							metatada: image.metadata,
							transformation: req.transformation,
							headers: image.header,
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

			transformation.stretch.midtone = midtone * 65536
			transformation.stretch.shadow = shadow * 65536
			transformation.stretch.highlight = highlight * 65536
		} else {
			const { midtone, shadow, highlight } = transformation.stretch
			image = stf(image, midtone / 65536, shadow / 65536, highlight / 65536)
		}

		if (transformation.invert) {
			image = invert(image)
		}

		const { adjustment } = transformation

		const options: WriteImageToFormatOptions = {
			format: format === 'jpeg' ? { quality: 70, chromaSubsampling: '4:4:4' } : format === 'png' ? { effort: 1 } : undefined,
			brightness: adjustment.enabled ? adjustment.brightness : undefined,
			normalize: adjustment.enabled ? adjustment.normalize : undefined,
			gamma: adjustment.enabled ? adjustment.gamma : undefined,
			saturation: adjustment.enabled ? adjustment.saturation : undefined,
		}

		return writeImageToFormat(image, path, format as never, options) // TODO: Handle FITS and XISF
	}

	save() {}

	analyze() {}

	annotate() {}

	coordinateInterpolation() {}

	statistics() {}
}

export function image(image: ImageEndpoint) {
	const app = new Elysia({ prefix: '/image' })

	app.post('/open', async ({ body, status }) => {
		const info = await image.open(body as never)

		if (info) {
			return new Response(Bun.file(info.path), {
				headers: {
					[X_IMAGE_INFO_HEADER]: JSON.stringify(info),
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
