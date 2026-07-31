import fs from 'fs/promises'
import { basename, join } from 'path'
import { plateSolutionFrom } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { readImageFromBuffer, readImageFromPath, writeImageToFits, writeImageToFormat, writeImageToXisf } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { calibrate } from 'nebulosa/src/imaging/processing/calibration'
import { adf, sigmaClip } from 'nebulosa/src/imaging/processing/computation'
import type { AdaptiveDisplayFunctionOptions } from 'nebulosa/src/imaging/processing/computation'
import { blur, gaussianBlur, mean, sharpen } from 'nebulosa/src/imaging/processing/convolution'
import { debayer } from 'nebulosa/src/imaging/processing/debayer'
import { fft, FFTWorkspace } from 'nebulosa/src/imaging/processing/fft'
import { horizontalFlip, invert, verticalFlip } from 'nebulosa/src/imaging/processing/geometry'
import { scnr } from 'nebulosa/src/imaging/processing/scnr'
import { stf } from 'nebulosa/src/imaging/processing/stf'
import { brightness, contrast, gamma, saturation } from 'nebulosa/src/imaging/processing/tone'
import { declinationKeyword, rightAscensionKeyword } from 'nebulosa/src/io/formats/fits/util'
import { fileHandleSink } from 'nebulosa/src/io/io'
import type { ImageInfo, ImageTransformation } from '#/image'
import type { ImageAdjustment } from '#/image.adjustment'
import type { ImageCalibration, ImageCalibrationFile } from '#/image.calibration'
import type { ImageFFT } from '#/image.fft'
import type { ImageFilter } from '#/image.filter'
import type { ImageScnr } from '#/image.scnr'
import type { ImageStretch } from '#/image.stretch'

// Payload a producer handed over for a path. It is the only source for frames that never reach the
// filesystem, such as INDI blobs and hip2fits responses, so dropping an entry loses the image; frames
// that exist on disk are always decodable again from `path`.
export interface SourceImage {
	// Serialized payload, absent when the producer wrote the frame straight to a shared memory path or
	// when it handed over an already decoded frame.
	readonly buffer?: Buffer
	// Already decoded frame, held by producers that decoded the payload for their own purposes. It spares
	// the reader a second decode and is the only source when there is no serialized payload at all.
	readonly image?: Image
	readonly path: string
	readonly camera?: string
}

// Decoded frame with the whole transformation pipeline applied, ready to be exported or measured.
export interface TransformedImage {
	readonly source: SourceImage
	readonly image: Image & { fftWorkspace?: FFTWorkspace }
	// Transformation as requested, including the stretch values `applyTransformation` writes back.
	readonly transformation: ImageTransformation | false
	// Canonical form of `transformation`, used as the cache identity.
	readonly key: NormalizedTransformation
}

// Result of encoding a transformed frame. `output` and `info` are absent when the frame was written
// straight to a file instead of being returned to the browser.
export interface ExportedImage {
	readonly transformed: TransformedImage
	readonly output?: Buffer
	readonly info?: ImageInfo
}

// Cached value paired with the last time it was used, in milliseconds from `performance.now()`.
interface CacheEntry<T> {
	date: number
	readonly item: T
}

const DEFAULT_IMAGE_EXPIRES_IN = 60000

// Transformed frames kept per path. Two is enough for the common overlap, where the viewer holds the
// user's transformation and the statistics panel asks for the untransformed frame of the same path.
const TRANSFORMED_PER_PATH = 2

// Copies a decoded frame, including its pixel buffer, so producer and consumer never share mutable
// pixel data. Header and metadata are shallow-copied for the same reason; their values are plain.
function cloneImage(image: Image): Image {
	return { ...image, header: { ...image.header }, metadata: { ...image.metadata }, raw: image.raw.slice() }
}

