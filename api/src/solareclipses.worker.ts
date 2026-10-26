import type { SolarEclipseMapWorkerRequest, SolarEclipseMapWorkerResponse } from './solareclipses'
import { resolveSolarEclipse, solarEclipseMap } from './solareclipses.map'

// Worker thread of the solar eclipse global maps. It resolves the eclipse an id names and answers its whole map,
// which costs hundreds of milliseconds and would otherwise stall the API's event loop (guiding, captures, and
// events). It keeps nothing between jobs; the service caches the maps it answers.

declare const self: Worker

// Computes the map of a request and posts the outcome.
function handle({ jobId, id }: SolarEclipseMapWorkerRequest) {
	let response: SolarEclipseMapWorkerResponse

	try {
		const eclipse = resolveSolarEclipse(id)
		response = eclipse ? { jobId, status: 'computed', map: solarEclipseMap(eclipse) } : { jobId, status: 'notFound' }
	} catch (error) {
		response = { jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<SolarEclipseMapWorkerRequest>) => handle(event.data))
