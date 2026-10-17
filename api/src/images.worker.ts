import { open } from 'fs/promises'
import { basename } from 'path'
import { readImageFromFits, readImageFromXisf, writeImageToFormat } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { clone } from 'nebulosa/src/imaging/processing/arithmetic'
import { adf } from 'nebulosa/src/imaging/processing/computation'
import { stf } from 'nebulosa/src/imaging/processing/stf'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { readFits } from 'nebulosa/src/io/formats/fits/fits'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'
import { type ImageFormat, imageAcquisition, type ImageInfo, ImageOpenError, type ImageWorkerRequest, type ImageWorkerResponse, type RenderRequest, type RenderResult } from './images'

// Worker thread that owns the decoded pixels of every open image document and does all the heavy
// work on them: decoding FITS and XISF files, stretching, and JPEG encoding. Keeping the pixels here
// means they are never copied between threads, and the server event loop stays free while a large
// image is decoded or rendered. Renderings run one at a time; opens overlap them only while reading.

declare const self: Worker

// JPEG quality of renderings, 0 to 100: visually lossless at a fraction of the size of quality 100.
const RENDER_QUALITY = 90

// Decoded images of the open documents, in the normalized scale with 32-bit samples, by document id.
const documents = new Map<string, Image>()

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
	const info: ImageInfo = { id: crypto.randomUUID(), name: basename(path), path, format, width, height, channels, header: image.header, acquisition: imageAcquisition(image.header), ...(bayer && { bayer }) }
	documents.set(info.id, image)
	return info
}

// Renders the image as JPEG with the requested stretch, returning the bytes and the parameters applied.
function renderImage(image: Image, request: RenderRequest): { readonly jpeg: Uint8Array<ArrayBuffer>; readonly result: RenderResult } {
	const [midtone, shadow, highlight] = request.stretch === 'auto' ? adf(image) : [request.stretch.midtone, request.stretch.shadow, request.stretch.highlight]
	const stretched = stf(clone(image), midtone, shadow, highlight)
	const jpeg = writeImageToFormat(stretched, 'jpeg', { jpeg: { quality: RENDER_QUALITY } })!
	// A Buffer may be a view of a larger shared pool, which must not be transferred along with it.
	const bytes = jpeg.byteOffset === 0 && jpeg.byteLength === jpeg.buffer.byteLength ? new Uint8Array(jpeg.buffer as ArrayBuffer) : new Uint8Array(jpeg)
	return { jpeg: bytes, result: { stretch: { midtone, shadow, highlight } } }
}

// Posts a response to the server thread, transferring the given buffers instead of copying them.
function reply(response: ImageWorkerResponse, transfer: Transferable[] = []): void {
	self.postMessage(response, transfer)
}

// Handles a request and posts its response; a close has none.
async function handle(request: ImageWorkerRequest): Promise<void> {
	if (request.type === 'close') {
		documents.delete(request.document)
		return
	}

	const { id } = request

	try {
		if (request.type === 'open') {
			reply({ id, status: 'opened', info: await openDocument(request.path) })
			return
		}

		const image = documents.get(request.document)

		if (!image) {
			reply({ id, status: 'missing' })
			return
		}

		const { jpeg, result } = renderImage(image, request.request)
		reply({ id, status: 'rendered', jpeg, result }, [jpeg.buffer])
	} catch (error) {
		if (error instanceof ImageOpenError && request.type === 'open') reply({ id, status: 'unopenable', path: request.path, httpStatus: error.status })
		else reply({ id, status: 'failed', error: Error.isError(error) ? error.message : String(error) })
	}
}

self.addEventListener('message', (event: MessageEvent<ImageWorkerRequest>) => void handle(event.data))
