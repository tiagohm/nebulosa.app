import cron from '@elysiajs/cron'
import Elysia from 'elysia'
import fs from 'fs/promises'
import { eraPvstar } from 'nebulosa/src/erfa'
import { declinationKeyword, observationDateKeyword, rightAscensionKeyword } from 'nebulosa/src/fits'
import { readImageFromBuffer, readImageFromPath, writeImageToFits, writeImageToFormat } from 'nebulosa/src/image'
import { adf, histogram } from 'nebulosa/src/image.computation'
import { blur, brightness, contrast, debayer, gamma, gaussianBlur, horizontalFlip, invert, mean, saturation, scnr, sharpen, stf, verticalFlip } from 'nebulosa/src/image.transformation'
import type { Image } from 'nebulosa/src/image.types'
import { fileHandleSink } from 'nebulosa/src/io'
import { type PlateSolution, plateSolutionFrom } from 'nebulosa/src/platesolver'
import { spaceMotion, star } from 'nebulosa/src/star'
import { timeUnix } from 'nebulosa/src/time'
import { Wcs } from 'nebulosa/src/wcs'
import fovCameras from '../../data/cameras.json' with { type: 'json' }
import nebulosa from '../../data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
import fovTelescopes from '../../data/telescopes.json' with { type: 'json' }
import type { AnnotatedSkyObject, AnnotateImage, CloseImage, ImageAdjustment, ImageCoordinateInterpolation, ImageFilter, ImageHistogram, ImageInfo, ImageScnr, ImageStretch, ImageTransformation, OpenImage, SaveImage, StatisticImage } from '../shared/types'
import { X_IMAGE_INFO_HEADER } from '../shared/types'
import type { NotificationHandler } from './notification'

export interface BufferedImageItem {
	readonly buffer?: Buffer
	readonly path: string
	readonly camera?: string
}

export interface TransformedImageItem {
	readonly buffered: BufferedImageItem
	readonly image: Image
	readonly transformation: ImageTransformation
	readonly hash: string
}

export interface ExportedImageItem {
	readonly transformed: TransformedImageItem
	readonly output?: Buffer
	readonly info?: ImageInfo
	readonly hash: string
}

export interface ImageProcessorItem<T> {
	date: number
	readonly item: T
}

const DEFAULT_IMAGE_EXPIRES_IN = 60000

export class ImageProcessor {
	private readonly buffered = new Map<string, ImageProcessorItem<BufferedImageItem>>()
	private readonly transformed = new Map<string, ImageProcessorItem<TransformedImageItem>>()
	private readonly exported = new Map<string, ImageProcessorItem<ExportedImageItem>>()

	save(buffer: Buffer, path: string, camera?: string) {
		// Avoid double buffering
		const canBuffer = process.platform !== 'linux' || !path.startsWith('/dev/shm/')

		if (camera) {
			// Delete existing image for the camera
			for (const [key, item] of this.transformed) item.item.buffered.camera === camera && this.transformed.delete(key)
			for (const [key, item] of this.exported) item.item.transformed.buffered.camera === camera && this.exported.delete(key)
			for (const [key, item] of this.buffered) item.item.camera === camera && this.buffered.delete(key)
		} else {
			// Delete existing image for the (framing) path
			// Framing images is saved on temp directory and it will be unlinked before the process exit!
			for (const [key, item] of this.transformed) item.item.buffered.path === path && this.transformed.delete(key)
			for (const [key, item] of this.exported) item.item.transformed.buffered.path === path && this.exported.delete(key)
		}

		// Store the buffer
		let item: BufferedImageItem

		if (canBuffer) {
			item = { buffer, path, camera }
			this.buffered.set(path, { date: Date.now(), item })
		} else {
			item = { buffer: Buffer.allocUnsafe(0), path, camera }
			this.buffered.set(path, { date: Date.now(), item })
		}

		console.info('image at', path, 'was buffered:', item.buffer?.byteLength)

		return item
	}

	async transform(path: string, transformation: ImageTransformation, camera?: string) {
		// Compute the hash for the transformation
		const hash = this.computeTransformHash(path, transformation)
		let item = this.transformed.get(hash)?.item

		if (item) {
			this.transformed.set(hash, { date: Date.now(), item })
			console.info('reusing transformed image at', path)
			return item
		}

		// Read from the buffered or directly from the path
		const buffered = this.buffered.get(path)?.item

		let image: Image | undefined

		if (buffered?.buffer?.byteLength) {
			image = await readImageFromBuffer(buffered.buffer)
		} else {
			image = await readImageFromPath(path)
		}

		if (!image) {
			console.warn('failed to open image at', path)
			return undefined
		}

		image = this.applyTransformation(image, transformation)
		item = { buffered: buffered ?? { path, camera }, image, transformation, hash }
		this.transformed.set(hash, { date: Date.now(), item })
		console.info('image at', path, 'was transformed:', item.image.raw.byteLength)
		return item
	}

