import type { Image } from 'nebulosa/src/imaging/model/types'
import { arcsinhStretch } from 'nebulosa/src/imaging/processing/arcsinh'
import { automaticBackgroundExtraction } from 'nebulosa/src/imaging/processing/background'
import { gaussianBlur, sharpen } from 'nebulosa/src/imaging/processing/convolution'
import { cosmeticCorrection } from 'nebulosa/src/imaging/processing/cosmetic'
import { debayer } from 'nebulosa/src/imaging/processing/debayer'
import { grayscale, horizontalFlip, verticalFlip } from 'nebulosa/src/imaging/processing/geometry'
import { multiscaleLinearTransform } from 'nebulosa/src/imaging/processing/mlt'
import { multiscaleMedianTransform } from 'nebulosa/src/imaging/processing/mmt'
import { backgroundNeutralization } from 'nebulosa/src/imaging/processing/neutralization'
import type { ImageProcessingOperation, ProcessingWorkerRequest, ProcessingWorkerResponse } from './imageprocessing'

// Worker thread of the image processing pipelines (imageprocessing.ts): applies the steps of a pipeline, in order,
// to the working copy of an image it owns, announcing each step before it runs, and transfers the result back.
// Operations of the toolkit that change an image in place change the copy; those that return a new image
// (debayer, grayscale) replace it. Every step runs synchronously, so a pipeline is interrupted only by terminating
// the worker.

declare const self: Worker

// Applies one operation to an image and returns the image that follows: the same one changed in place, or a new
// one. Throws when the toolkit refuses the image or the parameters.
function apply(image: Image, operation: ImageProcessingOperation): Image {
	switch (operation.type) {
		case 'debayer': {
			const debayered = debayer(image, operation.pattern === 'auto' ? image.metadata.bayer : operation.pattern)
			if (!debayered) throw new Error('The image is too small to debayer')
			return debayered
		}
		case 'backgroundExtraction': {
			const { type, ...options } = operation
			return automaticBackgroundExtraction(image, options).image
		}
		case 'backgroundNeutralization': {
			const { type, ...options } = operation
			return backgroundNeutralization(image, options)
		}
		case 'arcsinhStretch': {
			const { type, ...options } = operation
			return arcsinhStretch(image, options)
		}
		case 'mlt':
		case 'mmt': {
			const { type, ...options } = operation
			return type === 'mlt' ? multiscaleLinearTransform(image, options) : multiscaleMedianTransform(image, options)
		}
		case 'gaussianBlur':
			return gaussianBlur(image, { sigma: operation.sigma, size: operation.size })
		case 'sharpen':
			return sharpen(image)
		case 'cosmeticCorrection': {
			const { type, ...options } = operation
			return cosmeticCorrection(image, options).image
		}
		case 'horizontalFlip':
			return horizontalFlip(image)
		case 'verticalFlip':
			return verticalFlip(image)
		case 'grayscale':
			return grayscale(image, operation.channel)
	}
}

// Posts a response to the server thread, transferring the given buffers instead of copying them.
function reply(response: ProcessingWorkerResponse, transfer: Transferable[] = []): void {
	self.postMessage(response, transfer)
}

// Runs a pipeline and posts its result, or the step that threw.
function handle({ jobId, image, steps }: ProcessingWorkerRequest): void {
	let current = image

	for (const [index, { id, operation }] of steps.entries()) {
		reply({ jobId, status: 'step', index })

		try {
			current = apply(current, operation)
		} catch (error) {
			reply({ jobId, status: 'failed', stepId: id, error: Error.isError(error) ? error.message : String(error) })
			return
		}
	}

	reply({ jobId, status: 'processed', image: current }, [current.raw.buffer])
}

self.addEventListener('message', (event: MessageEvent<ProcessingWorkerRequest>) => handle(event.data))
