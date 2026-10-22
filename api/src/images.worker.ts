import { open } from 'fs/promises'
import { basename } from 'path'
import { readImageFromFits, readImageFromXisf, writeImageToFits, writeImageToFormat, writeImageToXisf } from 'nebulosa/src/imaging/model/image'
import type { CfaPattern, Image, ImageChannel } from 'nebulosa/src/imaging/model/types'
import { clone } from 'nebulosa/src/imaging/processing/arithmetic'
import { adf } from 'nebulosa/src/imaging/processing/computation'
import { debayer } from 'nebulosa/src/imaging/processing/debayer'
import { grayscale, invert } from 'nebulosa/src/imaging/processing/geometry'
import { scnr } from 'nebulosa/src/imaging/processing/scnr'
import { stf } from 'nebulosa/src/imaging/processing/stf'
import { brightness, contrast, gamma, saturation } from 'nebulosa/src/imaging/processing/tone'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { Bitpix, type FitsHeader, readFits } from 'nebulosa/src/io/formats/fits/fits'
import { uncompressedBitpixKeyword } from 'nebulosa/src/io/formats/fits/util'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'
import { bufferSource } from 'nebulosa/src/io/io'
import type { Sink } from 'nebulosa/src/io/types'
import { cfaPattern, DisplayError, precisionOf, type DisplaySettings, type ImageCapture, type ImageFormat, imageAcquisition, type ImageInfo, ImageOpenError, type ImageProvenance, type ImageWorkerRequest, type ImageWorkerResponse, type RenderRequest, type RenderResult, type Stretch } from './images'

// Worker thread that owns the decoded pixels of every open image document and does all the heavy
// work on them: decoding FITS and XISF files and camera frames, the display pipeline, JPEG encoding, deriving new
// documents from the pipeline in floating point, encoding documents as files, and preparing the grayscale
// copies star detections measure on their own worker (stars.worker.ts). Keeping the
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
	// Name of the document, which a derived document's name and provenance start from.
	readonly name: string
	// Decoded image, in the normalized scale with the precision of its source (precisionOf) and the
	// min-max rescale of the read in its metadata; never modified.
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

// Seekable source of a FITS or XISF image: an open file or bytes in memory.
type ImageSource = ReturnType<typeof fileHandleSource> | ReturnType<typeof bufferSource>

// Reads the image of a FITS or XISF source with the precision its BITPIX needs (precisionOf); a FITS image
// is read with 64 bits when any of its HDUs needs them. Resolves to undefined when the source is neither,
// and throws whatever the decoder throws for a malformed one.
async function readImageFrom(source: ImageSource): Promise<{ readonly format: ImageFormat; readonly image: Image } | undefined> {
	const fits = await readFits(source)
	const fitsPrecision = fits && (fits.hdus.some((hdu) => precisionOf(uncompressedBitpixKeyword(hdu.header, 0)) === 64) ? 64 : 32)
	const fitsImage = fits && (await readImageFromFits(fits, source, fitsPrecision))
	if (fitsImage) return { format: 'fits', image: fitsImage }

	source.seek(0)
	const xisf = await readXisf(source)
	const xisfImage = xisf?.images[0] && (await readImageFromXisf(xisf, source, precisionOf(xisf.images[0].bitpix)))
	if (xisfImage) return { format: 'xisf', image: xisfImage }

	return undefined
}

// Reads the image of a FITS or XISF file (see readImageFrom). Throws ImageOpenError.
async function readImage(path: string): Promise<{ readonly format: ImageFormat; readonly image: Image }> {
	let handle

	try {
		handle = await open(path, 'r')
	} catch (error) {
		throw new ImageOpenError(path, 404, error)
	}

	// Disposing the source closes the file.
	await using source = fileHandleSource(handle)
	let read

	try {
		read = await readImageFrom(source)
	} catch (error) {
		throw new ImageOpenError(path, 415, error)
	}

	if (!read) throw new ImageOpenError(path, 415)
	return read
}

// Properties of a new document holding a decoded image, under a fresh id.
function documentProperties(name: string, image: Image) {
	const { width, height, channels, bayer } = image.metadata
	const cfa = cfaPattern(image.header, channels)
	return { id: crypto.randomUUID(), name, width, height, channels, header: image.header, acquisition: imageAcquisition(image.header), ...(bayer && { bayer }), ...(cfa && { cfa }) }
}

// Keeps the decoded image of a new document and returns its info.
function addDocument(info: ImageInfo, image: Image): ImageInfo {
	documents.set(info.id, { name: info.name, image, cfa: info.cfa, autoStretches: new Map() })
	return info
}

