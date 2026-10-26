import type { EclipseDirection, LocalLunarEclipse, LocalLunarViewHandedness, LocalLunarViewOrientationMode, LunarEclipseContactKind, LunarEclipseMap, LunarEclipseSummary, LunarEclipseType } from 'api'
import { proxy } from 'valtio'
import { ApiResponseError, fetchJson } from '../../http'
import type { SkyObserverSettings } from '../../profile/schema'
import { createRequestGuard } from '../../sky/selection'
import { aborted, browserEclipseIo, type EclipseIo, type EclipsePlace, errorMessage, observerPlace, utcDateStart } from '../eclipse/eclipse'

// State of the Lunar Eclipse Map tool and its requests to /api/eclipses/lunar: the eclipse shown and its global
// map, the contact highlighted, the place whose local circumstances are shown, and how they are presented. The
// place follows eclipse.ts: it starts as the Sky observer of the active profile, and choosing another one on the
// map or by hand never changes the profile. The state lives as long as the tab, so leaving and reopening the tool
// keeps it; nothing is stored on the server. Times are Unix milliseconds (UTC), geographic positions degrees,
// longitude east positive.

// Presentation of the Local View.
export interface LunarEclipseViewSettings {
	// Whether up is the zenith or celestial north.
	orientation: LocalLunarViewOrientationMode
	// Whether east is to the right or to the left.
	handedness: LocalLunarViewHandedness
	// Whether the Moon disks of the other contacts are drawn.
	ghosts: boolean
}

// State of the tool in the tab.
export interface LunarEclipseState {
	// Eclipse shown.
	eclipse?: LunarEclipseSummary
	// Global map of the eclipse shown, once loaded.
	map?: LunarEclipseMap
	// Whether an eclipse or its map is being loaded.
	loading: boolean
	// Why the eclipse or its map could not be loaded.
	error?: string
	// Why a search left the eclipse shown as it was, such as no visible eclipse within the searched range.
	notice?: string
	// Contact highlighted on the map and drawn in the Local View.
	selectedEvent: LunarEclipseContactKind
	// Place whose local circumstances are shown.
	place?: EclipsePlace
	// Local circumstances of the eclipse shown from the place, once loaded.
	local?: LocalLunarEclipse
	// Whether the local circumstances are being loaded.
	localLoading: boolean
	// Why the local circumstances could not be loaded.
	localError?: string
	// Presentation of the Local View.
	view: LunarEclipseViewSettings
	// Time zone chosen for the times: UTC, an IANA zone, or empty for the browser's; undefined follows the place
	// (see displayTimeZone).
	timeZone?: string
	// Whether stepping between eclipses skips those whose Moon stays below the place's horizon.
	visibleOnly: boolean
}

// Initial state of the tool.
export function initialLunarEclipseState(): LunarEclipseState {
	return { loading: false, selectedEvent: 'MAX', localLoading: false, view: { orientation: 'zenith', handedness: 'eastRight', ghosts: true }, visibleOnly: false }
}

// Lunar Eclipse Map state of the tab.
export const lunarEclipseState = proxy<LunarEclipseState>(initialLunarEclipseState())

// Requests of the eclipse shown and of its map; a new search supersedes them.
const eclipseGuard = createRequestGuard()

// Requests of the local circumstances; a new place, contact, presentation, or eclipse supersedes them.
const localGuard = createRequestGuard()

// Names of the contacts, for people.
export const CONTACT_NAMES: Readonly<Record<LunarEclipseContactKind, string>> = {
	P1: 'Penumbral eclipse begins',
	U1: 'Partial eclipse begins',
	U2: 'Total eclipse begins',
	MAX: 'Greatest eclipse',
	U3: 'Total eclipse ends',
	U4: 'Partial eclipse ends',
	P4: 'Penumbral eclipse ends',
}

// Names of the eclipse types, for people.
export const ECLIPSE_TYPE_NAMES: Readonly<Record<LunarEclipseType, string>> = { TOTAL: 'Total', PARTIAL: 'Partial', PENUMBRAL: 'Penumbral' }

// Searches the eclipse nearest an instant (Unix milliseconds) in a direction and shows it with its map. With a
// place, only eclipses whose Moon rises above its horizon count; when none is found the eclipse shown stays and
// notice says why. A newer search discards this one's late answers.
async function searchEclipse(state: LunarEclipseState, time: number, direction: EclipseDirection, place: EclipsePlace | undefined, io: EclipseIo) {
	const request = eclipseGuard.begin()
	const query = place ? `&longitude=${place.longitude}&latitude=${place.latitude}` : ''

	state.loading = true
	state.error = undefined
	state.notice = undefined

	try {
		const eclipse = await fetchJson<LunarEclipseSummary>(io, `/api/eclipses/lunar?time=${time}&direction=${direction}${query}`, { signal: request.signal })
		if (!request.current()) return

		state.eclipse = eclipse
		state.map = undefined
		state.local = undefined
		if (!eclipse.contacts.some((contact) => contact.kind === state.selectedEvent)) state.selectedEvent = 'MAX'
		void loadLocal(state, io)

		const map = await fetchJson<LunarEclipseMap>(io, `/api/eclipses/lunar/${eclipse.id}/map`, { signal: request.signal })
		if (!request.current()) return
		state.map = map
		state.loading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		if (place && error instanceof ApiResponseError && error.status === 404) state.notice = error.message
		else state.error = errorMessage(error)
		state.loading = false
	}
}

