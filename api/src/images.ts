import { rename, rm } from 'fs/promises'
import { resolve } from 'path'
import { type CfaPattern, type Image, type ImageChannel, shiftCfaPattern } from 'nebulosa/src/imaging/model/types'
import type { SCNRProtectionMethod } from 'nebulosa/src/imaging/processing/scnr'
import type { FitsHeader, FitsHeaderKey } from 'nebulosa/src/io/formats/fits/fits'
import { cfaPatternKeyword, exposureTimeKeyword, numericKeyword, observationDateKeyword, textKeyword } from 'nebulosa/src/io/formats/fits/util'
import { errorResponse } from './http'

// Image documents opened by clients: FITS and XISF files read from the server's filesystem, or camera
// frames handed over by the capture service, kept decoded in memory under an id until they are closed, so later renderings (and future
// processing) work on the same pixels. Each rendering applies a complete set of display settings
// (debayer, stretch, tone, and color) to a copy of the decoded image, never to the image itself, and is
// sent as JPEG; the parameters actually applied are returned alongside it. Decoding and rendering run on
// a worker thread (images.worker.ts) that also holds the pixels, so a large image never blocks the
// requests the server is handling meanwhile. A rendering still queued when a newer one of the same
// document arrives, or whose request is aborted, is dropped without being computed.
//
// A document can be retained by an analysis while it uses the pixels, such as a star detection: closing it then
// hides it from every route at once, but its pixels are released only when the last analysis lets it go.
//
// A document can also be derived from another by applying display settings in floating point: the
// result is a new, independent document that lives only in memory until it is saved to a file of the
// server or downloaded. Saving never replaces the file of an open document, nor an existing file
// without overwrite, and writes through a temporary file so a failure leaves no partial file.

// Formats an image document can be read from.
export type ImageFormat = 'fits' | 'xisf'

// Where a derived image comes from: the document and the display settings it was computed with.
export interface ImageProvenance {
	// Id of the source document.
	readonly source: string
	// Name of the source document.
	readonly sourceName: string
	// Settings applied to the source image, in pipeline order.
	readonly settings: DisplaySettings
	// When the image was derived, as an ISO 8601 UTC date-time.
	readonly createdAt: string
}

// Camera frame an image document was decoded from, as the capture service received it.
export interface ImageCapture {
	// Id of the open connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Identity of the frame, unique across captures: the capture session id and the frame generation.
	readonly frameId: string
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// Absolute path of the file the frame is saved to; absent when it is only previewed. The file may not be
	// written yet, or its write may have failed: the capture service reports that.
	readonly path?: string
}

// Origin of an image document: a file read from the server, an image derived from another document, which
// lives only in memory until it is saved, or a camera frame, which lives only in memory whether or not the
// capture also saved it to a file.
export type ImageOrigin = { readonly origin: 'file'; readonly path: string; readonly format: ImageFormat } | { readonly origin: 'derived'; readonly provenance: ImageProvenance } | ({ readonly origin: 'capture'; readonly format: ImageFormat } & ImageCapture)

// Description of an open image document.
export type ImageInfo = ImageOrigin & ImageProperties

// Properties of an open image document, whatever its origin.
export interface ImageProperties {
	// Id of the document, used by every later request.
	readonly id: string
	// File name, or the name of a derived image.
	readonly name: string
	// Width, in pixels.
	readonly width: number
	// Height, in pixels.
	readonly height: number
	// Number of channels: 1 for grayscale or a raw CFA mosaic, 3 for RGB.
	readonly channels: number
	// Bayer pattern of a raw CFA mosaic as written in the header (BAYERPAT), such as RGGB; absent otherwise.
	readonly bayer?: string
	// CFA pattern at the image origin: BAYERPAT when it is a known pattern, shifted by the XBAYROFF and
	// YBAYROFF offsets; absent when the image is not a mono CFA mosaic or its pattern cannot be trusted.
	readonly cfa?: CfaPattern
	// FITS-compatible header of the image (for XISF, its FITS keywords).
	readonly header: FitsHeader
	// Acquisition data normalized from the header.
	readonly acquisition: ImageAcquisition
}