// Reduces a transformation to the fields that actually reach the pipeline, so two requests differing
// only in ignored or derived fields resolve to the same cached frame. Automatic stretch is the case
// that forces this: `applyTransformation` writes the computed midtone, shadow, and highlight back into
// the request and the browser echoes them on the next call, so comparing them would never match.
// Returns false when no pixel is touched, which is how a disabled transformation and no transformation
// at all become the same thing. The format is deliberately absent: it selects the encoder, not pixels.
function normalizeTransformation(transformation: ImageTransformation | false) {
	if (transformation === false || !transformation.enabled) return false

	const { debayer, cfaPattern, horizontalMirror, verticalMirror, invert } = transformation

	return {
		debayer,
		// Only read when debayering, and AUTO defers the pattern to the header.
		cfaPattern: debayer && cfaPattern !== 'AUTO' ? cfaPattern : undefined,
		horizontalMirror,
		verticalMirror,
		invert,
		stretch: normalizeStretch(transformation.stretch),
		scnr: normalizeScnr(transformation.scnr),
		filter: normalizeFilter(transformation.filter),
		fft: normalizeFFT(transformation.fft),
		adjustment: normalizeAdjustment(transformation.adjustment),
		calibration: normalizeCalibration(transformation.calibration),
	}
}

// Canonical transformation shape compared by `Bun.deepEquals` to identify a cached frame.
export type NormalizedTransformation = ReturnType<typeof normalizeTransformation>

// Drops the midtone, shadow, and highlight when automatic, since the pipeline computes them, and the
// sigma clip parameters when clipping is off.
function normalizeStretch(stretch: ImageStretch) {
	const { auto, bits, shadow, midtone, highlight, meanBackground, clippingPoint, centerMethod, dispersionMethod, sigmaLower, sigmaUpper } = stretch
	const clip = auto && stretch.sigmaClip

	return {
		auto,
		bits,
		shadow: auto ? undefined : shadow,
		midtone: auto ? undefined : midtone,
		highlight: auto ? undefined : highlight,
		meanBackground: auto ? meanBackground : undefined,
		clippingPoint: auto ? clippingPoint : undefined,
		sigmaClip: clip,
		centerMethod: clip ? centerMethod : undefined,
		dispersionMethod: clip ? dispersionMethod : undefined,
		sigmaLower: clip ? sigmaLower : undefined,
		sigmaUpper: clip ? sigmaUpper : undefined,
	}
}

// The channel selects the noise reduction, so amount and method are irrelevant without it.
function normalizeScnr(scnr: ImageScnr) {
	const { channel, amount, method } = scnr
	return { channel, amount: channel ? amount : undefined, method: channel ? method : undefined }
}

// Keeps only the kernel parameters of the selected filter type.
function normalizeFilter(filter: ImageFilter) {
	const { enabled, type, blur, mean, gaussianBlur } = filter
	const size = type === 'blur' ? blur.size : type === 'mean' ? mean.size : type === 'gaussianBlur' ? gaussianBlur.size : undefined

	return {
		enabled,
		type: enabled ? type : undefined,
		size: enabled ? size : undefined,
		sigma: enabled && type === 'gaussianBlur' ? gaussianBlur.sigma : undefined,
	}
}

function normalizeFFT(fft: ImageFFT) {
	const { enabled, type, cutoff, weight } = fft
	return { enabled, type: enabled ? type : undefined, cutoff: enabled ? cutoff : undefined, weight: enabled ? weight : undefined }
}

// Neutral values are skipped by the pipeline, so they must not distinguish two transformations.
function normalizeAdjustment(adjustment: ImageAdjustment) {
	const { enabled, brightness, contrast, gamma, saturation } = adjustment

	return {
		enabled,
		brightness: enabled && brightness.value !== 1 ? brightness.value : undefined,
		contrast: enabled && contrast.value !== 1 ? contrast.value : undefined,
		gamma: enabled && gamma.value > 1 ? gamma.value : undefined,
		saturation: enabled && saturation.value !== 1 ? saturation.value : undefined,
		saturationChannel: enabled && saturation.value !== 1 ? saturation.channel : undefined,
	}
}

