import type { SatelliteRefreshResponse, SatelliteSourcesSnapshot, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { jsonInit, responseError } from '../http'

// Mirror of the artificial satellite catalog of the server: the download state of its CelesTrak sources, fed by
// GET /api/satellites/sources and the satellites:changed events, and the downloads this tab asks for. The catalog and
// its fair-use rules are the server's; a download refused for its interval or a block only shows why. The revision of
// the last change seen is what the views of the tool and the Sky watch to read their own data again.

// Catalog sources known to the tab and the downloads in flight.
export interface SatelliteCatalogState {
	// Revision of the catalog seen last, from an event or a download of this tab; views read their data again when it
	// changes.
	revision: number
	// Sources of the server; absent before the first snapshot.
	snapshot?: SatelliteSourcesSnapshot
	// Downloads in flight, by source key.
	downloading: Record<string, true>
	// Why the last download of a source failed or was refused, by source key.
	errors: Record<string, string>
}

// Catalog sources of the server, shared by every view of the tab.
export const satelliteCatalogState = proxy<SatelliteCatalogState>({ revision: 0, downloading: {}, errors: {} })

// Generation of the latest snapshot request; an older response is dropped.
let generation = 0

// Fetches the sources again; called on every socket (re)open and after every change of the catalog, since a download
// of another tab changes them.
export async function refreshSatelliteCatalog(state: SatelliteCatalogState, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/satellites/sources')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as SatelliteSourcesSnapshot
		if (current === generation) state.snapshot = snapshot
	} catch {
		// The server is unreachable; the next socket open refreshes the sources.
	}
}

// Applies a change of the catalog: its revision, then the sources read again. Any other event is ignored.
export function handleSatelliteEvent(state: SatelliteCatalogState, event: ServerEvent, request: typeof fetch = fetch) {
	if (event.type !== 'satellites:changed') return
	state.revision = event.revision
	void refreshSatelliteCatalog(state, request)
}

// Asks the server to download a source now. Returns whether it was downloaded; a refusal (its interval, a block, a
// failure of CelesTrak) is kept in errors with the server's reason, and the sources are read again to show its state.
export async function downloadSatelliteSource(state: SatelliteCatalogState, sourceKey: string, request: typeof fetch = fetch) {
	if (state.downloading[sourceKey]) return false
	state.downloading[sourceKey] = true
	delete state.errors[sourceKey]

	try {
		const response = await request(`/api/satellites/sources/${encodeURIComponent(sourceKey)}/refresh`, jsonInit('POST'))

		if (!response.ok) {
			state.errors[sourceKey] = await responseError(response)
			void refreshSatelliteCatalog(state, request)
			return false
		}

		const { snapshot } = (await response.json()) as SatelliteRefreshResponse
		++generation
		state.snapshot = snapshot
		state.revision = snapshot.revision
		return true
	} catch {
		state.errors[sourceKey] = 'The server could not be reached'
		return false
	} finally {
		delete state.downloading[sourceKey]
	}
}
