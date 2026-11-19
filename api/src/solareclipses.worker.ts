import type { SolarEclipseMapWorkerRequest, SolarEclipseMapWorkerResponse } from './solareclipses'
import { solarEclipseMap } from './solareclipses.map'

// Worker thread of the solar eclipse global maps. It answers the whole map of an eclipse from the eclipse and the
// elements the server thread found on its ephemeris, so it reads no ephemeris and no kernel; a map costs hundreds of
// milliseconds and would otherwise stall the API's event loop (guiding, captures, and events). It keeps nothing
// between jobs; the service caches the maps it answers.

declare const self: Worker

// Computes the map of a request and posts the outcome.
function handle({ jobId, eclipse, elements }: SolarEclipseMapWorkerRequest) {
	let response: SolarEclipseMapWorkerResponse

	try {
		response = { jobId, status: 'computed', map: solarEclipseMap(eclipse, elements) }
	} catch (error) {
		response = { jobId, status: 'failed', error: Error.isError(error) ? error.message : String(error) }
	}

	self.postMessage(response, [])
}

self.addEventListener('message', (event: MessageEvent<SolarEclipseMapWorkerRequest>) => handle(event.data))