	private applyTransformation(image: Image, transformation: ImageTransformation) {
		if (!transformation.enabled) return image

		if (transformation.debayer) image = debayer(image) ?? image
		if (transformation.horizontalMirror) image = horizontalFlip(image)
		if (transformation.verticalMirror) image = verticalFlip(image)

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

		if (transformation.adjustment.enabled) {
			if (transformation.adjustment.brightness.value !== 1) image = brightness(image, transformation.adjustment.brightness.value)
			if (transformation.adjustment.contrast.value !== 1) image = contrast(image, transformation.adjustment.contrast.value)
			if (transformation.adjustment.gamma.value > 1) image = gamma(image, transformation.adjustment.gamma.value)
			if (transformation.adjustment.saturation.value !== 1) image = saturation(image, transformation.adjustment.saturation.value, transformation.adjustment.saturation.channel)
		}

		if (transformation.filter.enabled) {
			if (transformation.filter.type === 'sharpen') image = sharpen(image)
			else if (transformation.filter.type === 'blur') image = blur(image, transformation.filter.blur.size)
			else if (transformation.filter.type === 'mean') image = mean(image, transformation.filter.mean.size)
			else if (transformation.filter.type === 'gaussianBlur') image = gaussianBlur(image, transformation.filter.gaussianBlur)
		}

		if (transformation.invert) image = invert(image)

		return image
	}

	async export(path: string, transformation: ImageTransformation, camera?: string, saveAt?: string): Promise<ExportedImageItem | undefined> {
		const { format } = transformation

		const hash = this.computeExportHash(path, transformation)

		// Retrieve the exported image
		if (!saveAt) {
			const item = this.exported.get(hash)?.item

			if (item) {
				// Refresh the exported image's date
				this.exported.set(hash, { date: Date.now(), item })
				console.info('reusing exported image at', path)
				return item
			}
		}

		// Retrieve the transformed image
		const transformed = await this.transform(path, transformation, camera)

		if (!transformed) {
			console.warn('failed to load transformed image at', path)
			return undefined
		}

		const { image, buffered } = transformed
		const { width, height, channels } = image.metadata

		if (format.type === 'fits' || format.type === 'xisf') {
			// Invalid path to save
			if (!saveAt) {
				console.error('unable to export to fits/xisf without save path')
				return undefined
			}

			// Just save it to file
			const handle = await fs.open(saveAt!, 'w')
			await using sink = fileHandleSink(handle)
			await writeImageToFits(image, sink)

			return { transformed, hash }
		}

		// Convert to the desired format
		const output = writeImageToFormat(image, format.type, format)

		if (output) {
			if (saveAt) {
				// Export it
				await Bun.write(saveAt, output)
				console.info('saved image at', path, 'to', saveAt)
				return { transformed, hash }
			}

			const info: ImageInfo = {
				path: buffered.path,
				width,
				height,
				mono: channels === 1,
				metadata: image.metadata,
				transformation,
				hash,
				headers: image.header,
				rightAscension: rightAscensionKeyword(image.header, undefined),
				declination: declinationKeyword(image.header, undefined),
				solution: plateSolutionFrom(image.header),
			}

			const item = { output, info, transformed, hash }
			output && this.exported.set(hash, { date: Date.now(), item })
			console.info('image at', path, 'was exported to format', format.type, ':', item.output.byteLength)
			return item
		} else {
			console.warn('the image at', path, 'could not be exported to format', format.type)
		}

		return undefined
	}

	private computeImageTransformationHash(transformation: ImageTransformation) {
		const { enabled, calibrationGroup = '', debayer, horizontalMirror, verticalMirror, invert } = transformation
		const stretch = this.computeImageStretchHash(transformation.stretch)
		const scnr = this.computeImageScnrHash(transformation.scnr)
		const filter = this.computeImageFilterHash(transformation.filter)
		const adjustment = this.computeImageAdjustmentHash(transformation.adjustment)
		return `${enabled}:${calibrationGroup}:${debayer}:${stretch}:${scnr}:${filter}:${adjustment}:${horizontalMirror}:${verticalMirror}:${invert}`
	}

	private computeImageStretchHash(stretch: ImageStretch) {
		const { auto, shadow, midtone, highlight, meanBackground } = stretch
		return auto ? `T:${meanBackground}` : `F:${shadow}:${midtone}:${highlight}`
	}

	private computeImageScnrHash(scnr: ImageScnr) {
		const { channel = 'GREEN', amount, method } = scnr
		return `${channel}:${amount}:${method}`
	}

	private computeImageFilterHash(filter: ImageFilter) {
		const { enabled, type, blur, mean, gaussianBlur } = filter

		if (!enabled) return 'F'

		switch (type) {
			case 'blur':
				return `T:${type}:${blur.size}`
			case 'mean':
				return `T:${type}:${mean.size}`
			case 'gaussianBlur':
				return `T:${type}:${gaussianBlur.size}:${gaussianBlur.sigma}`
			default:
				return `T:${type}`
		}
	}

	private computeImageAdjustmentHash(adjustment: ImageAdjustment) {
		const { enabled, brightness, contrast, gamma, saturation } = adjustment
		return enabled ? `T:${brightness.value}:${contrast.value}:${gamma.value}${this.computeImageAdjustmentSaturationHash(saturation)}` : 'F'
	}

