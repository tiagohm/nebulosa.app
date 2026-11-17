import { bufferSource } from 'nebulosa/src/io/io'
import type { DarkWorkerRequest, DarkWorkerResponse } from './calibrationdark'
import { calibratedFits, LatestMasterDark } from './calibrationdark.master'
import { calibrateLight, readDigitalFrom } from './imagestacking.analysis'

// Worker thread of the master dark subtraction of one session (calibrationdark.ts). For each job it reads the frame file
// in digital numbers, subtracts the master dark from its raw samples with the toolkit's calibrate (no scaling, before any
// debayering; calibrate refuses a master of another geometry, CFA, binning, gain, offset, or subframe origin), and answers
// a FITS of the calibrated frame in the frame's own integer scale and header, negative values clipped to 0 by the writer,
// transferred, so the decoding and the subtraction never block the server event loop. The pixel grid, the orientation,
// and every header keyword but those the job leaves out are the frame's. The worker keeps the latest master a job named,
// read once per master id and digest. A job that fails answers why, never a partial image.

declare const self: Worker

// Latest master a job named, by its `<masterId>:<digest>`.
const master = new LatestMasterDark()

// Subtracts the master of a job from its frame and encodes the result as FITS, with the header of the frame (BITPIX
// included) but the keywords the job leaves out.
async function calibrated(request: DarkWorkerRequest): Promise<Uint8Array<ArrayBuffer>> {
	const bytes = Buffer.from(await Bun.file(request.framePath).arrayBuffer())
	const light = await readDigitalFrom(bufferSource(bytes), false)
	const image = calibrateLight(light, { dark: await master.image(request.masterKey, request.darkPath, request.fullScale) })
	const omitted = new Set(request.omit)
	const header = Object.fromEntries(Object.entries(image.header).filter(([key]) => !omitted.has(key)))
	return await calibratedFits({ ...image, header }, bytes.byteLength)
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
