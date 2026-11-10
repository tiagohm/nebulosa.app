import type { MeteorShowersSources, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { type ApiFetch, browserFetch, jsonInit, responseError } from '../../http'

// Mirror of the meteor shower catalog the server uses: the IAU catalog in use and its source state, and the curated
// visual data, fed by GET /api/meteor-showers/sources and the meteorShowers:changed events, with the refresh this tab
// asks for. The revision is what the views of the tool and the Sky watch to read their answers again; the catalog
// itself is never mirrored, only paged by the tool.

// Catalog sources known to the tab.
export interface MeteorShowerSourcesState {
	// Revision of the catalog in use, from the snapshot or an event; views read their answers again when it changes.
	revision: number
	// Sources of the server; absent before the first snapshot.
	sources?: MeteorShowersSources
	// Whether a refresh asked by this tab is running.
	refreshing: boolean
	// Why the last refresh asked by this tab failed.
	error?: string
}

// Catalog sources of the server, shared by every view of the tab.
export const meteorShowerSourcesState = proxy<MeteorShowerSourcesState>({ revision: 0, refreshing: false })

// Generation of the latest snapshot request; an older response is dropped.
let generation = 0

// Applies a snapshot of the sources, keeping a revision an event already raised.
function applySources(state: MeteorShowerSourcesState, sources: MeteorShowersSources) {
	if (sources.iau.revision < state.revision) return
	state.sources = sources
	state.revision = sources.iau.revision
}

// Reads the sources again; called on every socket (re)open, since another tab may have refreshed the catalog.
export async function refreshMeteorShowerSources(state: MeteorShowerSourcesState, request: ApiFetch = browserFetch) {
	const current = ++generation

	try {
		const response = await request('/api/meteor-showers/sources')
		if (!response.ok || current !== generation) return
		const sources = (await response.json()) as MeteorShowersSources
		if (current === generation) applySources(state, sources)
	} catch {
		// The server is unreachable; the next socket open refreshes the sources.
	}
}

// Applies a refreshed catalog of any tab. Any other event is ignored.
export function handleMeteorShowersEvent(state: MeteorShowerSourcesState, event: ServerEvent) {
	if (event.type !== 'meteorShowers:changed') return
	generation++
	applySources(state, event.sources)
}

// Asks the server to download the IAU catalog again. Returns whether it answered the sources; a failure keeps the
// catalog in use and is kept in error with the server's reason.
export async function refreshIauCatalog(state: MeteorShowerSourcesState, request: ApiFetch = browserFetch) {
	if (state.refreshing) return false
	state.refreshing = true
	state.error = undefined

	try {
		const response = await request('/api/meteor-showers/sources/iau/refresh', jsonInit('POST'))

		if (!response.ok) {
			state.error = await responseError(response, 'The catalog could not be downloaded')
			void refreshMeteorShowerSources(state, request)
			return false
		}

		applySources(state, (await response.json()) as MeteorShowersSources)
		return true
	} catch {
		state.error = 'The server could not be reached'
		return false
	} finally {
		state.refreshing = false
	}
}
