import { readImageFromBuffer, readImageFromPath } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { calibrate } from 'nebulosa/src/imaging/processing/calibration'
import { adf, sigmaClip } from 'nebulosa/src/imaging/processing/computation'
import type { AdaptiveDisplayFunctionOptions } from 'nebulosa/src/imaging/processing/computation'
import { blur, gaussianBlur, mean, sharpen } from 'nebulosa/src/imaging/processing/convolution'
import { debayer } from 'nebulosa/src/imaging/processing/debayer'
import { fft, FFTWorkspace } from 'nebulosa/src/imaging/processing/fft'
import { horizontalFlip, invert, verticalFlip } from 'nebulosa/src/imaging/processing/geometry'
import { scnr } from 'nebulosa/src/imaging/processing/scnr'
import { stf } from 'nebulosa/src/imaging/processing/stf'
import { brightness, contrast, gamma, saturation } from 'nebulosa/src/imaging/processing/tone'
import type { ImageTransformation } from '#/image'
import type { ImageCalibration } from '#/image.calibration'

// Where the pixels of a frame come from, in the order they are tried: an already decoded frame handed
// over by its producer, then a serialized payload, then the filesystem.
export interface ImagePipelineSource {
	readonly path: string
	// Typed as a plain view because a payload that crossed a thread loses the Buffer prototype.
	readonly buffer?: Uint8Array
	readonly image?: Image
}

// Midtone, shadow, and highlight the automatic stretch computed, in the 0 to 65536 range the request
// uses. The pipeline cannot write them back into the request because the request crossed a thread.
export type ImageStretchLevels = readonly [midtone: number, shadow: number, highlight: number]

// Frame with the whole pipeline applied.
export interface TransformedFrame {
	readonly image: Image
	// Absent unless the automatic stretch ran and therefore computed new levels.
	readonly stretch?: ImageStretchLevels
}

// One pipeline run, as sent to the worker. The source is structure-cloned instead of transferred: the
// payload and the decoded frame it may carry belong to the retained source and must survive the call.
export interface ImagePipelineRequest {
	readonly id: number
	readonly source: ImagePipelineSource
	readonly transformation: ImageTransformation | false
}

// Outcome of one pipeline run, as sent back from the worker. The pixels of a transformed frame are
// transferred, so the worker keeps nothing after answering.
export type ImagePipelineResponse =
	| { readonly id: number; readonly status: 'transformed'; readonly image: Image; readonly stretch?: ImageStretchLevels }
	// The payload was read but is not a decodable image.
	| { readonly id: number; readonly status: 'unreadable' }
	// The source could not be read at all, such as a path that does not exist.
	| { readonly id: number; readonly status: 'failed'; readonly error: string }

// Work buffers the FFT filter needs, reused across requests of the same dimensions. Only one is kept
// because requests run one at a time, and it is large enough that holding more is not worth it.
let fftWorkspace: { readonly width: number; readonly height: number; readonly workspace: FFTWorkspace } | undefined

// Decodes the source and applies every enabled step of the transformation. Returns undefined when the
// payload is not a readable image; failures to read the source itself are thrown.
export async function runImagePipeline(source: ImagePipelineSource, transformation: ImageTransformation | false): Promise<TransformedFrame | undefined> {
	const image = await decodeImage(source)
	if (!image) return undefined
	return applyTransformation(image, transformation)
}

// Resolves the pixels of a source. Nothing is copied: a frame that crossed a thread is already private
// to this side, and the pipeline is free to work in place over it.
function decodeImage(source: ImagePipelineSource) {
	if (source.image) return Promise.resolve<Image | undefined>(source.image)

	if (source.buffer?.byteLength) {
		// A payload that crossed a thread arrives as a plain Uint8Array, since the structured clone keeps
		// the bytes but not the Buffer prototype the reader needs. Rewrapping it does not copy.
		const buffer = source.buffer
		return readImageFromBuffer(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength), 32)
	}

	return readImageFromPath(source.path, 32)
}