	private computeImageAdjustmentSaturationHash(saturation: ImageAdjustment['saturation']) {
		const { value, channel } = saturation
		return `${value}:${typeof channel === 'string' ? channel : `${channel.red}:${channel.green}:${channel.blue}`}`
	}

	private computeTransformHash(path: string, transformation: ImageTransformation) {
		const hash = this.computeImageTransformationHash(transformation)
		return Bun.MD5.hash(`${path}:${hash}`, 'hex')
	}

	private computeExportHash(path: string, transformation: ImageTransformation) {
		const hash = this.computeImageTransformationHash(transformation)

		switch (transformation.format.type) {
			case 'jpeg':
				return Bun.MD5.hash(`${path}:jpeg:${transformation.format.jpeg.chrominanceSubsampling}:${transformation.format.jpeg.quality}:${hash}`, 'hex')
			default:
				return Bun.MD5.hash(`${path}:${transformation.format}:${hash}`, 'hex')
		}
	}

	clear() {
		let deleted = false
		const now = Date.now()

		for (const [key, { date, item }] of this.exported) {
			if (now - date >= DEFAULT_IMAGE_EXPIRES_IN) {
				this.exported.delete(key)
				console.info('deleted exported image at', item.transformed.buffered.path)
				deleted = true
			}
		}

		for (const [key, { date, item }] of this.transformed) {
			if (now - date >= DEFAULT_IMAGE_EXPIRES_IN) {
				this.transformed.delete(key)
				console.info('deleted transformed image at', item.buffered.path)
				deleted = true
			}
		}

		for (const [key, { date, item }] of this.buffered) {
			if (now - date >= DEFAULT_IMAGE_EXPIRES_IN) {
				this.buffered.delete(key)
				console.info('deleted buffered image at', item.path)
				deleted = true
			}
		}

		if (deleted) {
			Bun.gc(false)
		}
	}

	ping(path: string, hash?: string, camera?: string, now?: number) {
		now ??= Date.now()

		for (const exported of this.exported.values()) {
			if (exported.item.hash === hash) {
				exported.date = now

				for (const transformed of this.transformed.values()) {
					if (transformed.item === exported.item.transformed) {
						transformed.date = now
					}
				}
			}
		}

		for (const [key, value] of this.buffered) {
			if (key === path || value.item.camera === camera) {
				value.date = now
			}
		}

		if (now === 0) this.clear()
	}
}

export class ImageHandler {
	constructor(
		readonly processor: ImageProcessor,
		readonly notification?: NotificationHandler,
	) {}

	open(req: OpenImage) {
		return this.processor.export(req.path, req.transformation, req.camera)
	}

	close(req: CloseImage) {
		return this.processor.ping(req.path, req.hash, req.camera, 0)
	}

	ping(req: CloseImage) {
		return this.processor.ping(req.path, req.hash, req.camera)
	}

	async save(req: SaveImage) {
		if (!req.saveAt) return
		req.transformation.enabled = req.transformed
		await this.processor.export(req.path, req.transformation, undefined, req.saveAt)
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

	async statistics(req: StatisticImage) {
		req.transformation.enabled = req.transformed
		const image = await this.processor.transform(req.path, req.transformation)

		if (image?.image) {
			const stats = new Array<ImageHistogram>(image.image.metadata.channels)
			const isMono = stats.length === 1
			const bits = new Int32Array(1 << Math.max(8, Math.min(req.bits ?? 16, 20)))

			for (let i = 0; i < stats.length; i++) {
				const channel = isMono ? 'GRAY' : i === 0 ? 'RED' : i === 1 ? 'GREEN' : 'BLUE'
				const hist = histogram(image.image, channel, undefined, req.area, bits)
				const { standardDeviation, variance, count, mean, median, maximum, minimum } = hist
				stats[i] = { standardDeviation, variance, count, mean, median, maximum, minimum, data: Array.from(bits) }
			}

			return stats
		} else {
			console.warn('invalid state. expected image, but got', image)
		}

		return []
	}
}

export function image(imageHandler: ImageHandler) {
	const app = new Elysia({ prefix: '/image' })
		// Endpoints!
		.post('/open', async ({ body, set }) => {
			const item = await imageHandler.open(body as never)

			if (!item?.info || !item?.output) return undefined

			set.headers[X_IMAGE_INFO_HEADER] = encodeURIComponent(JSON.stringify(item.info))

			return item.output
		})
		.post('/close', ({ body }) => imageHandler.close(body as never))
		.post('/ping', ({ body }) => imageHandler.ping(body as never))
		.post('/save', ({ body }) => imageHandler.save(body as never))
		.post('/annotate', ({ body }) => imageHandler.annotate(body as never))
		.post('/coordinateinterpolation', ({ body }) => imageHandler.coordinateInterpolation(body as never))
		.post('/statistics', ({ body }) => imageHandler.statistics(body as never))
		.get('/fovcameras', () => fovCameras)
		.get('/fovtelescopes', () => fovTelescopes)
		.use(cron({ name: 'clear', pattern: '0 */1 * * * *', run: () => imageHandler.processor.clear() }))

	return app
}