// Searches the eclipse nearest an instant (Unix milliseconds) in a direction and shows it with its map; with
// visibleOnly, only eclipses whose Moon rises above the place's horizon count.
export function findEclipse(state: LunarEclipseState, time: number, direction: EclipseDirection, io: EclipseIo = browserEclipseIo) {
	return searchEclipse(state, time, direction, state.visibleOnly ? state.place : undefined, io)
}

// Loads again the eclipse shown and its map after a failure, or the next eclipse after now when none is shown.
export function retryEclipse(state: LunarEclipseState, io: EclipseIo = browserEclipseIo) {
	return state.eclipse ? searchEclipse(state, state.eclipse.maximum - 1, 'next', undefined, io) : searchEclipse(state, io.time(), 'next', undefined, io)
}

// Shows the next eclipse after the one shown, or the first one after now when none is shown.
export function nextEclipse(state: LunarEclipseState, io: EclipseIo = browserEclipseIo) {
	return findEclipse(state, state.eclipse?.maximum ?? io.time(), 'next', io)
}

// Shows the eclipse before the one shown, or the last one before now when none is shown.
export function previousEclipse(state: LunarEclipseState, io: EclipseIo = browserEclipseIo) {
	return findEclipse(state, state.eclipse?.maximum ?? io.time(), 'previous', io)
}

// Shows the first eclipse on or after a UTC calendar date (YYYY-MM-DD).
export function findEclipseFrom(state: LunarEclipseState, date: string, io: EclipseIo = browserEclipseIo) {
	return findEclipse(state, utcDateStart(date) - 1, 'next', io)
}

// Opens the tool: on the first visit, takes the Sky observer as the place, when there is one, and shows the next
// eclipse after now; later visits keep what was shown.
export function openLunarEclipseMap(state: LunarEclipseState, observer: SkyObserverSettings | undefined, io: EclipseIo = browserEclipseIo) {
	state.place ??= observer && observerPlace(observer)
	if (!state.eclipse && !state.loading) void findEclipse(state, io.time(), 'next', io)
}

// Loads the local circumstances of the eclipse shown from the place, with the Local View of the selected contact;
// does nothing without both. A newer request discards this one's late answer.
export async function loadLocal(state: LunarEclipseState, io: EclipseIo = browserEclipseIo) {
	const { eclipse, place, view } = state

	if (!eclipse || !place) {
		localGuard.cancel()
		state.localLoading = false
		return
	}

	const request = localGuard.begin()
	state.localLoading = true
	state.localError = undefined

	try {
		const query = `longitude=${place.longitude}&latitude=${place.latitude}&event=${state.selectedEvent}&orientation=${view.orientation}&handedness=${view.handedness}&ghosts=${view.ghosts}`
		const local = await fetchJson<LocalLunarEclipse>(io, `/api/eclipses/lunar/${eclipse.id}/local?${query}`, { signal: request.signal })
		if (!request.current()) return
		state.local = local
		state.localLoading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.localError = errorMessage(error)
		state.localLoading = false
	}
}

// Shows a place's local circumstances; the profile's observer is never changed.
export function selectPlace(state: LunarEclipseState, place: EclipsePlace, io: EclipseIo = browserEclipseIo) {
	state.place = place
	state.local = undefined
	return loadLocal(state, io)
}

// Highlights a contact on the map and draws it in the Local View; the global map is not loaded again.
export function selectEvent(state: LunarEclipseState, kind: LunarEclipseContactKind, io: EclipseIo = browserEclipseIo) {
	if (state.selectedEvent === kind) return
	state.selectedEvent = kind
	return loadLocal(state, io)
}

// Changes the presentation of the Local View.
export function setViewSettings(state: LunarEclipseState, settings: Partial<LunarEclipseViewSettings>, io: EclipseIo = browserEclipseIo) {
	Object.assign(state.view, settings)
	return loadLocal(state, io)
}

// Durations of the phases of an eclipse, in seconds; a phase the eclipse lacks is absent.
export interface LunarEclipsePhaseDurations {
	// From P1 to P4.
	readonly penumbral?: number
	// From U1 to U4.
	readonly partial?: number
	// From U2 to U3.
	readonly total?: number
}

// Returns the durations of the phases of an eclipse from its contacts, the same for every observer.
export function phaseDurations(eclipse: LunarEclipseSummary): LunarEclipsePhaseDurations {
	const times: Partial<Record<LunarEclipseContactKind, number>> = {}
	for (const contact of eclipse.contacts) times[contact.kind] = contact.time
	const span = (from: LunarEclipseContactKind, to: LunarEclipseContactKind) => (times[from] !== undefined && times[to] !== undefined ? (times[to] - times[from]) / 1000 : undefined)
	return { penumbral: span('P1', 'P4'), partial: span('U1', 'U4'), total: span('U2', 'U3') }
}
