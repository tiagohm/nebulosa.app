import Elysia from 'elysia'
import fs from 'fs/promises'
import { eraPvstar } from 'nebulosa/src/erfa'
import { declinationKeyword, type Fits, observationDateKeyword, readFits, rightAscensionKeyword } from 'nebulosa/src/fits'
import { type Image, type ImageFormat, isImage, readImageFromFits, type WriteImageToFormatOptions, writeImageToFits, writeImageToFormat } from 'nebulosa/src/image'
import { adf, histogram } from 'nebulosa/src/image.computation'
import { debayer, horizontalFlip, invert, scnr, stf, verticalFlip } from 'nebulosa/src/image.transformation'
import type { Camera } from 'nebulosa/src/indi.device'
import { bufferSource, fileHandleSink, fileHandleSource } from 'nebulosa/src/io'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import { spaceMotion, star } from 'nebulosa/src/star'
import { timeUnix } from 'nebulosa/src/time'
import { Wcs } from 'nebulosa/src/wcs'
import { join } from 'path'
import type { JpegOptions, OutputInfo, PngOptions, WebpOptions } from 'sharp'
import fovCameras from '../../data/cameras.json' with { type: 'json' }
import nebulosa from '../../data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
import fovTelescopes from '../../data/telescopes.json' with { type: 'json' }
import type { AnnotatedSkyObject, AnnotateImage, ImageCoordinateInterpolation, ImageHistogram, ImageInfo, ImageScnr, ImageStretch, ImageTransformation, OpenImage, SaveImage, StatisticImage } from '../shared/types'
import { X_IMAGE_INFO_HEADER } from '../shared/types'
import type { NotificationHandler } from './notification'

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

export interface SavedImageItem {
	readonly bytes?: Buffer
	readonly path: string
}

export interface TransformedImageItem {
	readonly saved: SavedImageItem
	readonly image: Image
	readonly transformation: ImageTransformation
}

export interface ExportedImageItem {
	readonly transformed: TransformedImageItem
	readonly output?: OutputInfo
	readonly info?: ImageInfo
	readonly path: string
}

export interface ImageProcessorItem<T> {
	readonly date: number
	readonly item: T
}

export class ImageProcessor {
	private readonly saved = new Map<string, ImageProcessorItem<SavedImageItem>>()
	private readonly transformed = new Map<string, ImageProcessorItem<TransformedImageItem>>()
	private readonly exported = new Map<string, ImageProcessorItem<ExportedImageItem>>()

	save(camera: Camera, bytes: Buffer, path: string) {
		const item: SavedImageItem = { bytes, path }
		this.saved.set(camera.name, { date: Date.now(), item })
		return item
	}

	private async open(bytes?: Buffer) {
		if (!bytes) return undefined
		const source = bufferSource(bytes)
		const fits = await readFits(source) // TODO: support XISF
		return await readImageFromFits(fits)
	}

	extractIdFromCameraOrPath(id: Camera | string) {
		return typeof id !== 'string' ? id.name : id.startsWith(':') ? Buffer.from(id.substring(1), 'hex').toString('utf-8') : id
	}

	transform(id: Camera | string, transformation: ImageTransformation) {
		return typeof id !== 'string' || id.startsWith(':') ? this.transformFromCamera(id, transformation) : this.transformFromPath(id, transformation)
	}

	private async transformFromPath(path: string, transformation: ImageTransformation) {
		const hash = this.computeTransformHash(path, transformation)
		let item = this.transformed.get(hash)?.item

		if (item) {
			console.info('reusing transformed image', path)
			return item
		}

		const handle = await fs.open(path)
		await using source = fileHandleSource(handle)
		const fits = await readFits(source)
		let image = await readImageFromFits(fits)

		if (!image) {
			console.warn('failed to open image at', path)
			return undefined
		}

		item = { saved: { path }, image, transformation }
		image = this.applyTransformation(image, transformation)
		this.transformed.set(hash, { date: Date.now(), item })
		return item
	}

	private async transformFromCamera(camera: Camera | string, transformation: ImageTransformation) {
		const hash = this.computeTransformHash(camera, transformation)
		let item = this.transformed.get(hash)?.item

		if (item) {
			console.info('reusing transformed image', camera)
			return item
		}

		const id = this.extractIdFromCameraOrPath(camera)
		const saved = this.saved.get(id)?.item

		if (!saved?.bytes) {
			console.warn('failed to load saved image at', id)
			return undefined
		}

		let image = await this.open(saved.bytes)

		if (!image) {
			console.warn('failed to open image at', saved.path)
			return undefined
		}

		item = { saved, image, transformation }
		image = this.applyTransformation(image, transformation)
		this.transformed.set(hash, { date: Date.now(), item })
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

		if (transformation.invert) image = invert(image)

		return image
	}

