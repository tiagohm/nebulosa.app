import { writeImageToFits } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { calibrationMasterImage } from 'nebulosa/src/imaging/processing/calibration'
import { detectStars } from 'nebulosa/src/imaging/stars/detector'
import { bufferSink, bufferSource } from 'nebulosa/src/io/io'
import { decodeCameraBlobFromBase64 } from 'nebulosa/src/observation/capture/capture'
import { enrichGuideStars } from 'nebulosa/src/observation/guiding/tracker.star'
import { inspectHeader } from './calibrationlibrary.sources'
import { detectStarsInRegions } from './guideregions'
import type { GuidingWorkerDark, GuidingWorkerDarkOutcome, GuidingWorkerRequest, GuidingWorkerResponse } from './guiding'
import { luminanceImage, readImageFrom } from './imagedecode'
import { cfaPattern } from './images'
import { calibrateLight, readDigital, readDigitalFrom } from './imagestacking.analysis'

// Worker thread of the guide frames of one guiding session. It receives the BLOB of one guide exposure at a time,
// decodes it (base64 or raw FITS/XISF), takes the grayscale copy star detection measures (the luminance of a color or
// a CFA frame with its trusted pattern), detects its stars with the toolkit detector and the settings of the request
// (none for a session whose stars ASTAP detects), over the whole frame or only the regions around the stars the guider
// uses, and samples their peaks, and answers the grayscale image, its stars and the FITS/XISF bytes, all transferred,
// so neither the decoding nor the detection ever blocks the server event loop, nor competes with the renderings of the
// image worker. Positions are pixels of the full decoded frame, with the origin at the top-left.
//
// A job naming a master dark of the Calibration Library has the frame read in digital numbers and the dark subtracted
// from its raw samples, before the CFA is debayered and the luminance taken, when the exposure its header gives is the
// dark's exactly; the toolkit's calibrate refuses a master of another geometry, binning, gain or offset. The grayscale
// copy, its stars, and, for ASTAP, a FITS file of the calibrated frame (its negative values clipped to 0 by the writer)
// then come from the calibrated samples; the original bytes are still answered for the preview. A frame the dark does not
// apply to is measured uncalibrated, and the answer says why. The worker keeps the latest master a job named, read once.

declare const self: Worker

// Latest master dark a job named, in the normalized scale of calibrate, and its id; read once and kept while jobs name it.
let master: { readonly masterId: number; readonly image: Promise<Image> } | undefined

// Returns the master dark of a job, reading it when another one is kept. A read that failed is forgotten, so the next
// job reads it again.
function masterOf(dark: GuidingWorkerDark) {
	if (master?.masterId !== dark.masterId) {
		const image = readDigital(dark.path).then((digital) => calibrationMasterImage(digital, dark.fullScale))
		const entry = { masterId: dark.masterId, image }
		master = entry
		image.catch(() => master === entry && (master = undefined))
	}

	return master.image
}

// Reads the frame of bytes in digital numbers and subtracts the master dark from it, in the normalized scale. Returns
// the calibrated image, or why it was not calibrated.
async function calibrated(bytes: Buffer, dark: GuidingWorkerDark): Promise<{ readonly image?: Image; readonly outcome: GuidingWorkerDarkOutcome }> {
	try {
		const light = await readDigitalFrom(bufferSource(bytes), isXisf(bytes))
		const exposure = inspectHeader(light.header, 'fits', false).metadata.exposure.value
		if (exposure !== dark.exposure) return { outcome: { masterId: dark.masterId, applied: false, reason: exposure === undefined ? 'The frame does not state its exposure' : `The frame was exposed ${exposure / 1000} ms, the dark ${dark.exposure / 1000} ms` } }
		const image = calibrateLight(light, { dark: await masterOf(dark) })
		return { image, outcome: { masterId: dark.masterId, applied: true } }
	} catch (error) {
		return { outcome: { masterId: dark.masterId, applied: false, reason: Error.isError(error) ? error.message : String(error) } }
	}
}

// Returns whether bytes hold an XISF file, by its signature.
function isXisf(bytes: Uint8Array) {
	return bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 8)) === 'XISF0100'
}

// Encodes a calibrated frame as FITS in the integer scale of its header, the negative values clipped to 0, for ASTAP.
// The calibrated frame has the header of the original one, so the original size and two more header blocks hold it.
async function calibratedFits(image: Image, size: number): Promise<Uint8Array<ArrayBuffer>> {
	const buffer = Buffer.alloc(size + 2 * 2880)
	const sink = bufferSink(buffer)
	await writeImageToFits(image, sink)
	return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + sink.position))
}

// Decodes and measures the frame of a request and posts the outcome.
async function handle({ jobId, bytes, encoding, detection, regions, dark }: GuidingWorkerRequest): Promise<void> {
	let response: GuidingWorkerResponse
	let transfer: Transferable[] = []

	try {
		const blob = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		const decoded = encoding === 'base64' ? await decodeCameraBlobFromBase64(blob) : blob
		const calibration = dark ? await calibrated(decoded, dark) : undefined
		const read = calibration?.image ? { image: calibration.image } : await readImageFrom(bufferSource(decoded))

		if (read === undefined) {
			response = { jobId, status: 'unsupported' }
		} else {
			const image = luminanceImage(read.image, cfaPattern(read.image.header, read.image.metadata.channels))
			// Without built-in settings the stars are detected by ASTAP on the server.
			const stars = detection ? enrichGuideStars(regions ? detectStarsInRegions(image, regions, detection) : detectStars(image, detection), image) : []
			// The decoded bytes may be a view of a larger buffer, which must not be transferred along with them.
			const file = decoded.byteOffset === 0 && decoded.byteLength === decoded.buffer.byteLength ? new Uint8Array(decoded.buffer) : new Uint8Array(decoded)
			const metadata = inspectHeader(read.image.header, 'fits', false).metadata
			const detectionBytes = calibration?.image && !detection ? await calibratedFits(calibration.image, decoded.byteLength) : undefined
			response = { jobId, status: 'decoded', image, stars, bytes: file, metadata, ...(calibration && { dark: calibration.outcome }), ...(detectionBytes && { detectionBytes }) }
			transfer = file.buffer === image.raw.buffer ? [image.raw.buffer] : [image.raw.buffer, file.buffer]
			if (detectionBytes) transfer.push(detectionBytes.buffer)
		}
	} catch (error) {
		response = { jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
		transfer = []
	}

	self.postMessage(response, transfer)
}

self.addEventListener('message', (event: MessageEvent<GuidingWorkerRequest>) => void handle(event.data))
