import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { StreakClassification, StreakClassificationContext } from 'nebulosa/src/imaging/analysis/streak/classification.types'
import { classifyStreaks } from 'nebulosa/src/imaging/analysis/streak/classifier'
import { detectStreaks } from 'nebulosa/src/imaging/analysis/streak/detector'
import type { Streak } from 'nebulosa/src/imaging/analysis/streak/types'
import type { StreakWorkerRequest, StreakWorkerResponse } from './streaks'

// Worker thread of the streak detector. It receives the copy of one image at a time, transferred from the image
// worker through the server thread, runs the toolkit's detectStreaks on it, then classifies the streaks with
// classifyStreaks from that image and the context frozen by the service, and answers both, so the measurement never
// blocks the server event loop nor the renderings of the image worker. A classification that throws leaves the
// streaks unclassified, with its reason. The copy is owned by this worker and dropped afterwards. A detection cannot
// be interrupted: the service terminates the worker to cancel one, or when it runs out of time.

declare const self: Worker

// Detects and classifies the streaks of a request and posts the outcome.
function handle({ jobId, image, settings, context }: StreakWorkerRequest): void {
	let streaks: readonly Streak[]

	try {
		streaks = detectStreaks(image, settings)
	} catch (error) {
		self.postMessage({ jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) } satisfies StreakWorkerResponse, [])
		return
	}

	let response: StreakWorkerResponse

	try {
		const { wcs, stars, exposure, date } = context
		const classification: StreakClassificationContext = { image, ...(wcs && { wcs }), ...(stars && { stars }), ...(exposure !== undefined && { exposure }), ...(date !== undefined && { startTime: timeUnix(Date.parse(date) / 1000) }) }
		const classifications: readonly StreakClassification[] = classifyStreaks(streaks, classification)
		response = { jobId, status: 'detected', streaks, classifications }
	} catch (error) {
		response = { jobId, status: 'detected', streaks, classificationError: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<StreakWorkerRequest>) => handle(event.data))