	async export(id: Camera | string, transformation: ImageTransformation, saveAt?: string) {
		const hash = this.computeExportHash(id, transformation)

		let item = this.exported.get(hash)?.item

		if (item) {
			console.info('reusing exported image', id)
			return item
		}

		const transformed = await this.transform(id, transformation)

		if (!transformed) {
			console.warn('failed to load transformed image at', id)
			return undefined
		}

		const { image, saved } = transformed
		const { format } = transformation

		if (format === 'fits' || format === 'xisf') {
			if (saveAt) {
				const handle = await fs.open(saveAt, 'w')
				await using sink = fileHandleSink(handle)
				await writeImageToFits(image, sink)
				return { transformed, path: saveAt }
			}

			return undefined
		}

		saveAt ||= join(Bun.env.tmpDir, `${Bun.randomUUIDv7()}.${format}`)

		const options: WriteImageToFormatOptions = {
			format: IMAGE_FORMAT_OPTIONS[format],
		}

		const output = await writeImageToFormat(image, saveAt, format, options)

		if (output) {
			const info: ImageInfo = {
				path: saveAt,
				realPath: saved.path,
				width: output.width,
				height: output.height,
				mono: output.channels === 1,
				metadata: image.metadata,
				transformation,
				headers: image.header,
				rightAscension: rightAscensionKeyword(image.header, undefined),
				declination: declinationKeyword(image.header, undefined),
			}

			item = { output, info, transformed, path: saveAt }
			output && this.exported.set(hash, { date: Date.now(), item })
			return item
		} else {
			console.warn('failed to export image at', saveAt)
		}

		return undefined
	}

	// TODO: compute hash for adjustment and filter when implement it
	private computeImageTransformationHash(transformation: ImageTransformation) {
		const { enabled, calibrationGroup = '', debayer, horizontalMirror, verticalMirror, invert, adjustment, filter } = transformation
		const stretch = this.computeImageStretchHash(transformation.stretch)
		const scnr = this.computeImageScnrHash(transformation.scnr)
		return Bun.MD5.hash(`${enabled}:${calibrationGroup}:${debayer}:${stretch}:${horizontalMirror}:${verticalMirror}:${invert}:${scnr}`, 'hex')
	}

	private computeImageStretchHash(stretch: ImageStretch) {
		const { auto, shadow, midtone, highlight, meanBackground } = stretch
		return Bun.MD5.hash(auto ? `T:${meanBackground}` : `F:${shadow}:${midtone}:${highlight}`, 'hex')
	}

	private computeImageScnrHash(scnr: ImageScnr) {
		const { channel = 'GREEN', amount, method } = scnr
		return Bun.MD5.hash(`${channel}:${amount}:${method}`, 'hex')
	}

	private computeTransformHash(id: Camera | string, transformation: ImageTransformation) {
		const hash = this.computeImageTransformationHash(transformation)
		return Bun.MD5.hash(`${this.extractIdFromCameraOrPath(id)}:${hash}`, 'hex')
	}

	private computeExportHash(id: Camera | string, transformation: ImageTransformation) {
		const hash = this.computeImageTransformationHash(transformation)
		return Bun.MD5.hash(`${this.extractIdFromCameraOrPath(id)}:${transformation.format}:${hash}`, 'hex')
	}

	async cleanUp() {
		const now = Date.now()
		const exported: ExportedImageItem[] = []
		const transformed: TransformedImageItem[] = []
		let deleted = false

		async function unlink(path: string) {
			if (path && (await fs.exists(path))) {
				await fs.unlink(path)
				console.info('unlinked image at', path)
			}
		}

		for (const [key, value] of this.exported) {
			if (now - value.date >= 60000) {
				this.exported.delete(key)
				exported.push(value.item)
				console.info('deleted exported image at', value.item.path)
				deleted = true
			}
		}

		for (const [key, value] of this.transformed) {
			if (now - value.date >= 60000 || exported.some((e) => e.transformed === value.item)) {
				this.transformed.delete(key)
				transformed.push(value.item)
				deleted = true
			}
		}

		for (const [key, value] of this.saved) {
			if (now - value.date >= 60000 || transformed.some((e) => e.saved === value.item)) {
				this.exported.delete(key)
				console.info('deleted buffered image at', value.item.path)
				deleted = true
			}
		}

		if (deleted) {
			Bun.gc()

			for (const { path } of exported) {
				await unlink(path)
			}
		}
	}
}

export class ImageHandler {
	constructor(
		readonly processor: ImageProcessor,
		readonly notification?: NotificationHandler,
	) {}

	async open(req: OpenImage) {
		if (!req.path) return undefined
		const item = await this.processor.export(req.path, req.transformation)
		return item?.info
	}

	async readAndTransformImageFromFits(fits: Fits, transformation: ImageTransformation, realPath: string, savePath?: string) {
		if (fits) {
			const image = await readImageFromFits(fits)

			if (image) {
				const id = Bun.randomUUIDv7()
				const { format } = transformation
				const path = savePath ?? join(Bun.env.tmpDir, `${id}.${format}`)
				const output = await this.transformImageAndSave(image, path, transformation)

				if (isImage(output)) {
					return output
				} else if (output) {
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

	async transformImageAndSave(image: Image, path: string, transformation: ImageTransformation, format: ImageFormat = transformation.format) {
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

		if (!path) {
			return image
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

	async save(req: SaveImage) {
		if (!req.saveAt) return
		req.transformation.enabled = req.transformed
		await this.processor.export(req.path, req.transformation, req.saveAt)
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

export function image(image: ImageHandler) {
	const app = new Elysia({ prefix: '/image' })
		// Endpoints!
		.post('/open', async ({ body, set }) => {
			const info = await image.open(body as never)

			if (!info) return undefined

			set.headers[X_IMAGE_INFO_HEADER] = encodeURIComponent(JSON.stringify(info))

			return Bun.file(info.path)
		})
		.post('/save', ({ body }) => image.save(body as never))
		.post('/annotate', ({ body }) => image.annotate(body as never))
		.post('/coordinateinterpolation', ({ body }) => image.coordinateInterpolation(body as never))
		.post('/statistics', ({ body }) => image.statistics(body as never))
		.get('/fovcameras', () => fovCameras)
		.get('/fovtelescopes', () => fovTelescopes)

	return app
}