// Pixel binning of an acquisition.
export interface Binning {
	// Horizontal binning factor, in sensor pixels per image pixel.
	readonly x: number
	// Vertical binning factor, in sensor pixels per image pixel.
	readonly y: number
}

// Acquisition data of an image, read from its header once with every equivalent keyword resolved, so a
// datum present under several conventions (such as EXPTIME and EXPOSURE) appears only once. A datum
// absent from the header, blank, or not a finite number is absent.
export interface ImageAcquisition {
	// Name of the observed object (OBJECT).
	readonly object?: string
	// Start of the observation as an ISO 8601 UTC date-time (DATE-OBS, then DATE-END, then DATE).
	readonly date?: string
	// Exposure duration, in seconds (EXPTIME, then EXPOSURE).
	readonly exposure?: number
	// Filter name (FILTER).
	readonly filter?: string
	// Sensor gain, in the camera's units (GAIN).
	readonly gain?: number
	// Sensor offset, in the camera's units (OFFSET).
	readonly offset?: number
	// Sensor temperature, in degrees Celsius (CCD-TEMP).
	readonly temperature?: number
	// Pixel binning (XBINNING; YBINNING, defaulting to XBINNING).
	readonly binning?: Binning
	// Camera name (INSTRUME).
	readonly camera?: string
	// Telescope name (TELESCOP).
	readonly telescope?: string
	// Focal length, in millimeters (FOCALLEN).
	readonly focalLength?: number
}

// Returns a keyword as trimmed text, absent when missing or blank.
function textValue(header: FitsHeader, key: FitsHeaderKey): string | undefined {
	return textKeyword(header, key).trim() || undefined
}

// Returns a finite number, absent otherwise.
function finite(value: number | undefined): number | undefined {
	return value !== undefined && Number.isFinite(value) ? value : undefined
}

// Returns a keyword as a finite number, absent when missing or not numeric.
function numberValue(header: FitsHeader, key: FitsHeaderKey): number | undefined {
	return finite(numericKeyword<number, undefined>(header, key, undefined))
}

// Normalizes the acquisition data of an image header.
export function imageAcquisition(header: FitsHeader): ImageAcquisition {
	const date = observationDateKeyword(header)
	const x = numberValue(header, 'XBINNING')

	return {
		object: textValue(header, 'OBJECT'),
		date: date === undefined ? undefined : new Date(date).toISOString(),
		exposure: finite(exposureTimeKeyword<number, undefined>(header, undefined)),
		filter: textValue(header, 'FILTER'),
		gain: numberValue(header, 'GAIN'),
		offset: numberValue(header, 'OFFSET'),
		temperature: numberValue(header, 'CCD-TEMP'),
		binning: x === undefined ? undefined : { x, y: numberValue(header, 'YBINNING') ?? x },
		camera: textValue(header, 'INSTRUME'),
		telescope: textValue(header, 'TELESCOP'),
		focalLength: numberValue(header, 'FOCALLEN'),
	}
}

// Known CFA patterns, the valid values of BAYERPAT.
const CFA_PATTERNS: ReadonlySet<string> = new Set<CfaPattern>(['RGGB', 'BGGR', 'GBRG', 'GRBG', 'GRGB', 'GBGR', 'RGBG', 'BGRG'])

// Returns whether a value is a known CFA pattern.
function isCfaPattern(value: string | undefined): value is CfaPattern {
	return value !== undefined && CFA_PATTERNS.has(value)
}

// Returns the CFA pattern at the origin of an image from its header: BAYERPAT shifted by the integer
// XBAYROFF and YBAYROFF offsets, in pixels (0 when absent). Absent for an image with more than one
// channel, an unknown pattern, or non-integer offsets, so no pattern is ever assumed.
export function cfaPattern(header: FitsHeader, channels: number): CfaPattern | undefined {
	const pattern = cfaPatternKeyword(header)?.toUpperCase()
	if (channels !== 1 || !isCfaPattern(pattern)) return undefined
	const x = numericKeyword(header, 'XBAYROFF', 0)
	const y = numericKeyword(header, 'YBAYROFF', 0)
	return Number.isInteger(x) && Number.isInteger(y) ? shiftCfaPattern(pattern, x, y) : undefined
}

