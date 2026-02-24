import fs from 'fs/promises'
import { deg, parseAngle } from 'nebulosa/src/angle'
import { eraPvstar } from 'nebulosa/src/erfa'
import { declinationKeyword, numericKeyword, observationDateKeyword, rightAscensionKeyword } from 'nebulosa/src/fits'
import { readImageFromBuffer, readImageFromPath, writeImageToFits, writeImageToFormat } from 'nebulosa/src/image'
import { adf, histogram, sigmaClip } from 'nebulosa/src/image.computation'
import { blur, brightness, calibrate, contrast, debayer, gamma, gaussianBlur, horizontalFlip, invert, mean, saturation, scnr, sharpen, stf, verticalFlip } from 'nebulosa/src/image.transformation'
import type { AdaptiveDisplayFunctionOptions, Image } from 'nebulosa/src/image.types'
import type { Camera } from 'nebulosa/src/indi.device'
import { fileHandleSink } from 'nebulosa/src/io'
import { type PlateSolution, plateSolutionFrom } from 'nebulosa/src/platesolver'
import { identify } from 'nebulosa/src/sbd'
import { spaceMotion, star } from 'nebulosa/src/star'
import { timeUnix } from 'nebulosa/src/time'
import { Wcs } from 'nebulosa/src/wcs'
import { basename, join } from 'path'
import fovCameras from '../../data/cameras.json' with { type: 'json' }
import nebulosa from '../../data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
import fovTelescopes from '../../data/telescopes.json' with { type: 'json' }
import type { AnnotatedSkyObject, AnnotateImage, CloseImage, ImageAdjustment, ImageCalibration, ImageCoordinateInterpolation, ImageFilter, ImageHistogram, ImageInfo, ImageScnr, ImageStretch, ImageTransformation, OpenImage, SaveImage, StatisticImage } from '../shared/types'
import { X_IMAGE_INFO_HEADER } from '../shared/types'
import { DEFAULT_HEADERS, type Endpoints, INTERNAL_SERVER_ERROR_RESPONSE, response } from './http'
import type { NotificationHandler } from './notification'

export interface BufferedImageItem {
	readonly buffer?: Buffer
	readonly path: string
	readonly camera?: string
}

export interface TransformedImageItem {
	readonly buffered: BufferedImageItem
	readonly image: Image
	readonly transformation: ImageTransformation | false
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

	save(buffer: Buffer, path: string, camera?: Camera) {
		// Avoid double buffering
		const canBuffer = !camera || process.platform !== 'linux' || !path.startsWith('/dev/shm/')

		if (camera) {
			// Delete existing image for the camera
			for (const [key, item] of this.transformed) item.item.buffered.camera === camera.id && this.transformed.delete(key)
			for (const [key, item] of this.exported) item.item.transformed.buffered.camera === camera.id && this.exported.delete(key)
			for (const [key, item] of this.buffered) item.item.camera === camera.id && this.buffered.delete(key)
		} else {
			// Delete existing image for the (framing) path
			// Framing images is saved on temp directory and it will be unlinked before the process exit!
			for (const [key, item] of this.transformed) item.item.buffered.path === path && this.transformed.delete(key)
			for (const [key, item] of this.exported) item.item.transformed.buffered.path === path && this.exported.delete(key)
		}

		// Store the buffer
		let item: BufferedImageItem

		if (canBuffer) {
			item = { buffer, path, camera: camera?.id }
			this.buffered.set(path, { date: Date.now(), item })
		} else {
			item = { buffer: Buffer.allocUnsafe(0), path, camera: camera?.id }
			this.buffered.set(path, { date: Date.now(), item })
		}

		console.info('image at', path, 'was buffered:', item.buffer?.byteLength)

		return item
	}

	async transform(path: string, transformation: ImageTransformation | false, camera?: string) {
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
			image = await readImageFromBuffer(buffered.buffer, 32)
		} else {
			image = await readImageFromPath(path, 32)
		}