// Opens the FITS or XISF file at path as a new document. Throws ImageOpenError.
async function openDocument(path: string): Promise<ImageInfo> {
	const { format, image } = await readImage(path)
	return addDocument({ origin: 'file', path, format, ...documentProperties(basename(path), image) }, image)
}

// Opens a camera frame, the bytes of a FITS or XISF file, as a new document named name. Throws when the
// bytes are not one.
async function openCapture(bytes: Uint8Array<ArrayBuffer>, name: string, capture: ImageCapture): Promise<ImageInfo> {
	const read = await readImageFrom(bufferSource(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)))
	if (!read) throw new Error('The camera frame is not a FITS or XISF image')
	return addDocument({ origin: 'capture', format: read.format, ...capture, ...documentProperties(name, read.image) }, read.image)
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

// Header keywords that no longer describe a derived image: integer scaling (the samples are floating
// point), data bounds, and the display stretch hints of the source.
const STALE_DERIVED_KEYWORDS = ['BZERO', 'BSCALE', 'DATAMIN', 'DATAMAX', 'CSTRETCH', 'CBLACK', 'CWHITE'] as const

// CFA keywords that no longer apply once an image is debayered.
const CFA_KEYWORDS = ['BAYERPAT', 'XBAYROFF', 'YBAYROFF'] as const

// Returns the header of a derived image: the source keywords with the geometry and floating-point
// BITPIX of the result, without the keywords that no longer hold, and with HISTORY recording the
// source, the time, and the settings applied.
function derivedHeader(image: Image, provenance: ImageProvenance): FitsHeader {
	const { width, height, channels } = image.metadata
	const header: FitsHeader = { ...image.header, BITPIX: image.raw instanceof Float64Array ? Bitpix.DOUBLE : Bitpix.FLOAT, NAXIS: channels === 3 ? 3 : 2, NAXIS1: width, NAXIS2: height, NAXIS3: channels === 3 ? 3 : undefined }
	for (const key of STALE_DERIVED_KEYWORDS) delete header[key]
	if (channels === 3) for (const key of CFA_KEYWORDS) delete header[key]
	if (header.NAXIS3 === undefined) delete header.NAXIS3
	const history = [`Derived by Nebulosa from ${provenance.sourceName} at ${provenance.createdAt}`, `Display pipeline: ${JSON.stringify(provenance.settings)}`]
	header.HISTORY = [header.HISTORY, ...history].filter((line) => typeof line === 'string' && line !== '').join('\n')
	return header
}

// Returns the name of a derived image: the source name without its extension, marked as processed.
function derivedName(sourceName: string): string {
	return `${sourceName.replace(/\.[^.]+$/, '')} — Processed`
}

// Derives a new document from a document by applying settings to its image: the result keeps the
// floating-point samples of the pipeline (and, in its metadata, the min-max rescale of the source
// read) instead of being encoded. Throws DisplayError for settings that cannot be applied.
function deriveDocument(source: string, entry: DocumentEntry, settings: DisplaySettings): ImageInfo {
	const { image, result } = displayImage(entry, settings)
	const provenance: ImageProvenance = { source, sourceName: entry.name, settings, createdAt: new Date().toISOString() }
	const header = derivedHeader(image, provenance)
	const { width, height, channels } = image.metadata
	const pixelSizeInBytes = image.raw.BYTES_PER_ELEMENT
	const derived: Image = { ...image, header, metadata: { ...image.metadata, bitpix: header.BITPIX as Bitpix, pixelSizeInBytes, strideInBytes: width * channels * pixelSizeInBytes } }
	// A mosaic left as is keeps its pattern; a debayered one has none.
	const cfa = result.cfa ? undefined : entry.cfa
	const name = derivedName(entry.name)
	const info: ImageInfo = { origin: 'derived', provenance, id: crypto.randomUUID(), name, width, height, channels, header, acquisition: imageAcquisition(header), ...(image.metadata.bayer && { bayer: image.metadata.bayer }), ...(cfa && { cfa }) }
	documents.set(info.id, { name, image: derived, cfa, autoStretches: new Map() })
	return info
}

// Sink collecting everything written to it, for encoding a file in memory.
class MemorySink implements Sink {
	// Copies of the chunks written, in order.
	readonly #chunks: Uint8Array[] = []