// Returns the sample precision, in bits, that keeps every value of a source with a FITS BITPIX: 64 for
// 32-bit integers and 64-bit floats, which a 24-bit float mantissa would round; 32 otherwise, which is
// exact for 8- and 16-bit integers and 32-bit floats at half the memory.
export function precisionOf(bitpix: number): 32 | 64 {
	return bitpix === 32 || bitpix === -64 ? 64 : 32
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

// Stretch of a rendering: computed from the image statistics (auto; linked computes one stretch from
// the luminance, unlinked one per RGB channel), explicit (manual), or none (linear).
export type DisplayStretch = { readonly mode: 'auto'; readonly linked: boolean } | { readonly mode: 'manual'; readonly stretch: Stretch } | { readonly mode: 'linear' }

// Debayering of a mono CFA mosaic: off, or with the pattern of the image (auto, its ImageInfo cfa) or
// an explicit one. Ignored for an image that is not mono.
export type DisplayDebayer = { readonly enabled: false } | { readonly enabled: true; readonly pattern: 'auto' | CfaPattern }

// Removal of a color cast from one channel (SCNR), applied only to RGB renderings. The amount is in [0, 1].
export type DisplayScnr = { readonly enabled: false } | { readonly enabled: true; readonly channel: ImageChannel; readonly amount: number; readonly method: SCNRProtectionMethod }

// Complete settings of a rendering, applied in this order: debayer, stretch, brightness, contrast,
// gamma, saturation, SCNR, invert. Neutral values leave the image unchanged.
export interface DisplaySettings {
	// Debayering of a CFA mosaic.
	readonly debayer: DisplayDebayer
	// Display stretch.
	readonly stretch: DisplayStretch
	// Brightness factor, non-negative; 1 is neutral.
	readonly brightness: number
	// Contrast factor around mid-gray, non-negative; 1 is neutral.
	readonly contrast: number
	// Gamma, positive; 1 is neutral.
	readonly gamma: number
	// Saturation factor of RGB renderings, non-negative; 1 is neutral.
	readonly saturation: number
	// Color cast removal of RGB renderings.
	readonly scnr: DisplayScnr
	// Whether to invert the rendering.
	readonly invert: boolean
}

// Body of a render request.
export interface RenderRequest {
	// Settings to render with.
	readonly settings: DisplaySettings
}

// Rendering parameters actually applied, sent as JSON in the RENDER_HEADER response header.
export interface RenderResult {
	// Stretch applied: one for every sample, or one per RGB channel (red, green, blue) for an unlinked
	// auto stretch. An auto stretch reports the parameters computed from the image; linear reports the
	// identity (midtone 0.5, shadow 0, highlight 1).
	readonly stretch: readonly Stretch[]
	// CFA pattern the image was debayered with; absent when it was not.
	readonly cfa?: CfaPattern
	// Channels of the rendering: 1 for grayscale (including a raw CFA mosaic), 3 for RGB.
	readonly channels: 1 | 3
}

// A rendering of an image document.
export interface Rendering {
	// JPEG-encoded image.
	readonly jpeg: Uint8Array<ArrayBuffer>
	// Rendering parameters actually applied.
	readonly result: RenderResult
}

// Body of a derive request.
export interface DeriveRequest {
	// Settings to apply to the source image.
	readonly settings: DisplaySettings
}

// Body of a save request.
export interface SaveRequest {
	// Absolute path of the file to write on the server.
	readonly path: string
	// Format to write.
	readonly format: ImageFormat
	// Whether an existing file may be replaced.
	readonly overwrite?: boolean
}

// Result of a save.
export interface SaveResult {
	// Absolute path of the written file.
	readonly path: string
}

// Message sent to the image worker. Open, open capture, render, derive, encode, and detection image carry an
// id that their response echoes; open capture transfers its bytes to the worker; a close has no response, and a
// cancel drops the render with that id if it has not started yet (the render then answers superseded).
export type ImageWorkerRequest =
	| { readonly type: 'open'; readonly id: number; readonly path: string }
	| { readonly type: 'openCapture'; readonly id: number; readonly bytes: Uint8Array<ArrayBuffer>; readonly name: string; readonly capture: ImageCapture }
	| { readonly type: 'render'; readonly id: number; readonly document: string; readonly request: RenderRequest }
	| { readonly type: 'derive'; readonly id: number; readonly document: string; readonly request: DeriveRequest }
	| { readonly type: 'encode'; readonly id: number; readonly document: string; readonly format: ImageFormat; readonly omit?: readonly string[] }
	| { readonly type: 'detectionImage'; readonly id: number; readonly document: string }
	| { readonly type: 'cancel'; readonly id: number }
	| { readonly type: 'close'; readonly document: string }

// Message the image worker answers a request with, by request id: the opened or derived document, the
// rendering, the encoded file, the grayscale copy a star detection measures (see ImageStore.detectionImage), a document that is not open (missing), a render dropped before it
// started (superseded), settings that cannot be applied to the image (invalid), a file that cannot be
// opened (with the status of its ImageOpenError), or any other failure.
export type ImageWorkerResponse =
	| { readonly id: number; readonly status: 'opened'; readonly info: ImageInfo }
	| { readonly id: number; readonly status: 'derived'; readonly info: ImageInfo }
	| { readonly id: number; readonly status: 'encoded'; readonly bytes: Uint8Array<ArrayBuffer> }
	| { readonly id: number; readonly status: 'detectionImage'; readonly image: Image }
	| ({ readonly id: number; readonly status: 'rendered' } & Rendering)
	| { readonly id: number; readonly status: 'missing' }
	| { readonly id: number; readonly status: 'superseded' }
	| { readonly id: number; readonly status: 'invalid'; readonly error: string }
	| { readonly id: number; readonly status: 'unopenable'; readonly path: string; readonly httpStatus: 404 | 415 }
	| { readonly id: number; readonly status: 'failed'; readonly error: string }

// Outcome of a render: the rendering, or why there is none (see ImageWorkerResponse).
export type RenderOutcome = ({ readonly status: 'rendered' } & Rendering) | { readonly status: 'missing' } | { readonly status: 'superseded' } | { readonly status: 'invalid'; readonly error: string }

// Response header carrying the RenderResult of a rendering.
export const RENDER_HEADER = 'X-Image-Render'

// Error of display settings that cannot be applied to an image, such as debayering without a pattern.
export class DisplayError extends Error {}

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

// Worker thread of the image documents. `unref` is a Bun extension that the DOM Worker type, which
// takes precedence in this project, lacks.
type ImageWorker = Worker & Pick<Bun.Worker, 'unref'>

// Request to the image worker that is answered with a response.
type AnsweredRequest = Extract<ImageWorkerRequest, { readonly id: number }>

// Error a response that is not the expected outcome of its request stands for.
function responseError(response: ImageWorkerResponse): Error {
	if (response.status === 'unopenable') return new ImageOpenError(response.path, response.httpStatus)
	if (response.status === 'failed') return new Error(response.error)
	return new Error(`Unexpected image worker response: ${response.status}`)
}

// Outcome of a derive: the new document, or why there is none (see ImageWorkerResponse).
export type DeriveOutcome = { readonly status: 'derived'; readonly info: ImageInfo } | { readonly status: 'missing' } | { readonly status: 'invalid'; readonly error: string }

// Outcome of a save: the written file, or why nothing was written: the document is not open (missing),
// the target is the file of an open document (original), or it exists and overwriting was not allowed.
export type SaveOutcome = { readonly status: 'saved'; readonly path: string } | { readonly status: 'missing' } | { readonly status: 'original' } | { readonly status: 'exists' }

// Returns an absolute path in a form two equal paths share: lowercase on Windows, whose filesystem
// ignores case.
function comparablePath(path: string): string {
	return process.platform === 'win32' ? path.toLowerCase() : path
}

// What the server thread knows of an open document.
interface DocumentRecord {
	// Name of the document, for downloads.
	readonly name: string
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
	// Absolute path of the file of a file document, or the file a captured frame is saved to; absent for a
	// derived document and a frame that is only previewed.
	readonly path?: string
	// FITS-compatible header of the image.
	readonly header: FitsHeader
	// Acquisition data normalized from the header.
	readonly acquisition: ImageAcquisition
}

// Metadata of an open or retained document, for an analysis that derives hints from it.
export interface DocumentMetadata extends DocumentSize {
	// FITS-compatible header of the image.
	readonly header: FitsHeader
	// Acquisition data normalized from the header.
	readonly acquisition: ImageAcquisition
}

// Size of a retained document, in pixels.
export interface DocumentSize {
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
}

// Receives the id of a document whose pixels were released: closed with nothing retaining it, its last
// retention released after it was closed, or lost with the worker.
export type ImageDiscardListener = (id: string) => void

// Retentions of a document by analyses, and its record, which outlives a close while it is retained.
interface Retention {
	// Record of the document.
	readonly record: DocumentRecord
	// Number of retentions not released yet; always positive.
	holds: number
}

// Returns the record of a document from its description, without a path.
function documentRecord({ name, width, height, header, acquisition }: ImageInfo): DocumentRecord {
	return { name, width, height, header, acquisition }
}

// Open image documents of every client. The pixels live in the image worker; this side tracks the
// open ids, so unknown ones are answered without a round trip, and relays requests to the worker.
export class ImageStore {
	// Open documents, by id.
	readonly #documents = new Map<string, DocumentRecord>()
	// Retained documents, open or closed, by id.
	readonly #retained = new Map<string, Retention>()
	// Receivers of released documents.
	readonly #discardListeners = new Set<ImageDiscardListener>()
	// Requests sent to the worker and not answered yet, by request id.
	readonly #pending = new Map<number, PromiseWithResolvers<ImageWorkerResponse>>()
	// Id of the next request.
	#id = 0
	// Worker started on first use and kept for the lifetime of the process.
	#worker?: ImageWorker

	// Opens the FITS or XISF file at path as a new document. Throws ImageOpenError.
	async open(path: string): Promise<ImageInfo> {
		const response = await this.#request({ type: 'open', id: this.#id++, path })
		if (response.status !== 'opened') throw responseError(response)
		this.#documents.set(response.info.id, { ...documentRecord(response.info), path: resolve(path) })
		return response.info
	}

	// Opens a camera frame, the bytes of a FITS or XISF file, as a new document named name. The bytes are
	// transferred to the worker, so the caller must not use them afterwards. Throws when they are not a
	// readable FITS or XISF image.
	async openCapture(bytes: Uint8Array<ArrayBuffer>, name: string, capture: ImageCapture): Promise<ImageInfo> {
		const response = await this.#request({ type: 'openCapture', id: this.#id++, bytes, name, capture }, [bytes.buffer])
		if (response.status !== 'opened') throw responseError(response)
		this.#documents.set(response.info.id, { ...documentRecord(response.info), path: capture.path === undefined ? undefined : resolve(capture.path) })
		return response.info
	}

	// Renders a document as JPEG with the requested settings. Resolves to missing for an unknown id,
	// including one closed while the rendering was queued, and to superseded when a newer rendering of
	// the same document, or an abort of signal, dropped it before it started.
	async render(id: string, request: RenderRequest, signal?: AbortSignal): Promise<RenderOutcome> {
		if (!this.#documents.has(id)) return { status: 'missing' }
		if (signal?.aborted) return { status: 'superseded' }
		const requestId = this.#id++
		const cancel = () => this.#post({ type: 'cancel', id: requestId })
		signal?.addEventListener('abort', cancel, { once: true })

		try {
			const response = await this.#request({ type: 'render', id: requestId, document: id, request })
			if (response.status === 'rendered') return { status: 'rendered', jpeg: response.jpeg, result: response.result }
			if (response.status === 'missing' || response.status === 'superseded') return { status: response.status }
			if (response.status === 'invalid') return { status: 'invalid', error: response.error }
			throw responseError(response)
		} finally {
			signal?.removeEventListener('abort', cancel)
		}
	}

	// Derives a new document from a document by applying settings to its image, keeping floating-point
	// samples. Resolves to missing for an unknown id and to invalid when the settings cannot be applied.
	async derive(id: string, request: DeriveRequest): Promise<DeriveOutcome> {
		if (!this.#documents.has(id)) return { status: 'missing' }
		const response = await this.#request({ type: 'derive', id: this.#id++, document: id, request })

		if (response.status === 'derived') {
			this.#documents.set(response.info.id, documentRecord(response.info))
			return { status: 'derived', info: response.info }
		}

		if (response.status === 'missing') return { status: 'missing' }
		if (response.status === 'invalid') return { status: 'invalid', error: response.error }
		throw responseError(response)
	}

	// Encodes a document as a FITS or XISF file in the scale of its source. Resolves to undefined for an
	// unknown id.
	encode(id: string, format: ImageFormat): Promise<Uint8Array<ArrayBuffer> | undefined> {
		if (!this.#documents.has(id)) return Promise.resolve(undefined)
		return this.#encode(id, format)
	}

	// Encodes an open or retained document as a FITS file in the scale of its source, for a program that reads
	// files, such as ASTAP, leaving out the header keywords named in omit (such as the pointing a blind plate solve
	// must not use). The document itself is unchanged. Resolves to undefined when it is neither open nor retained.
	detectionFile(id: string, omit?: readonly string[]): Promise<Uint8Array<ArrayBuffer> | undefined> {
		if (!this.#documents.has(id) && !this.#retained.has(id)) return Promise.resolve(undefined)
		return this.#encode(id, 'fits', omit)
	}

	// Returns the size, header, and acquisition data of an open or retained document, or undefined when it is neither.
	metadata(id: string): DocumentMetadata | undefined {
		const record = this.#documents.get(id) ?? this.#retained.get(id)?.record
		return record && { width: record.width, height: record.height, header: record.header, acquisition: record.acquisition }
	}

	// Returns a new grayscale copy of an open or retained document for a star detection, owned by the caller,
	// whose buffer may be transferred: the mono image, the luminance of an RGB image, or the luminance of a mono
	// CFA mosaic debayered with its trusted pattern (ImageInfo cfa; a mosaic without one is measured as is). Its
	// metadata names no Bayer pattern, so the detector never debayers it again. Resolves to undefined when the
	// document is neither open nor retained.
	async detectionImage(id: string): Promise<Image | undefined> {
		if (!this.#documents.has(id) && !this.#retained.has(id)) return undefined
		const response = await this.#request({ type: 'detectionImage', id: this.#id++, document: id })
		if (response.status === 'detectionImage') return response.image
		if (response.status === 'missing') return undefined
		throw responseError(response)
	}

	// Asks the worker to encode a document, without the header keywords named in omit.
	async #encode(id: string, format: ImageFormat, omit?: readonly string[]): Promise<Uint8Array<ArrayBuffer> | undefined> {
		const response = await this.#request({ type: 'encode', id: this.#id++, document: id, format, ...(omit?.length && { omit }) })
		if (response.status === 'encoded') return response.bytes
		if (response.status === 'missing') return undefined
		throw responseError(response)
	}

	// Writes a document to a file of the server. Never replaces the file of an open document, nor any
	// existing file unless overwrite is set; the file appears only once completely written. Resolves to
	// missing for an unknown id, original for the file of an open document, and exists for an existing
	// file. Throws when the file cannot be written.
	async save(id: string, { path, format, overwrite = false }: SaveRequest): Promise<SaveOutcome> {
		if (!this.#documents.has(id)) return { status: 'missing' }
		const target = resolve(path)
		const key = comparablePath(target)
		for (const { path: source } of this.#documents.values()) if (source !== undefined && comparablePath(source) === key) return { status: 'original' }
		if (!overwrite && (await Bun.file(target).exists())) return { status: 'exists' }

		const bytes = await this.encode(id, format)
		if (!bytes) return { status: 'missing' }

		const temporary = `${target}.${crypto.randomUUID()}.tmp`

		try {
			await Bun.write(temporary, bytes)
			await rename(temporary, target)
		} catch (error) {
			await rm(temporary, { force: true })
			throw error
		}

		return { status: 'saved', path: target }
	}

	// Returns the name of an open document, or undefined for an unknown id.
	name(id: string): string | undefined {
		return this.#documents.get(id)?.name
	}

	// Closes a document: every route answers it as unknown from now on, and its pixels are released at once,
	// or when its last retention is released. Returns false for an unknown id.
	close(id: string): boolean {
		if (!this.#documents.delete(id)) return false
		if (!this.#retained.has(id)) this.#discard(id)
		return true
	}

	// Retains an open document, so its pixels stay until release(id) even if it is closed meanwhile. Every
	// retain must be balanced by one release. Returns the size of the image, or undefined for an unknown id,
	// which is not retained.
	retain(id: string): DocumentSize | undefined {
		const record = this.#documents.get(id)
		if (!record) return undefined
		const retention = this.#retained.get(id)
		if (retention) retention.holds++
		else this.#retained.set(id, { record, holds: 1 })
		return { width: record.width, height: record.height }
	}

	// Releases one retention of a document, releasing its pixels when it was the last one and the document
	// is closed. Ignored for a document that is not retained, such as one lost with the worker.
	release(id: string): void {
		const retention = this.#retained.get(id)
		if (!retention) return
		if (--retention.holds > 0) return
		this.#retained.delete(id)
		if (!this.#documents.has(id)) this.#discard(id)
	}

	// Registers a receiver of released documents and returns its unregistration.
	onDiscard(listener: ImageDiscardListener): VoidFunction {
		this.#discardListeners.add(listener)
		return () => this.#discardListeners.delete(listener)
	}

	// Releases the pixels of a document that is neither open nor retained.
	#discard(id: string): void {
		this.#post({ type: 'close', document: id })
		for (const listener of this.#discardListeners) listener(id)
	}

	// Sends a request to the worker, transferring the given buffers, and resolves to its response.
	#request(request: AnsweredRequest, transfer: Transferable[] = []): Promise<ImageWorkerResponse> {
		const resolvers = Promise.withResolvers<ImageWorkerResponse>()
		this.#pending.set(request.id, resolvers)
		this.#post(request, transfer)
		return resolvers.promise
	}

	// Posts a message to the worker, starting it on first use. Messages are cloned except the transferred
	// buffers, which the worker owns afterwards.
	#post(message: ImageWorkerRequest, transfer: Transferable[] = []): void {
		this.#start().postMessage(message, transfer)
	}

	// Starts the worker on first use.
	#start(): Worker {
		if (this.#worker) return this.#worker

		// The compiled executable defines the embedded path of the worker (see app/build.ts); elsewhere it
		// is resolved next to this module.
		const worker = new Worker(process.env.NEBULOSA_IMAGE_WORKER ?? new URL('./images.worker.ts', import.meta.url)) as ImageWorker
		worker.addEventListener('message', (event: MessageEvent<ImageWorkerResponse>) => this.#settle(event.data))
		// A worker that dies, or fails to load at all, reports it here. Without this listener the requests
		// it was carrying would never settle.
		worker.addEventListener('error', (event) => this.#fail(event.message))
		// The worker is idle between requests and must not keep the process alive on its own.
		worker.unref()
		this.#worker = worker
		return worker
	}

	// Settles the request the response belongs to.
	#settle(response: ImageWorkerResponse): void {
		const resolvers = this.#pending.get(response.id)
		if (!resolvers) return
		this.#pending.delete(response.id)
		resolvers.resolve(response)
	}

	// Discards the worker, along with every document it held, and fails every request it was carrying.
	// The next request starts a fresh worker.
	#fail(reason: string): void {
		console.error('image worker failed:', reason)
		this.#worker?.terminate()
		this.#worker = undefined
		const lost = new Set([...this.#documents.keys(), ...this.#retained.keys()])
		this.#documents.clear()
		this.#retained.clear()
		for (const id of lost) for (const listener of this.#discardListeners) listener(id)

		const pending = [...this.#pending.values()]
		this.#pending.clear()

		for (const resolvers of pending) resolvers.reject(new Error(`image worker failed: ${reason}`))
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
		if (error instanceof ImageOpenError) return errorResponse(error.message, error.status, error.status === 404 ? 'notFound' : 'unsupportedFormat')
		throw error
	}
}

// Handles POST /api/images/:id/render with a RenderRequest: responds with the JPEG and its RenderResult
// in RENDER_HEADER, 404 when the document is not open, 409 when a newer rendering of the document or an
// aborted request dropped it, and 422 when the settings cannot be applied to the image.
export async function handleRenderImage(req: Request, id: string): Promise<Response> {
	const outcome = await images.render(id, (await req.json()) as RenderRequest, req.signal)
	if (outcome.status === 'missing') return errorResponse('Image not found', 404, 'notFound')
	if (outcome.status === 'superseded') return errorResponse('Rendering superseded', 409, 'superseded')
	if (outcome.status === 'invalid') return errorResponse(outcome.error, 422, 'invalidSettings')
	return new Response(outcome.jpeg, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', [RENDER_HEADER]: JSON.stringify(outcome.result) } })
}

// Handles POST /api/images/:id/derive with a DeriveRequest: responds 201 with the ImageInfo of the new,
// unsaved document, 404 when the source is not open, and 422 when the settings cannot be applied.
export async function handleDeriveImage(req: Request, id: string): Promise<Response> {
	const outcome = await images.derive(id, (await req.json()) as DeriveRequest)
	if (outcome.status === 'missing') return errorResponse('Image not found', 404, 'notFound')
	if (outcome.status === 'invalid') return errorResponse(outcome.error, 422, 'invalidSettings')
	return Response.json(outcome.info, { status: 201 })
}

// Handles POST /api/images/:id/save with a SaveRequest: responds with the SaveResult once the file is
// written, 404 when the document is not open, 409 when the target is the file of an open document or
// exists without overwrite, and 500 when the file cannot be written.
export async function handleSaveImage(req: Request, id: string): Promise<Response> {
	try {
		const outcome = await images.save(id, (await req.json()) as SaveRequest)
		if (outcome.status === 'missing') return errorResponse('Image not found', 404, 'notFound')
		if (outcome.status === 'original') return errorResponse('An open image is read from this file; choose another one', 409, 'original')
		if (outcome.status === 'exists') return errorResponse('The file already exists', 409, 'exists')
		return Response.json({ path: outcome.path } satisfies SaveResult)
	} catch (error) {
		return errorResponse(`Unable to write the file: ${Error.isError(error) ? error.message : String(error)}`, 500, 'writeFailed')
	}
}

// Extensions of the files of each format.
const FORMAT_EXTENSIONS: Readonly<Record<ImageFormat, string>> = { fits: 'fits', xisf: 'xisf' }

// Handles GET /api/images/:id/file?format=fits|xisf: responds with the document encoded as an attachment
// named after it, or 404 when it is not open.
export async function handleDownloadImage(req: Request, id: string): Promise<Response> {
	const format = (new URL(req.url).searchParams.get('format') ?? 'fits') as ImageFormat
	const bytes = await images.encode(id, format)
	if (!bytes) return errorResponse('Image not found', 404, 'notFound')
	const name = `${images.name(id) ?? 'image'}.${FORMAT_EXTENSIONS[format]}`
	// The plain filename keeps only ASCII for old clients; filename* carries the exact UTF-8 name.
	const disposition = `attachment; filename="${name.replaceAll(/[^\u0020-\u007E]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`
	return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': disposition, 'Cache-Control': 'no-store' } })
}
