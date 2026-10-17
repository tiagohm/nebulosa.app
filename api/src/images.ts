import { open } from 'fs/promises'
import { basename } from 'path'
import { readImageFromFits, readImageFromXisf, writeImageToFormat } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { clone } from 'nebulosa/src/imaging/processing/arithmetic'
import { adf } from 'nebulosa/src/imaging/processing/computation'
import { stf } from 'nebulosa/src/imaging/processing/stf'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { type FitsHeader, readFits } from 'nebulosa/src/io/formats/fits/fits'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'

// Image documents opened by clients: FITS and XISF files read from the server's filesystem and kept
// decoded in memory under an id until a client closes them, so later renderings (and future
// processing) work on the same pixels. Each rendering is computed from the decoded image on request
// and sent as JPEG; the rendering parameters actually applied are returned alongside it.

// Formats an image document can be read from.
export type ImageFormat = 'fits' | 'xisf'

// Description of an open image document.
export interface ImageInfo {
	// Id of the document, used by every later request.
	readonly id: string
	// File name.
	readonly name: string
	// Absolute path of the file on the server.
	readonly path: string
	// Format the file was read as.
	readonly format: ImageFormat
	// Width, in pixels.
	readonly width: number
	// Height, in pixels.
	readonly height: number
	// Number of channels: 1 for grayscale or a raw CFA mosaic, 3 for RGB.
	readonly channels: number
	// Bayer pattern of a raw CFA mosaic, such as RGGB; absent otherwise.
	readonly bayer?: string
	// FITS-compatible header of the image (for XISF, its FITS keywords).
	readonly header: FitsHeader
}

// Screen transfer function parameters, all in [0, 1] with shadow <= highlight.
export interface Stretch {
	// Midtone balance; 0.5 is linear.
	readonly midtone: number
	// Input level mapped to black.
	readonly shadow: number
	// Input level mapped to white.
	readonly highlight: number
}

// Body of a render request. Further transformations become further optional fields.
export interface RenderRequest {
	// Display stretch: computed from the image statistics (auto), or explicit.
	readonly stretch: 'auto' | Stretch
}

// Rendering parameters actually applied, sent as JSON in the RENDER_HEADER response header.
export interface RenderResult {
	// Stretch applied; for an auto stretch, the parameters computed from the image.
	readonly stretch: Stretch
}

// Response header carrying the RenderResult of a rendering.
export const RENDER_HEADER = 'X-Image-Render'

// JPEG quality of renderings, 0 to 100: visually lossless at a fraction of the size of quality 100.
const RENDER_QUALITY = 90

// Error of an image that cannot be opened: missing file (404) or not a readable FITS or XISF image (415).
export class ImageOpenError extends Error {
	// HTTP status matching the failure.
	readonly status: 404 | 415

	// Creates the error of path with a status.
	constructor(path: string, status: 404 | 415, cause?: unknown) {
		super(status === 404 ? `File not found: ${path}` : `Not a FITS or XISF image: ${path}`, { cause })
		this.status = status
	}
}

// Open image document.
interface ImageDocument {
	// Description sent to clients.
	readonly info: ImageInfo
	// Decoded image, in the normalized scale with 32-bit samples.
	readonly image: Image
}

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

// Open image documents of every client, by id.
export class ImageStore {
	// Open documents by id.
	readonly #documents = new Map<string, ImageDocument>()

	// Opens the FITS or XISF file at path as a new document. Throws ImageOpenError.
	async open(path: string): Promise<ImageInfo> {
		const { format, image } = await readImage(path)
		const { width, height, channels, bayer } = image.metadata
		const info: ImageInfo = { id: crypto.randomUUID(), name: basename(path), path, format, width, height, channels, header: image.header, ...(bayer && { bayer }) }
		this.#documents.set(info.id, { info, image })
		return info
	}

	// Renders a document as JPEG with the requested stretch. Returns undefined for an unknown id.
	render(id: string, request: RenderRequest): { readonly jpeg: Buffer; readonly result: RenderResult } | undefined {
		const document = this.#documents.get(id)
		if (!document) return undefined

		const [midtone, shadow, highlight] = request.stretch === 'auto' ? adf(document.image) : [request.stretch.midtone, request.stretch.shadow, request.stretch.highlight]
		const stretched = stf(clone(document.image), midtone, shadow, highlight)
		const jpeg = writeImageToFormat(stretched, 'jpeg', { jpeg: { quality: RENDER_QUALITY } })!
		return { jpeg, result: { stretch: { midtone, shadow, highlight } } }
	}

	// Closes a document, releasing its pixels. Returns false for an unknown id.
	close(id: string): boolean {
		return this.#documents.delete(id)
	}
}

// Image documents of the server.
export const images = new ImageStore()

// Handles POST /api/images with { path }: responds 201 with the ImageInfo, 404 when the file does not
// exist, and 415 when it is not a FITS or XISF image.
export async function handleOpenImage(req: Request): Promise<Response> {
	const { path } = (await req.json()) as { readonly path: string }

	try {
		return Response.json(await images.open(path), { status: 201 })
	} catch (error) {
		if (error instanceof ImageOpenError) return Response.json({ error: error.message }, { status: error.status })
		throw error
	}
}

// Handles POST /api/images/:id/render with a RenderRequest: responds with the JPEG and its RenderResult
// in RENDER_HEADER, or 404 when the document is not open.
export async function handleRenderImage(req: Request, id: string): Promise<Response> {
	const rendering = images.render(id, (await req.json()) as RenderRequest)
	if (!rendering) return Response.json({ error: 'Image not found' }, { status: 404 })
	return new Response(new Uint8Array(rendering.jpeg), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', [RENDER_HEADER]: JSON.stringify(rendering.result) } })
}