	// Appends size bytes of chunk from offset (characters for a string, encoded with encoding); returns
	// the bytes appended.
	writeSync(chunk: string | Buffer, offset: number = 0, size?: number, encoding?: BufferEncoding): number {
		const end = size === undefined ? undefined : offset + size
		// Writers reuse their buffers, so every chunk is copied.
		const bytes = typeof chunk === 'string' ? Buffer.from(chunk.slice(offset, end), encoding) : Uint8Array.prototype.slice.call(chunk, offset, end)
		this.#chunks.push(bytes)
		return bytes.byteLength
	}

	// Asynchronous counterpart of writeSync.
	write(chunk: string | Buffer, offset?: number, size?: number, encoding?: BufferEncoding): number {
		return this.writeSync(chunk, offset, size, encoding)
	}

	// Returns everything written as one transferable buffer.
	bytes(): Uint8Array<ArrayBuffer> {
		const output = new Uint8Array(this.#chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
		let offset = 0

		for (const chunk of this.#chunks) {
			output.set(chunk, offset)
			offset += chunk.byteLength
		}

		return output
	}
}

// Encodes a document as a FITS or XISF file in the scale of its source (sourceScale).
async function encodeDocument(entry: DocumentEntry, format: ImageFormat): Promise<Uint8Array<ArrayBuffer>> {
	const sink = new MemorySink()
	if (format === 'fits') await writeImageToFits(entry.image, sink, { sourceScale: true })
	else await writeImageToXisf(entry.image, sink, undefined, { sourceScale: true })
	return sink.bytes()
}

// Renders a document as JPEG with the requested settings, returning the bytes and the parameters applied.
function renderImage(entry: DocumentEntry, request: RenderRequest): { readonly jpeg: Uint8Array<ArrayBuffer>; readonly result: RenderResult } {
	const { image, result } = displayImage(entry, request.settings)
	const jpeg = writeImageToFormat(image, 'jpeg', { jpeg: { quality: RENDER_QUALITY } })!
	// A Buffer may be a view of a larger shared pool, which must not be transferred along with it.
	const bytes = jpeg.byteOffset === 0 && jpeg.byteLength === jpeg.buffer.byteLength ? new Uint8Array(jpeg.buffer as ArrayBuffer) : new Uint8Array(jpeg)
	return { jpeg: bytes, result }
}

// Returns the grayscale copy of a document a star detection measures (see ImageStore.detectionImage): a
// clone of a mono image, the luminance of an RGB image, or the luminance of a CFA mosaic debayered with
// its trusted pattern, reusing the debayered image of a rendering. The result owns a buffer of its own that
// can be transferred, and names no Bayer pattern.
function detectionImage(entry: DocumentEntry): Image {
	const { image, cfa } = entry
	let source = image

	if (image.metadata.channels === 1 && cfa) {
		if (entry.debayered?.pattern === cfa) source = entry.debayered.image
		else source = debayer(image, cfa) ?? image
	}

	// grayscale returns a mono image itself, which must not be handed over.
	const mono = source.metadata.channels === 1 ? clone(source) : grayscale(source)
	const raw = mono.raw.byteOffset === 0 && mono.raw.byteLength === mono.raw.buffer.byteLength ? mono.raw : mono.raw.slice()
	return { ...mono, raw, metadata: { ...mono.metadata, bayer: undefined } }
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

	if (request.type === 'derive' || request.type === 'encode' || request.type === 'detectionImage') {
		const entry = documents.get(request.document)

		if (!entry) {
			reply({ id: request.id, status: 'missing' })
			return
		}

		try {
			if (request.type === 'derive') {
				reply({ id: request.id, status: 'derived', info: deriveDocument(request.document, entry, request.request.settings) })
			} else if (request.type === 'detectionImage') {
				const image = detectionImage(entry)
				reply({ id: request.id, status: 'detectionImage', image }, [image.raw.buffer])
			} else {
				const bytes = await encodeDocument(entry, request.format)
				reply({ id: request.id, status: 'encoded', bytes }, [bytes.buffer])
			}
		} catch (error) {
			if (error instanceof DisplayError) reply({ id: request.id, status: 'invalid', error: error.message })
			else reply({ id: request.id, status: 'failed', error: Error.isError(error) ? error.message : String(error) })
		}

		return
	}

	if (request.type === 'openCapture') {
		try {
			reply({ id: request.id, status: 'opened', info: await openCapture(request.bytes, request.name, request.capture) })
		} catch (error) {
			reply({ id: request.id, status: 'failed', error: Error.isError(error) ? error.message : String(error) })
		}

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