		if (!image) {
			console.warn('failed to open image at', path)
			return undefined
		}

		image = await this.applyTransformation(image, transformation)
		item = { buffered: buffered ?? { path, camera }, image, transformation, hash }
		this.transformed.set(hash, { date: Date.now(), item })
		console.info('image at', path, 'was transformed:', item.image.raw.byteLength)
		return item
	}

	private async applyTransformation(image: Image, transformation: ImageTransformation | false) {
		if (transformation === false || !transformation.enabled) return image

		if (transformation.debayer) image = debayer(image, !transformation.cfaPattern || transformation.cfaPattern === 'AUTO' ? undefined : transformation.cfaPattern) ?? image
		if (transformation.calibration.enabled) image = await this.calibrate(image, transformation.calibration)
		if (transformation.horizontalMirror) image = horizontalFlip(image)
		if (transformation.verticalMirror) image = verticalFlip(image)

		if (transformation.scnr.channel) {
			const { channel, amount, method } = transformation.scnr
			image = scnr(image, channel, amount, method)
		}

		const { stretch, adjustment, filter } = transformation

		if (stretch.auto) {
			const options: Partial<AdaptiveDisplayFunctionOptions> = { meanBackground: stretch.meanBackground, clippingPoint: stretch.clippingPoint, bits: stretch.bits }

			if (stretch.sigmaClip) {
				options.bits = new Int32Array(1 << stretch.bits) // used by sigmaClip and adf methods
				options.sigmaClip = sigmaClip(image, stretch)
			}

			const [midtone, shadow, highlight] = adf(image, options)
			image = stf(image, midtone, shadow, highlight, { bits: stretch.bits })

			stretch.midtone = Math.trunc(midtone * 65536)
			stretch.shadow = Math.trunc(shadow * 65536)
			stretch.highlight = Math.trunc(highlight * 65536)
		} else {
			const { midtone, shadow, highlight } = stretch
			image = stf(image, midtone / 65536, shadow / 65536, highlight / 65536, { bits: stretch.bits })
		}

		if (adjustment.enabled) {
			if (adjustment.brightness.value !== 1) image = brightness(image, adjustment.brightness.value)
			if (adjustment.contrast.value !== 1) image = contrast(image, adjustment.contrast.value)
			if (adjustment.gamma.value > 1) image = gamma(image, adjustment.gamma.value)
			if (adjustment.saturation.value !== 1) image = saturation(image, adjustment.saturation.value, adjustment.saturation.channel)
		}

		if (filter.enabled) {
			if (filter.type === 'sharpen') image = sharpen(image)
			else if (filter.type === 'blur') image = blur(image, filter.blur.size)
			else if (filter.type === 'mean') image = mean(image, filter.mean.size)
			else if (filter.type === 'gaussianBlur') image = gaussianBlur(image, filter.gaussianBlur)
		}

		if (transformation.invert) image = invert(image)

		return image
	}

	private async calibrate(image: Image, calibration: ImageCalibration) {
		if (!calibration.enabled) return image

		try {
			const dark = calibration.dark.enabled && calibration.dark.path ? await readImageFromPath(calibration.dark.path, 32) : undefined
			const flat = calibration.flat.enabled && calibration.flat.path ? await readImageFromPath(calibration.flat.path, 32) : undefined
			const bias = calibration.bias.enabled && calibration.bias.path ? await readImageFromPath(calibration.bias.path, 32) : undefined
			const darkFlat = calibration.darkFlat.enabled && calibration.darkFlat.path ? await readImageFromPath(calibration.darkFlat.path, 32) : undefined

			return calibrate(image, dark, flat, bias, darkFlat)
		} catch (e) {
			console.error('failed to calibrate', e)
			return image
		}
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

	get(path: string) {
		return this.buffered.get(path)?.item.buffer
	}

	// Stores the saved buffer for given path into local file
	async store(path: string) {
		const buffer = this.get(path)

		if (buffer) {
			path = join(Bun.env.tmpDir, basename(path))
			await Bun.write(path, buffer)
			return path
		}

		return undefined
	}

	private computeImageTransformationHash(transformation: ImageTransformation | false) {
		if (transformation === false || !transformation.enabled) return 'F'
		const { debayer, cfaPattern, horizontalMirror, verticalMirror, invert } = transformation
		const stretch = this.computeImageStretchHash(transformation.stretch)
		const scnr = this.computeImageScnrHash(transformation.scnr)
		const filter = this.computeImageFilterHash(transformation.filter)
		const adjustment = this.computeImageAdjustmentHash(transformation.adjustment)
		const calibration = this.computeImageCalibrationHash(transformation.calibration)
		return `T:${debayer}:${cfaPattern}:${calibration}:${stretch}:${scnr}:${filter}:${adjustment}:${horizontalMirror}:${verticalMirror}:${invert}`
	}

	private computeImageStretchHash(stretch: ImageStretch) {
		const { auto, shadow, midtone, highlight, meanBackground, clippingPoint, centerMethod, dispersionMethod, sigmaLower, sigmaUpper, bits } = stretch
		const sigmaClip = auto && stretch.sigmaClip ? `T:${centerMethod}:${dispersionMethod}:${sigmaLower}:${sigmaUpper}` : 'F'
		return auto ? `T:${meanBackground}:${clippingPoint}:${sigmaClip}:${bits}` : `F:${shadow}:${midtone}:${highlight}:${sigmaClip}:${bits}`
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

	private computeImageCalibrationHash(adjustment: ImageCalibration) {
		const { enabled, dark, flat, bias, darkFlat } = adjustment
		return enabled ? `T:${dark.enabled && dark.path ? dark.path : ''}:${flat.enabled && flat.path ? flat.path : ''}:${bias.enabled && bias.path ? bias.path : ''}:${darkFlat.enabled && darkFlat.path ? darkFlat.path : ''}` : 'F'
	}

	private computeImageAdjustmentHash(adjustment: ImageAdjustment) {
		const { enabled, brightness, contrast, gamma, saturation } = adjustment
		return enabled ? `T:${brightness.value}:${contrast.value}:${gamma.value}${this.computeImageAdjustmentSaturationHash(saturation)}` : 'F'
	}

	private computeImageAdjustmentSaturationHash(saturation: ImageAdjustment['saturation']) {
		const { value, channel } = saturation
		return `${value}:${typeof channel === 'string' ? channel : `${channel.red}:${channel.green}:${channel.blue}`}`
	}

	private computeTransformHash(path: string, transformation: ImageTransformation | false) {
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
		readonly imageProcessor: ImageProcessor,
		readonly notification?: NotificationHandler,
	) {}

	open(req: OpenImage) {
		return this.imageProcessor.export(req.path, req.transformation, req.camera)
	}

	close(req: CloseImage) {
		return this.imageProcessor.ping(req.path, req.hash, req.camera, 0)
	}

	ping(req: CloseImage) {
		return this.imageProcessor.ping(req.path, req.hash, req.camera)
	}

	async save(req: SaveImage) {
		if (!req.saveAt) return
		await this.imageProcessor.export(req.path, req.transformation, undefined, req.saveAt)
	}

	async annotate(req: AnnotateImage) {
		const res: AnnotatedSkyObject[] = []

		if (!req.stars && !req.dsos && !req.minorPlanets) return res

		const { solution } = req
		const { rightAscension, declination, radius, widthInPixels: width, heightInPixels: height } = solution
		const date = observationDateKeyword(solution) || Date.now()
		using wcs = new Wcs(solution)

		if (req.stars || req.dsos) {
			const filterByType = req.stars && req.dsos ? '1=1' : req.stars ? 'd.type = 29' : 'd.type <> 29'
			const utc = timeUnix(date / 1000)
			const q = `SELECT d.id, d.type, d.rightAscension, d.declination, d.magnitude, d.pmRa, d.pmDec, d.distance, d.rv, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ORDER BY n.type ASC LIMIT 1) as name FROM dsos d WHERE ${filterByType} AND (acos(sin(d.declination) * ${Math.sin(declination)} + cos(d.declination) * ${Math.cos(declination)} * cos(d.rightAscension - ${rightAscension})) <= ${radius}) ORDER BY d.magnitude DESC LIMIT 100`

			for (const o of nebulosa.query<AnnotatedSkyObject, []>(q)) {
				const sa = star(o.rightAscension, o.declination, o.pmRa, o.pmDec, o.distance === 0 ? 0 : 1 / o.distance, o.rv)
				const sb = eraPvstar(...spaceMotion(sa, utc))

				if (sb) {
					const [x, y] = wcs.skyToPix(sb[0], sb[1])!

					if (x >= 0 && y >= 0 && x < width && y < height) {
						o.x = x
						o.y = y
						res.push(o)
					}
				}
			}
		}

		if (req.minorPlanets) {
			const longitude = numericKeyword(req.solution, 'SITELON', 0)
			const latitude = numericKeyword(req.solution, 'SITELAT', 0)

			const ident = await identify(date, deg(longitude), deg(latitude), 0, rightAscension, declination, radius, undefined, req.minorPlanetsMagnitudeLimit, req.includeMinorPlanetsWithoutMagnitude)

			if ('n_second_pass' in ident && ident.n_second_pass) {
				let i = 0

				for (const body of ident.data_second_pass) {
					const name = body[0]
					const rightAscension = parseAngle(body[1], true)!
					const declination = parseAngle(body[2])!
					const magnitude = +body[6]

					const [x, y] = wcs.skyToPix(rightAscension, declination)!

					if (x >= 0 && y >= 0 && x < width && y < height) {
						res.push({ type: 'MINOR_PLANET', id: 3000000 + i++, name, x, y, rightAscension, declination, magnitude, pmRa: 0, pmDec: 0, rv: 0, distance: 0, constellation: 0 })
					}
				}
			} else if ('message' in ident) {
				console.warn('identify error:', ident.message)
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
		const image = await this.imageProcessor.transform(req.path, req.transformation)

		if (image?.image) {
			const stats = new Array<ImageHistogram>(image.image.metadata.channels)
			const isMono = stats.length === 1
			const bits = new Int32Array(1 << Math.max(8, Math.min(req.bits ?? 16, 20)))

			for (let i = 0; i < stats.length; i++) {
				const channel = isMono ? 'GRAY' : i === 0 ? 'RED' : i === 1 ? 'GREEN' : 'BLUE'
				const hist = histogram(image.image, { channel, area: req.area, bits })
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

export function image(imageHandler: ImageHandler): Endpoints {
	return {
		'/image/open': {
			POST: async (req) => {
				const item = await imageHandler.open(await req.json())

				if (item?.info && item.output) {
					return new Response(item.output as Buffer<ArrayBuffer>, {
						headers: {
							...DEFAULT_HEADERS,
							[X_IMAGE_INFO_HEADER]: encodeURIComponent(JSON.stringify(item.info)),
						},
					})
				} else {
					return INTERNAL_SERVER_ERROR_RESPONSE
				}
			},
		},
		'/image/close': { POST: async (req) => response(imageHandler.close(await req.json())) },
		'/image/ping': { POST: async (req) => response(imageHandler.ping(await req.json())) },
		'/image/save': { POST: async (req) => response(await imageHandler.save(await req.json())) },
		'/image/annotate': { POST: async (req) => response(await imageHandler.annotate(await req.json())) },
		'/image/coordinateinterpolation': { POST: async (req) => response(imageHandler.coordinateInterpolation(await req.json())) },
		'/image/statistics': { POST: async (req) => response(await imageHandler.statistics(await req.json())) },
		'/image/fovcameras': { GET: response(fovCameras) },
		'/image/fovtelescopes': { GET: response(fovTelescopes) },
	}
}
