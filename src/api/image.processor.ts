import fs from 'fs/promises'
import { basename, join } from 'path'
import { plateSolutionFrom } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { writeImageToFits, writeImageToFormat, writeImageToXisf } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { declinationKeyword, rightAscensionKeyword } from 'nebulosa/src/io/formats/fits/util'
import { fileHandleSink } from 'nebulosa/src/io/io'
import type { ImageInfo, ImageTransformation } from '#/image'
import type { ImageAdjustment } from '#/image.adjustment'
import type { ImageCalibration, ImageCalibrationFile } from '#/image.calibration'
import type { ImageFFT } from '#/image.fft'
import type { ImageFilter } from '#/image.filter'
import type { ImageScnr } from '#/image.scnr'
import type { ImageStretch } from '#/image.stretch'
import { runImagePipeline } from './image.pipeline'
import type { ImagePipelineRequest, ImagePipelineResponse, ImagePipelineSource, ImageStretchLevels, TransformedFrame } from './image.pipeline'

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
	readonly image: Image
	// Transformation as requested, including the stretch levels written back into it.
	readonly transformation: ImageTransformation | false
	// Canonical form of `transformation`, used as the cache identity.
	readonly key: NormalizedTransformation
	// Levels the automatic stretch computed, retained so a cache hit reports them again.
	readonly stretch?: ImageStretchLevels
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

// Writes the levels the automatic stretch computed into the request, which is how the browser learns
// them. Also applied on a cache hit, so reusing a frame reports the same levels the frame was built
// with instead of whatever the request happened to carry.
function applyStretchLevels(transformation: ImageTransformation | false, levels?: ImageStretchLevels) {
	if (transformation === false || !levels) return
	const [midtone, shadow, highlight] = levels
	transformation.stretch.midtone = midtone
	transformation.stretch.shadow = shadow
	transformation.stretch.highlight = highlight
}

// Runs the transformation pipeline on a worker thread, so decoding, calibration, stretching, and
// convolution never block the event loop that is serving requests. A single worker handles every run:
// each one already saturates a core, and queueing them bounds how much pixel data is in flight.
//
// `bun build --compile` cannot yet resolve a worker entry point inside the standalone executable, so a
// compiled binary falls back to running the pipeline in process, exactly as it did before. The fallback
// is transparent to callers and should be removed once Bun bundles the worker.
class ImagePipelineRunner {
	private worker?: Worker
	private unavailable = false
	private id = 0
	private readonly pending = new Map<number, { readonly request: ImagePipelineRequest; readonly resolvers: PromiseWithResolvers<TransformedFrame | undefined> }>()

	// Applies the transformation to the source. Rejects when the source cannot be read at all, and
	// resolves to undefined when it was read but is not a decodable image.
	run(source: ImagePipelineSource, transformation: ImageTransformation | false) {
		const worker = this.start()
		if (!worker) return this.runInProcess({ id: this.id++, source, transformation })

		const request: ImagePipelineRequest = { id: this.id++, source, transformation }
		const resolvers = Promise.withResolvers<TransformedFrame | undefined>()
		this.pending.set(request.id, { request, resolvers })

		// Structure-cloned rather than transferred: the payload and the decoded frame it may carry belong
		// to the retained source and have to survive the call.
		worker.postMessage(request)

		return resolvers.promise
	}

	// Starts the worker on first use. Returns undefined once the worker has proven unusable.
	private start() {
		if (this.unavailable) return undefined
		if (this.worker) return this.worker

		try {
			const worker = new Worker(new URL('./image.pipeline.worker.ts', import.meta.url)) as Worker & { unref?: () => void }
			worker.addEventListener('message', (event: MessageEvent<ImagePipelineResponse>) => this.settle(event.data))
			// A worker that fails to load reports it here. Without this listener the pending requests would
			// never settle and every image request would hang forever.
			worker.addEventListener('error', (event) => this.fail(event.message))
			// The worker is idle between requests and must not keep the process alive on its own. `unref` is
			// a Bun extension to the web Worker and is missing from the DOM types.
			worker.unref?.()
			this.worker = worker
			return worker
		} catch (e) {
			this.fail(e instanceof Error ? e.message : String(e))
			return undefined
		}
	}

	// Settles the request the response belongs to. An unknown id means the request was already settled by
	// a worker failure and re-run in process.
	private settle(response: ImagePipelineResponse) {
		const pending = this.pending.get(response.id)
		if (!pending) return
		this.pending.delete(response.id)

		if (response.status === 'transformed') pending.resolvers.resolve({ image: response.image, stretch: response.stretch })
		else if (response.status === 'unreadable') pending.resolvers.resolve(undefined)
		else pending.resolvers.reject(new Error(response.error))
	}

	// Gives up on the worker and serves every request in process from now on, including the ones still
	// waiting for an answer that will never arrive.
	private fail(reason: string) {
		if (this.unavailable) return

		console.warn('image pipeline worker is unavailable, transforming in process:', reason)
		this.unavailable = true
		this.worker?.terminate()
		this.worker = undefined

		const pending = [...this.pending.values()]
		this.pending.clear()

		for (const { request, resolvers } of pending) resolvers.resolve(this.runInProcess(request))
	}

	// Runs the pipeline on this thread. The decoded frame of the source is copied first because the
	// pipeline works in place and the retained source has to stay pristine, which crossing a thread would
	// otherwise have taken care of.
	private runInProcess({ source, transformation }: ImagePipelineRequest) {
		return runImagePipeline(source.image ? { ...source, image: cloneImage(source.image) } : source, transformation)
	}
}

// Owns the frames the application has in memory and turns them into transformed and encoded images.
//
// Two layers with opposite lifetimes live here and must not be confused. Sources are authoritative:
// evicting one can lose a frame forever. Transformed frames are a cache: evicting one only costs the
// work to rebuild it, and they are keyed by the normalized transformation of the path they came from.
export class ImageProcessor {
	private readonly sources = new Map<string, CacheEntry<SourceImage>>()
	private readonly transformed = new Map<string, CacheEntry<TransformedImage>[]>()
	private readonly pipeline = new ImagePipelineRunner()

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
			applyStretchLevels(transformation, cached.stretch)
			return cached
		}

		const source = this.sources.get(path)?.item
		const frame = await this.pipeline.run({ path, buffer: source?.buffer, image: source?.image }, transformation)

		if (!frame) {
			console.warn('failed to open image at', path)
			return undefined
		}

		applyStretchLevels(transformation, frame.stretch)

		const item: TransformedImage = { source: source ?? { path, camera }, image: frame.image, transformation, key, stretch: frame.stretch }
		this.cache(path, item)
		console.info('image at', path, 'was transformed:', item.image.raw.byteLength)
		return item
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