// Applies the transformation steps in the order the pipeline expects. The image is reassigned at each
// step because the operations may either work in place or return a new frame.
async function applyTransformation(image: Image, transformation: ImageTransformation | false): Promise<TransformedFrame> {
	if (transformation === false || !transformation.enabled) return { image }

	if (transformation.debayer) image = debayer(image, !transformation.cfaPattern || transformation.cfaPattern === 'AUTO' ? undefined : transformation.cfaPattern) ?? image
	if (transformation.calibration.enabled) image = await calibrateImage(image, transformation.calibration)
	if (transformation.horizontalMirror) image = horizontalFlip(image)
	if (transformation.verticalMirror) image = verticalFlip(image)

	if (transformation.scnr.channel) {
		const { channel, amount, method } = transformation.scnr
		image = scnr(image, channel, amount, method)
	}

	if (transformation.fft.enabled) {
		const { type, cutoff, weight } = transformation.fft
		image = fft(image, workspaceFor(image), type, cutoff, weight)
	}

	const { stretch, adjustment, filter } = transformation
	let levels: ImageStretchLevels | undefined

	if (stretch.auto) {
		const options: Partial<AdaptiveDisplayFunctionOptions> = { meanBackground: stretch.meanBackground, clippingPoint: stretch.clippingPoint, bits: stretch.bits }

		if (stretch.sigmaClip) {
			options.bits = new Int32Array(1 << stretch.bits) // used by sigmaClip and adf methods
			options.sigmaClip = sigmaClip(image, stretch)
		}

		const [midtone, shadow, highlight] = adf(image, options)
		image = stf(image, midtone, shadow, highlight)
		levels = [Math.trunc(midtone * 65536), Math.trunc(shadow * 65536), Math.trunc(highlight * 65536)]
	} else {
		const { midtone, shadow, highlight } = stretch
		image = stf(image, midtone / 65536, shadow / 65536, highlight / 65536)
	}

	if (adjustment.enabled) {
		if (adjustment.brightness.value !== 1) image = brightness(image, adjustment.brightness.value)
		if (adjustment.contrast.value !== 1) image = contrast(image, adjustment.contrast.value)
		if (adjustment.gamma.value > 1) image = gamma(image, adjustment.gamma.value)
		if (adjustment.saturation.value !== 1) image = saturation(image, adjustment.saturation.value, adjustment.saturation.channel)
	}

	if (filter.enabled) {
		if (filter.type === 'sharpen') image = sharpen(image)
		else if (filter.type === 'blur') image = blur(image, filter.blur.size)
		else if (filter.type === 'mean') image = mean(image, filter.mean.size)
		else if (filter.type === 'gaussianBlur') image = gaussianBlur(image, filter.gaussianBlur)
	}

	if (transformation.invert) image = invert(image)

	return { image, stretch: levels }
}

// Returns the FFT work buffers for the dimensions of the image, allocating them when the previous
// request had a different size.
function workspaceFor(image: Image) {
	const { width, height } = image.metadata

	if (fftWorkspace?.width !== width || fftWorkspace.height !== height) {
		fftWorkspace = { width, height, workspace: new FFTWorkspace(width, height) }
	}

	return fftWorkspace.workspace
}

// Subtracts and divides the calibration frames the request points to. A failure to read any of them is
// not fatal: the uncalibrated image is still worth showing.
async function calibrateImage(image: Image, calibration: ImageCalibration) {
	if (!calibration.enabled) return image

	try {
		const [dark, flat, bias, darkFlat] = await Promise.all([
			calibration.dark.enabled && calibration.dark.path ? readImageFromPath(calibration.dark.path, 32) : undefined,
			calibration.flat.enabled && calibration.flat.path ? readImageFromPath(calibration.flat.path, 32) : undefined,
			calibration.bias.enabled && calibration.bias.path ? readImageFromPath(calibration.bias.path, 32) : undefined,
			calibration.darkFlat.enabled && calibration.darkFlat.path ? readImageFromPath(calibration.darkFlat.path, 32) : undefined,
		])

		return calibrate(image, { dark, flat, bias, darkFlat })
	} catch (e) {
		console.error('failed to calibrate', e)
		return image
	}
}
