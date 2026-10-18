import { open } from 'fs/promises'
import { basename } from 'path'
import { readImageFromFits, readImageFromXisf, writeImageToFormat } from 'nebulosa/src/imaging/model/image'
import type { CfaPattern, Image, ImageChannel } from 'nebulosa/src/imaging/model/types'
import { clone } from 'nebulosa/src/imaging/processing/arithmetic'
import { adf } from 'nebulosa/src/imaging/processing/computation'
import { debayer } from 'nebulosa/src/imaging/processing/debayer'
import { invert } from 'nebulosa/src/imaging/processing/geometry'
import { scnr } from 'nebulosa/src/imaging/processing/scnr'
import { stf } from 'nebulosa/src/imaging/processing/stf'
import { brightness, contrast, gamma, saturation } from 'nebulosa/src/imaging/processing/tone'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { readFits } from 'nebulosa/src/io/formats/fits/fits'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'
import { cfaPattern, DisplayError, type DisplaySettings, type ImageFormat, imageAcquisition, type ImageInfo, ImageOpenError, type ImageWorkerRequest, type ImageWorkerResponse, type RenderRequest, type RenderResult, type Stretch } from './images'

// Worker thread that owns the decoded pixels of every open image document and does all the heavy
// work on them: decoding FITS and XISF files, the display pipeline, and JPEG encoding. Keeping the
// pixels here means they are never copied between threads, and the server event loop stays free while
// a large image is decoded or rendered. Renderings run one at a time, always on a copy of the decoded
// image, which is never modified; opens overlap them only while reading. A rendering waits in a
// per-document queue slot until the worker is free, so a newer rendering of the same document, or a
// cancel, drops it without computing it.

declare const self: Worker

// JPEG quality of renderings, 0 to 100: visually lossless at a fraction of the size of quality 100.
const RENDER_QUALITY = 90

// RGB channels, in the order of a per-channel stretch.
const RGB_CHANNELS: readonly ImageChannel[] = ['RED', 'GREEN', 'BLUE']

// Identity stretch, reported for a linear rendering.
const LINEAR_STRETCH: Stretch = { midtone: 0.5, shadow: 0, highlight: 1 }

// Open document: its decoded image and what renderings derive from it, so repeated renderings neither
// debayer nor compute the auto stretch again. Everything is released when the document closes.
interface DocumentEntry {
	// Decoded image, in the normalized scale with 32-bit samples; never modified.
	readonly image: Image
	// CFA pattern of the image (ImageInfo cfa), if trusted.
	readonly cfa?: CfaPattern
	// Debayered image of the latest pattern used; replaced when another pattern is requested.
	debayered?: { readonly pattern: CfaPattern; readonly image: Image }
	// Auto stretches computed, by base image (pattern or 'mono') and linking.
	readonly autoStretches: Map<string, readonly Stretch[]>
}

// A rendering waiting for the worker.
interface QueuedRender {
	// Request id the response echoes.
	readonly id: number
	// Document to render.
	readonly document: string
	// Settings to render with.
	readonly request: RenderRequest
}

// Open documents, by document id.
const documents = new Map<string, DocumentEntry>()

// Renderings waiting for the worker, at most one per document, by document id, in arrival order.
const queue = new Map<string, QueuedRender>()

// Whether the queue is scheduled to be drained.
let draining = false

// Reads the image of a FITS or XISF file with 32-bit samples. Throws ImageOpenError.
async function readImage(path: string): Promise<{ readonly format: ImageFormat; readonly image: Image }> {
	let handle

	try {
		handle = await open(path, 'r')
	} catch (error) {
		throw new ImageOpenError(path, 404, error)
	}

	// Disposing the source closes the file.
	await using source = fileHandleSource(handle)

	try {
		const fits = await readFits(source)
		const fitsImage = fits && (await readImageFromFits(fits, source, 32))
		if (fitsImage) return { format: 'fits', image: fitsImage }

		source.seek(0)
		const xisf = await readXisf(source)
		const xisfImage = xisf && (await readImageFromXisf(xisf, source, 32))
		if (xisfImage) return { format: 'xisf', image: xisfImage }
	} catch (error) {
		throw new ImageOpenError(path, 415, error)
	}

	throw new ImageOpenError(path, 415)
}

