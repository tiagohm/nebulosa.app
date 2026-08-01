import { runImagePipeline } from './image.pipeline'
import type { ImagePipelineRequest, ImagePipelineResponse } from './image.pipeline'

// Worker thread that runs the image transformation pipeline, so decoding, debayering, calibration,
// stretching, convolution, and FFT never block the server event loop. It answers one request at a time
// and holds no state between them beyond the reusable FFT work buffers.

declare const self: Worker

self.addEventListener('message', async (event: MessageEvent<ImagePipelineRequest>) => {
	const { id, source, transformation } = event.data

	try {
		const frame = await runImagePipeline(source, transformation)

		if (!frame) {
			self.postMessage({ id, status: 'unreadable' } satisfies ImagePipelineResponse)
			return
		}

		const { header, raw, metadata } = frame.image
		// Rebuilt field by field so that nothing the pipeline attached to the frame, such as the FFT work
		// buffers, is dragged along and silently copied.
		const response: ImagePipelineResponse = { id, status: 'transformed', image: { header, raw, metadata }, stretch: frame.stretch }
		self.postMessage(response, { transfer: [raw.buffer] })
	} catch (e) {
		self.postMessage({ id, status: 'failed', error: e instanceof Error ? e.message : String(e) } satisfies ImagePipelineResponse)
	}
})