// A calibration frame only matters through the path it is read from.
function normalizeCalibration(calibration: ImageCalibration) {
	const { enabled, dark, flat, bias, darkFlat } = calibration

	function path(file: ImageCalibrationFile) {
		return enabled && file.enabled && file.path ? file.path : undefined
	}

	return { enabled, dark: path(dark), flat: path(flat), bias: path(bias), darkFlat: path(darkFlat) }
}

// Owns the frames the application has in memory and turns them into transformed and encoded images.
//
// Two layers with opposite lifetimes live here and must not be confused. Sources are authoritative:
// evicting one can lose a frame forever. Transformed frames are a cache: evicting one only costs the
// work to rebuild it, and they are keyed by the normalized transformation of the path they came from.
export class ImageProcessor {
	private readonly sources = new Map<string, CacheEntry<SourceImage>>()
	private readonly transformed = new Map<string, CacheEntry<TransformedImage>[]>()

	// Retains the serialized payload of a frame, which is the only copy when the producer never wrote it
	// to a readable path. Returns the stored source.
	save(buffer: Buffer, path: string, camera?: Camera) {
		// Avoid double buffering
		const canBuffer = !camera || process.platform !== 'linux' || !path.startsWith('/dev/shm/')
		this.evict(path, camera)

		const item: SourceImage = { buffer: canBuffer ? buffer : undefined, path, camera: camera?.id }
		this.sources.set(path, { date: performance.now(), item })

		console.info('image at', path, 'was buffered:', item.buffer?.byteLength)

		return item
	}

	// Retains a frame its producer already decoded, such as the one the guide loop detects stars on, so
	// the viewer reuses that decode instead of parsing a payload again.
	//
	// The image is copied because the producer keeps its own instance and is free to reuse or replace it
	// on the next frame, while this one is retained until the camera produces another.
	saveImage(image: Image, path: string, camera?: Camera) {
		this.evict(path, camera)

		const item: SourceImage = { image: cloneImage(image), path, camera: camera?.id }
		this.sources.set(path, { date: performance.now(), item })

		console.info('image at', path, 'was buffered:', item.image?.raw.byteLength)

		return item
	}

	// Drops every cached frame of the camera, along with its sources, or of the path when there is no
	// camera. The source of a path is left alone because the caller is about to replace it.
	private evict(path: string, camera?: Camera) {
		if (camera) {
			for (const [key, entries] of this.transformed) entries[0]?.item.source.camera === camera.id && this.transformed.delete(key)
			for (const [key, { item }] of this.sources) item.camera === camera.id && this.sources.delete(key)
		} else {
			// Framing images are saved on the temp directory and unlinked before the process exits
			this.transformed.delete(path)
		}
	}

	// Decodes the frame of the path and runs the transformation pipeline over it, reusing the cached
	// result when an equivalent transformation was applied to the same path recently.
	async transform(path: string, transformation: ImageTransformation | false, camera?: string) {
		const key = normalizeTransformation(transformation)
		const cached = this.cached(path, key)

		if (cached) {
			console.info('reusing transformed image at', path)
			return cached
		}

		const source = this.sources.get(path)?.item
		let image = await this.decode(source, path)

		if (!image) {
			console.warn('failed to open image at', path)
			return undefined
		}

		image = await this.applyTransformation(image, transformation)

		const item: TransformedImage = { source: source ?? { path, camera }, image, transformation, key }
		this.cache(path, item)
		console.info('image at', path, 'was transformed:', item.image.raw.byteLength)
		return item
	}

	// Resolves the pixels of a source, falling back to the filesystem when nothing is retained for it.
	private decode(source: SourceImage | undefined, path: string) {
		// Copied because the pipeline may work in place, and the retained frame has to stay pristine for
		// the next transformation asked of the same path.
		if (source?.image) return Promise.resolve(cloneImage(source.image))
		if (source?.buffer?.byteLength) return readImageFromBuffer(source.buffer, 32)
		return readImageFromPath(path, 32)
	}

