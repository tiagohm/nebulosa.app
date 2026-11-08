import { writeImageToFits } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { calibrationMasterImage } from 'nebulosa/src/imaging/processing/calibration'
import { bufferSink, bufferSource } from 'nebulosa/src/io/io'
import type { DarkWorkerRequest, DarkWorkerResponse } from './calibrationdark'
import { calibrateLight, readDigital, readDigitalFrom } from './imagestacking.analysis'

// Worker thread of the master dark subtraction of one session (calibrationdark.ts). For each job it reads the frame file
// in digital numbers, subtracts the master dark from its raw samples with the toolkit's calibrate (no scaling, before any
// debayering; calibrate refuses a master of another geometry, CFA, binning, gain, offset, or subframe origin), and answers
// a FITS of the calibrated frame in the frame's own integer scale and header, negative values clipped to 0 by the writer,
// transferred, so the decoding and the subtraction never block the server event loop. The pixel grid, the orientation,
// and every header keyword but those the job leaves out are the frame's. The worker keeps the latest master a job named,
// read once per master id and digest. A job that fails answers why, never a partial image.

declare const self: Worker

// Latest master a job named, in the normalized scale of calibrate, and its `<masterId>:<digest>`.
let master: { readonly key: string; readonly image: Promise<Image> } | undefined

// Returns the master of a job, reading it when another one is kept. A read that failed is forgotten, so the next job
// reads it again.
function masterOf(request: DarkWorkerRequest) {
	if (master?.key !== request.masterKey) {
		const image = readDigital(request.darkPath).then((digital) => calibrationMasterImage(digital, request.fullScale))
		const entry = { key: request.masterKey, image }
		master = entry
		image.catch(() => master === entry && (master = undefined))
	}

	return master.image
}

// Subtracts the master of a job from its frame and encodes the result as FITS. The calibrated frame keeps the header of
// the frame (BITPIX included), so the frame's size and two more header blocks hold it.
async function calibrated(request: DarkWorkerRequest): Promise<Uint8Array<ArrayBuffer>> {
	const bytes = Buffer.from(await Bun.file(request.framePath).arrayBuffer())
	const light = await readDigitalFrom(bufferSource(bytes), false)
	const image = calibrateLight(light, { dark: await masterOf(request) })
	const omitted = new Set(request.omit)
	const header = Object.fromEntries(Object.entries(image.header).filter(([key]) => !omitted.has(key)))
	const buffer = Buffer.alloc(bytes.byteLength + 2 * 2880)
	const sink = bufferSink(buffer)
	await writeImageToFits({ ...image, header }, sink)
	return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + sink.position))
}

self.addEventListener('message', async (event: MessageEvent<DarkWorkerRequest>) => {
	const { jobId } = event.data

	try {
		const bytes = await calibrated(event.data)
		self.postMessage({ jobId, bytes } satisfies DarkWorkerResponse, [bytes.buffer])
	} catch (error) {
		self.postMessage({ jobId, failed: Error.isError(error) ? error.message : String(error) } satisfies DarkWorkerResponse, [])
	}
})