// Opens the FITS or XISF file at path as a new document. Throws ImageOpenError.
async function openDocument(path: string): Promise<ImageInfo> {
	const { format, image } = await readImage(path)
	const { width, height, channels, bayer } = image.metadata
	const cfa = cfaPattern(image.header, channels)
	const info: ImageInfo = { id: crypto.randomUUID(), name: basename(path), path, format, width, height, channels, header: image.header, acquisition: imageAcquisition(image.header), ...(bayer && { bayer }), ...(cfa && { cfa }) }
	documents.set(info.id, { image, cfa, autoStretches: new Map() })
	return info
}

// Returns the image a rendering starts from: the decoded image, or its debayered copy when the
// settings debayer a mono image. The result is shared and must be cloned before modification. Throws
// DisplayError when no pattern is known or the image is too small to debayer.
function baseImage(entry: DocumentEntry, settings: DisplaySettings): { readonly image: Image; readonly cfa?: CfaPattern } {
	const { image } = entry
	if (!settings.debayer.enabled || image.metadata.channels !== 1) return { image }

	const pattern = settings.debayer.pattern === 'auto' ? entry.cfa : settings.debayer.pattern
	if (!pattern) throw new DisplayError('The image has no known CFA pattern; choose one to debayer it')
	if (entry.debayered?.pattern === pattern) return { image: entry.debayered.image, cfa: pattern }

	const debayered = debayer(image, pattern)
	if (!debayered) throw new DisplayError('The image is too small to debayer')
	entry.debayered = { pattern, image: debayered }
	return { image: debayered, cfa: pattern }
}

// Returns the auto stretch of a base image: one from the luminance when linked or mono, otherwise one
// per RGB channel. Memoized per base image and linking.
function autoStretch(entry: DocumentEntry, image: Image, cfa: CfaPattern | undefined, linked: boolean): readonly Stretch[] {
	const perChannel = !linked && image.metadata.channels === 3
	const key = `${cfa ?? 'mono'}:${perChannel}`
	const cached = entry.autoStretches.get(key)
	if (cached) return cached

	const stretches = (perChannel ? RGB_CHANNELS.map((channel) => adf(image, { channel })) : [adf(image)]).map(([midtone, shadow, highlight]) => ({ midtone, shadow, highlight }))
	entry.autoStretches.set(key, stretches)
	return stretches
}

// Applies the display settings to a copy of the document image in pipeline order (debayer, stretch,
// brightness, contrast, gamma, saturation, SCNR, invert), returning the rendered image and the
// parameters applied. Throws DisplayError for settings that cannot be applied to the image.
function displayImage(entry: DocumentEntry, settings: DisplaySettings): { readonly image: Image; readonly result: RenderResult } {
	const base = baseImage(entry, settings)
	const channels = base.image.metadata.channels === 3 ? 3 : 1
	const stretch = settings.stretch.mode === 'auto' ? autoStretch(entry, base.image, base.cfa, settings.stretch.linked) : settings.stretch.mode === 'manual' ? [settings.stretch.stretch] : [LINEAR_STRETCH]
	if (stretch.some((s) => !(s.shadow <= s.highlight))) throw new DisplayError('The stretch shadow must not exceed its highlight')

	const image = clone(base.image)

	if (stretch.length === 3) for (const [i, { midtone, shadow, highlight }] of stretch.entries()) stf(image, midtone, shadow, highlight, { channel: RGB_CHANNELS[i] })
	else stf(image, stretch[0].midtone, stretch[0].shadow, stretch[0].highlight)

	brightness(image, settings.brightness)
	contrast(image, settings.contrast)
	gamma(image, settings.gamma)

	if (channels === 3) {
		saturation(image, settings.saturation)
		if (settings.scnr.enabled) scnr(image, settings.scnr.channel, settings.scnr.amount, settings.scnr.method)
	}

	if (settings.invert) invert(image)

	return { image, result: { stretch, channels, ...(base.cfa && { cfa: base.cfa }) } }
}