	// Returns the cached frame of the path whose transformation is equivalent to the requested one,
	// refreshing its liveness.
	private cached(path: string, key: NormalizedTransformation) {
		const entry = this.transformed.get(path)?.find((entry) => Bun.deepEquals(entry.item.key, key))

		if (!entry) return undefined

		entry.date = performance.now()
		return entry.item
	}

	// Caches the frame as the most recent one of the path, discarding the oldest beyond the limit.
	private cache(path: string, item: TransformedImage) {
		const entries = this.transformed.get(path) ?? []
		entries.unshift({ date: performance.now(), item })
		entries.length = Math.min(entries.length, TRANSFORMED_PER_PATH)
		this.transformed.set(path, entries)
	}

	// Applies every enabled step of the transformation, in the order the pipeline expects. The image is
	// reassigned at each step because the operations may either work in place or return a new frame.
	private async applyTransformation(image: TransformedImage['image'], transformation: ImageTransformation | false) {
		if (transformation === false || !transformation.enabled) return image

		if (transformation.debayer) image = debayer(image, !transformation.cfaPattern || transformation.cfaPattern === 'AUTO' ? undefined : transformation.cfaPattern) ?? image
		if (transformation.calibration.enabled) image = await this.calibrate(image, transformation.calibration)
		if (transformation.horizontalMirror) image = horizontalFlip(image)
		if (transformation.verticalMirror) image = verticalFlip(image)

		if (transformation.scnr.channel) {
			const { channel, amount, method } = transformation.scnr
			image = scnr(image, channel, amount, method)
		}

		if (transformation.fft.enabled) {
			const { type, cutoff, weight } = transformation.fft
			image.fftWorkspace ??= new FFTWorkspace(image.metadata.width, image.metadata.height)
			image = fft(image, image.fftWorkspace, type, cutoff, weight)
		}

		const { stretch, adjustment, filter } = transformation

		if (stretch.auto) {
			const options: Partial<AdaptiveDisplayFunctionOptions> = { meanBackground: stretch.meanBackground, clippingPoint: stretch.clippingPoint, bits: stretch.bits }

			if (stretch.sigmaClip) {
				options.bits = new Int32Array(1 << stretch.bits) // used by sigmaClip and adf methods
				options.sigmaClip = sigmaClip(image, stretch)
			}

			const [midtone, shadow, highlight] = adf(image, options)
			image = stf(image, midtone, shadow, highlight)

			// Written back so the browser can show the computed levels. This is why the cache is keyed by
			// the normalized transformation instead of the request itself.
			stretch.midtone = Math.trunc(midtone * 65536)
			stretch.shadow = Math.trunc(shadow * 65536)
			stretch.highlight = Math.trunc(highlight * 65536)
		} else {
			const { midtone, shadow, highlight } = stretch
			image = stf(image, midtone / 65536, shadow / 65536, highlight / 65536)
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

	// Subtracts and divides the calibration frames the request points to. A failure to read any of them
	// is not fatal: the uncalibrated image is still worth showing.
	private async calibrate(image: Image, calibration: ImageCalibration) {
		if (!calibration.enabled) return image

		try {
			const [dark, flat, bias, darkFlat] = await Promise.all([
				calibration.dark.enabled && calibration.dark.path ? readImageFromPath(calibration.dark.path, 32) : undefined,
				calibration.flat.enabled && calibration.flat.path ? readImageFromPath(calibration.flat.path, 32) : undefined,
				calibration.bias.enabled && calibration.bias.path ? readImageFromPath(calibration.bias.path, 32) : undefined,
				calibration.darkFlat.enabled && calibration.darkFlat.path ? readImageFromPath(calibration.darkFlat.path, 32) : undefined,
			])

			return calibrate(image, { dark, flat, bias, darkFlat })
		} catch (e) {
			console.error('failed to calibrate', e)
			return image
		}
	}

	// Transforms the frame of the path and encodes it in the requested format. Writes it to `saveAt`
	// when given, otherwise returns the encoded bytes and the metadata the browser needs to show it.
	async export(path: string, transformation: ImageTransformation, camera?: string, saveAt?: string): Promise<ExportedImage | undefined> {
		const { format } = transformation
		const transformed = await this.transform(path, transformation, camera)

		if (!transformed) {
			console.warn('failed to load transformed image at', path)
			return undefined
		}

		const { image, source } = transformed
		const { width, height, channels } = image.metadata

		if (format.type === 'fits' || format.type === 'xisf') {
			// Invalid path to save
			if (!saveAt) {
				console.error('unable to export to fits/xisf without save path')
				return undefined
			}

			const handle = await fs.open(saveAt, 'w')
			await using sink = fileHandleSink(handle)

			if (format.type === 'fits') await writeImageToFits(image, sink)
			else await writeImageToXisf(image, sink)

			return { transformed }
		}

		const output = writeImageToFormat(image, format.type, format)

		if (!output) {
			console.warn('the image at', path, 'could not be exported to format', format.type)
			return undefined
		}

		if (saveAt) {
			await Bun.write(saveAt, output)
			console.info('saved image at', path, 'to', saveAt)
			return { transformed }
		}

		const info: ImageInfo = {
			path: source.path,
			width,
			height,
			mono: channels === 1,
			metadata: image.metadata,
			transformation,
			headers: image.header,
			rightAscension: rightAscensionKeyword(image.header, undefined),
			declination: declinationKeyword(image.header, undefined),
			solution: plateSolutionFrom(image.header),
		}

		console.info('image at', path, 'was exported to format', format.type, ':', output.byteLength)
		return { transformed, output, info }
	}

	// Returns the retained payload of the path, if it was kept.
	get(path: string) {
		const buffer = this.sources.get(path)?.item.buffer
		return buffer?.byteLength ? buffer : undefined
	}

	// Writes the retained payload of the path to a temporary file, so tools that only read from disk,
	// such as the plate solver and the star detector, can reach it. Returns the written path.
	async store(path: string) {
		const buffer = this.get(path)

		if (buffer?.byteLength) {
			path = join(Bun.env.tmpDir, basename(path))
			await Bun.write(path, buffer)
			return path
		}

		return undefined
	}

	// Keeps the frames of the path, and of the camera when given, alive for another expiration window.
	ping(path: string, camera?: string, now?: number) {
		now ??= performance.now()

		for (const [key, entry] of this.sources) {
			if (key === path || (camera !== undefined && entry.item.camera === camera)) {
				entry.date = now
			}
		}

		for (const [key, entries] of this.transformed) {
			if (key === path || (camera !== undefined && entries[0]?.item.source.camera === camera)) {
				for (const entry of entries) entry.date = now
			}
		}
	}

	// Releases the frames of the path, and of the camera when given, because nothing is viewing them
	// anymore. The next request rebuilds them from the filesystem, or from the next captured frame.
	close(path: string, camera?: string) {
		this.ping(path, camera, Number.NEGATIVE_INFINITY)
		this.clear()
	}

	// Drops every source and transformed frame untouched for longer than the expiration window.
	clear() {
		let deleted = false
		const now = performance.now()

		for (const [key, entries] of this.transformed) {
			const alive = entries.filter((entry) => now - entry.date < DEFAULT_IMAGE_EXPIRES_IN)

			if (alive.length !== entries.length) {
				if (alive.length > 0) this.transformed.set(key, alive)
				else this.transformed.delete(key)

				console.info('deleted transformed image at', key)
				deleted = true
			}
		}

		for (const [key, { date, item }] of this.sources) {
			if (now - date >= DEFAULT_IMAGE_EXPIRES_IN) {
				this.sources.delete(key)
				console.info('deleted buffered image at', item.path)
				deleted = true
			}
		}

		if (deleted) {
			Bun.gc(false)
		}
	}
}
