import { detectStars } from 'nebulosa/src/imaging/stars/detector'
import { bufferSource } from 'nebulosa/src/io/io'
import { decodeCameraBlobFromBase64 } from 'nebulosa/src/observation/capture/capture'
import { enrichGuideStars } from 'nebulosa/src/observation/guiding/tracker.star'
import type { GuidingWorkerRequest, GuidingWorkerResponse } from './guiding'
import { luminanceImage, readImageFrom } from './imagedecode'
import { cfaPattern } from './images'

// Worker thread of the guide frames of one guiding session. It receives the BLOB of one guide exposure at a time,
// decodes it (base64 or raw FITS/XISF), takes the grayscale copy star detection measures (the luminance of a color or
// a CFA frame with its trusted pattern), detects its stars with the toolkit detector and the settings of the request
// (none for a session whose stars ASTAP detects) and samples their peaks, and answers the grayscale image, its stars
// and the FITS/XISF bytes, all transferred, so neither the decoding nor the detection ever blocks the server event
// loop, nor competes with the renderings of the image worker. Positions are pixels of the full decoded frame, with the
// origin at the top-left.

declare const self: Worker

// Decodes and measures the frame of a request and posts the outcome.
async function handle({ jobId, bytes, encoding, detection }: GuidingWorkerRequest): Promise<void> {
	let response: GuidingWorkerResponse
	let transfer: Transferable[] = []

	try {
		const blob = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		const decoded = encoding === 'base64' ? await decodeCameraBlobFromBase64(blob) : blob
		const read = await readImageFrom(bufferSource(decoded))

		if (read === undefined) {
			response = { jobId, status: 'unsupported' }
		} else {
			const image = luminanceImage(read.image, cfaPattern(read.image.header, read.image.metadata.channels))
			// Without built-in settings the stars are detected by ASTAP on the server.
			const stars = detection ? enrichGuideStars(detectStars(image, detection), image) : []
			// The decoded bytes may be a view of a larger buffer, which must not be transferred along with them.
			const file = decoded.byteOffset === 0 && decoded.byteLength === decoded.buffer.byteLength ? new Uint8Array(decoded.buffer) : new Uint8Array(decoded)
			response = { jobId, status: 'decoded', image, stars, bytes: file }
			transfer = file.buffer === image.raw.buffer ? [image.raw.buffer] : [image.raw.buffer, file.buffer]
		}
	} catch (error) {
		response = { jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
		transfer = []
	}

	self.postMessage(response, transfer)
}

self.addEventListener('message', (event: MessageEvent<GuidingWorkerRequest>) => void handle(event.data))
