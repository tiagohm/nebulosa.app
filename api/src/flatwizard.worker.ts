import { open } from 'fs/promises'
import { analyzeFlat } from 'nebulosa/src/imaging/analysis/flat/flat'
import { measureFlatSequenceFrame } from 'nebulosa/src/imaging/analysis/flat/sequence'
import { readImageFromFits } from 'nebulosa/src/imaging/model/image'
import type { DigitalImage } from 'nebulosa/src/imaging/model/types'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { readFits } from 'nebulosa/src/io/formats/fits/fits'
import { uncompressedBitpixKeyword } from 'nebulosa/src/io/formats/fits/util'
import type { FlatFrameMeasurement, FlatWorkerRequest, FlatWorkerResponse } from './flatwizard.analysis'
import { precisionOf } from './images'

// Worker thread of the Flat Wizard frame analysis. It reads one acquired FITS file at a time from disk in
// the digital-number scale of its source, never through the normalized documents of the image worker, runs
// the toolkit's analyzeFlat on it (or measureFlatSequenceFrame for a final frame, which also keeps the
// reduced temporal sample), and answers the compact result. The decoded image lives only for one job, so
// memory never grows with the frames of a run. A job cannot be interrupted: the service terminates the
// worker to cancel one, or when it runs out of time.

declare const self: Worker

// Reads the image of a FITS file in digital numbers, with the precision its BITPIX needs. Throws when the
// file cannot be opened or holds no readable FITS image.
async function readDigitalFits(path: string) {
	await using source = fileHandleSource(await open(path, 'r'))
	const fits = await readFits(source)
	if (!fits) throw new Error('The frame is not a FITS file')
	const precision = fits.hdus.some((hdu) => precisionOf(uncompressedBitpixKeyword(hdu.header, 0)) === 64) ? 64 : 32
	const image = await readImageFromFits(fits, source, { sampleScale: 'digital', raw: precision })
	if (!image) throw new Error('The FITS file holds no readable image')
	return image
}

// Returns the output bit depth of an image read from FITS: its BITPIX when it stores integers, undefined for floats.
function outputBitDepth(image: DigitalImage) {
	const bitpix = uncompressedBitpixKeyword(image.header, 0)
	return Number.isInteger(bitpix) && bitpix > 0 ? bitpix : undefined
}

// Measures the frame of a request; a final frame also keeps its temporal sample. The output bit depth of the file
// joins the operating point the session declared, so frames of one session can be proven to share it.
async function measure({ path, context, options, sample }: FlatWorkerRequest): Promise<FlatFrameMeasurement> {
	const image = await readDigitalFits(path)
	const bitDepth = context.operatingPoint?.bitDepth ?? outputBitDepth(image)
	const frame = { ...context, image, ...(bitDepth !== undefined && { operatingPoint: { ...context.operatingPoint, bitDepth } }) }

	if (sample) {
		const measured = measureFlatSequenceFrame({ frame }, { analysis: options })
		return { analysis: measured.analysis, sample: measured }
	}

	return { analysis: analyzeFlat({ frame }, { ...options, maps: 'none' }) }
}

// Measures the frame of a request and posts the outcome.
async function handle(request: FlatWorkerRequest): Promise<void> {
	let response: FlatWorkerResponse

	try {
		response = { jobId: request.jobId, status: 'measured', result: await measure(request) }
	} catch (error) {
		response = { jobId: request.jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<FlatWorkerRequest>) => void handle(event.data))
