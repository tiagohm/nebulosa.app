import { answerLiveRequest, DEFAULT_LIVE_STACKING_RECIPE, LiveStackingEngine, type LiveWorkerRequest } from './livestacking.engine'

// Worker thread of one Live Stacking session: it owns the engine of the session (fields, stacks, candidates, masters)
// and answers the requests of the server one at a time, in the order they arrive, so the reading, calibration,
// measurement, and resampling of a frame never block the server event loop, and a snapshot or an export always sees
// the stacks between two frames. The first request configures the recipe of the session.

declare const self: Worker

// Engine of the session, replaced by the configuration.
let engine = new LiveStackingEngine(DEFAULT_LIVE_STACKING_RECIPE)

// End of the requests answered so far; each one waits for the previous.
let queue: Promise<void> = Promise.resolve()

// Answers one request after the previous ones.
function handle(request: LiveWorkerRequest) {
	if (request.type === 'configure') engine = new LiveStackingEngine(request.recipe)

	queue = queue.then(async () => {
		const { response, transfer } = await answerLiveRequest(engine, request)
		self.postMessage(response, transfer)
	})
}

self.addEventListener('message', (event: MessageEvent<LiveWorkerRequest>) => handle(event.data))
