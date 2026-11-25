import type { QuadIndexBandItem, QuadIndexDownloadsSnapshot, ServerEvent } from 'api'
import { toArcmin, toDeg } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { type ApiFetch, browserFetch, responseError } from '../http'

// Downloadable quad index bands of the built-in plate solver, as the server reports them: their sources, what fields
// each band suits, whether it is installed in the default index folder, and its download in progress. The server owns
// the downloads, which outlive the tab: this store mirrors its snapshot and its quadIndexes:updated events, keeping
// the snapshot of highest revision, and sends the downloads, cancellations, and removals. It also tells which bands suit
// a field of view, so the settings recommend them for the Equipment Setup and the framings.

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

// Returns an angle in radians as a field or quad size for people: arcminutes below a degree ("11.3′"), else degrees
// ("1.9°"), with one decimal at most and none when it rounds to a whole number ("20′").
export function formatBandAngle(angle: number) {
	const arcmin = toArcmin(angle)
	if (Number(arcmin.toFixed(1)) < 60) return `${Number(arcmin.toFixed(1))}′`
	return `${Number(toDeg(angle).toFixed(1))}°`
}

// Returns a range of angles in radians as "20′–40′" or "40′–1.3°".
export function formatBandRange(lower: number, upper: number) {
	return `${formatBandAngle(lower)}–${formatBandAngle(upper)}`
}

// Returns the bands that suit a field of view of width × height radians best: those whose range of shorter sides holds
// its shorter side, two in general since the ranges of neighbouring bands overlap. Empty for a field outside every band.
export function bandsForField<T extends Pick<QuadIndexBandItem, 'bestShortSide'>>(bands: readonly T[], width: number, height: number): T[] {
	const shortSide = Math.min(width, height)
	return bands.filter(({ bestShortSide: [shortest, longest] }) => shortSide >= shortest && shortSide <= longest)
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