// Renders a document as JPEG with the requested settings, returning the bytes and the parameters applied.
function renderImage(entry: DocumentEntry, request: RenderRequest): { readonly jpeg: Uint8Array<ArrayBuffer>; readonly result: RenderResult } {
	const { image, result } = displayImage(entry, request.settings)
	const jpeg = writeImageToFormat(image, 'jpeg', { jpeg: { quality: RENDER_QUALITY } })!
	// A Buffer may be a view of a larger shared pool, which must not be transferred along with it.
	const bytes = jpeg.byteOffset === 0 && jpeg.byteLength === jpeg.buffer.byteLength ? new Uint8Array(jpeg.buffer as ArrayBuffer) : new Uint8Array(jpeg)
	return { jpeg: bytes, result }
}

// Posts a response to the server thread, transferring the given buffers instead of copying them.
function reply(response: ImageWorkerResponse, transfer: Transferable[] = []): void {
	self.postMessage(response, transfer)
}

// Queues a rendering, superseding the one of the same document still waiting, and schedules the queue
// to be drained once the messages already received are handled.
function enqueue(render: QueuedRender): void {
	const previous = queue.get(render.document)
	if (previous) reply({ id: previous.id, status: 'superseded' })
	// Deleting first moves the document to the end of the arrival order.
	queue.delete(render.document)
	queue.set(render.document, render)

	if (!draining) {
		draining = true
		setImmediate(drain)
	}
}

// Computes the oldest queued rendering, then yields so that messages received meanwhile can supersede
// or cancel the remaining ones before the next is computed.
function drain(): void {
	const next = queue.values().next()

	if (next.done) {
		draining = false
		return
	}

	const { id, document, request } = next.value
	queue.delete(document)
	const entry = documents.get(document)

	try {
		if (!entry) {
			reply({ id, status: 'missing' })
		} else {
			const { jpeg, result } = renderImage(entry, request)
			reply({ id, status: 'rendered', jpeg, result }, [jpeg.buffer])
		}
	} catch (error) {
		if (error instanceof DisplayError) reply({ id, status: 'invalid', error: error.message })
		else reply({ id, status: 'failed', error: Error.isError(error) ? error.message : String(error) })
	}

	setImmediate(drain)
}

// Drops the queued rendering with a request id, answering it superseded. Ignored when it already started.
function cancel(id: number): void {
	for (const render of queue.values()) {
		if (render.id === id) {
			queue.delete(render.document)
			reply({ id, status: 'superseded' })
			return
		}
	}
}

// Handles a request and posts its response; a close has none.
async function handle(request: ImageWorkerRequest): Promise<void> {
	if (request.type === 'close') {
		documents.delete(request.document)
		const queued = queue.get(request.document)
		if (queued) reply({ id: queued.id, status: 'missing' })
		queue.delete(request.document)
		return
	}

	if (request.type === 'cancel') {
		cancel(request.id)
		return
	}

	if (request.type === 'render') {
		enqueue(request)
		return
	}

	try {
		reply({ id: request.id, status: 'opened', info: await openDocument(request.path) })
	} catch (error) {
		if (error instanceof ImageOpenError) reply({ id: request.id, status: 'unopenable', path: request.path, httpStatus: error.status })
		else reply({ id: request.id, status: 'failed', error: Error.isError(error) ? error.message : String(error) })
	}
}

self.addEventListener('message', (event: MessageEvent<ImageWorkerRequest>) => void handle(event.data))
