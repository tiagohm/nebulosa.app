import { writeImageToFits } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { calibrationMasterImage } from 'nebulosa/src/imaging/processing/calibration'
import { bufferSink } from 'nebulosa/src/io/io'
import { readDigital } from './imagestacking.analysis'

// What the workers that subtract a master dark from frames share (the master dark subtraction of calibrationdark.ts and
// the guide frames of guiding.ts): the latest master a job named, kept by each worker, and the FITS encoding of a
// calibrated frame.

// Latest master dark the jobs of a worker named, in the normalized scale of calibrate: read once and kept while jobs name
// it, replaced when a job names another, and forgotten when its read failed, so the next job reads it again.
export class LatestMasterDark {
	// Master kept and the key it was read for.
	#latest?: { readonly key: string; readonly image: Promise<Image> }

	// Returns the master a job names: key identifies it (its id, with its digest when the file it names may change), path
	// is its file, and fullScale the full scale of its digital numbers, dividing them into the normalized scale.
	image(key: string, path: string, fullScale: number): Promise<Image> {
		if (this.#latest?.key === key) return this.#latest.image

		const image = readDigital(path).then((digital) => calibrationMasterImage(digital, fullScale))
		const latest = { key, image }
		this.#latest = latest
		image.catch(() => this.#latest === latest && (this.#latest = undefined))
		return image
	}
}

// Encodes a calibrated frame as FITS in the integer scale of its header, the negative values clipped to 0 by the writer.
// The calibrated frame keeps the header of the frame it came from, so that frame's size in bytes and two more header
// blocks hold it.
export async function calibratedFits(image: Image, size: number): Promise<Uint8Array<ArrayBuffer>> {
	const buffer = Buffer.alloc(size + 2 * 2880)
	const sink = bufferSink(buffer)
	await writeImageToFits(image, sink)
	return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + sink.position))
}
