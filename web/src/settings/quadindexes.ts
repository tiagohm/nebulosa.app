import type { QuadIndexDownloadsSnapshot, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { type ApiFetch, browserFetch, responseError } from '../http'

// Downloadable quad index bands of the built-in plate solver, as the server reports them: their sources, what fields
// each band suits, whether it is installed in the default index folder, and its download in progress. The server owns
// the downloads, which outlive the tab: this store mirrors its snapshot and its quadIndexes:updated events, keeping
// the snapshot of highest revision, and sends the downloads, cancellations, and removals.

// Mirror of the server's downloadable bands.
export interface QuadIndexesState {
	// Latest snapshot, once fetched.
	snapshot?: QuadIndexDownloadsSnapshot
	// Why the last snapshot could not be fetched.
	loadError?: string
	// Bands whose request is in flight, by id.
	pending: Record<string, boolean>
	// Why the last request of a band failed, by id.
	errors: Record<string, string>
}

// Request of a band: download it, cancel its download (or forget the failed one), or delete its installed files.
export type QuadIndexAction = 'download' | 'cancel' | 'remove'

// Mirror of the server's downloadable bands, shared by every component of the tab.
export const quadIndexesState = proxy<QuadIndexesState>({ pending: {}, errors: {} })

// Base URL of the routes of the bands.
const INDEXES_URL = '/api/settings/external-tools/nebulosa/indexes'

// Stores a snapshot unless the store already holds a later one.
function store(state: QuadIndexesState, snapshot: QuadIndexDownloadsSnapshot) {
	if (!state.snapshot || snapshot.revision >= state.snapshot.revision) state.snapshot = snapshot
}

// Fetches the bands, their installed files read again by the server.
export async function refreshQuadIndexes(state: QuadIndexesState, request: ApiFetch = browserFetch) {
	try {
		const response = await request(INDEXES_URL)

		if (!response.ok) {
			state.loadError = await responseError(response)
			return
		}

		store(state, (await response.json()) as QuadIndexDownloadsSnapshot)
		state.loadError = undefined
	} catch {
		state.loadError = 'Unable to reach the server'
	}
}

// Applies a server event to the store; other events are ignored.
export function handleQuadIndexEvent(state: QuadIndexesState, event: ServerEvent) {
	if (event.type === 'quadIndexes:updated') store(state, event.snapshot)
}

// Sends a request of a band and stores the snapshot it answers, or why it failed.
export async function changeQuadIndex(state: QuadIndexesState, id: string, action: QuadIndexAction, request: ApiFetch = browserFetch) {
	const url = `${INDEXES_URL}/${encodeURIComponent(id)}`
	state.pending[id] = true
	delete state.errors[id]

	try {
		const response = await request(action === 'remove' ? url : `${url}/${action}`, { method: action === 'remove' ? 'DELETE' : 'POST' })
		if (response.ok) store(state, (await response.json()) as QuadIndexDownloadsSnapshot)
		else state.errors[id] = await responseError(response)
	} catch {
		state.errors[id] = 'Unable to reach the server'
	} finally {
		delete state.pending[id]
	}
}
