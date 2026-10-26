import type { EclipseDirection, LocalCentralPhaseKind, LocalEclipseContactKind, LocalSolarEclipse, LocalViewHandedness, LocalViewOrientationMode, SolarEclipseMap, SolarEclipsePointKind, SolarEclipseSummary, SolarEclipseType } from 'api'
import { proxy } from 'valtio'
import { ApiResponseError, fetchJson } from '../../http'
import type { SkyObserverSettings } from '../../profile/schema'
import { createRequestGuard } from '../../sky/selection'
import { aborted, browserEclipseIo, type EclipseIo, type EclipsePlace, errorMessage, observerPlace, utcDateStart } from '../eclipse/eclipse'

// State of the Solar Eclipse Map tool and its requests to /api/eclipses/solar: the eclipse shown and its global
// map, the map layers shown, the place whose local circumstances are shown, the contact drawn in the Local View,
// and how it is presented. The place follows eclipse.ts: it starts as the Sky observer of the active profile, and
// choosing another one on the map or by hand never changes the profile. The global map does not depend on a
// contact or a place, so neither asks for it again, and showing or hiding a layer asks for nothing. The state
// lives as long as the tab, so leaving and reopening the tool keeps it; nothing is stored on the server. Times are
// Unix milliseconds (UTC), geographic positions degrees, longitude east positive.

// Presentation of the Local View.
export interface SolarEclipseViewSettings {
	// Whether up is the zenith or celestial north.
	orientation: LocalViewOrientationMode
	// Whether east is to the right or to the left.
	handedness: LocalViewHandedness
	// Whether the Moon disks of the other contacts are drawn.
	ghosts: boolean
}

// Layers of the map that can be shown or hidden.
export interface SolarEclipseLayers {
	// Central line, total and annular parts.
	centralLine: boolean
	// Northern and southern limits of the total or annular eclipse.
	umbralLimits: boolean
	// Northern and southern limits of the partial eclipse.
	penumbralLimits: boolean
	// Where the eclipse begins, is greatest, or ends at sunrise or sunset.
	riseSet: boolean
	// Greatest eclipse, greatest duration, and the ends of the central line and of the eclipse on the Earth.
	points: boolean
}

// State of the tool in the tab.
export interface SolarEclipseState {
	// Eclipse shown.
	eclipse?: SolarEclipseSummary
	// Global map of the eclipse shown, once loaded.
	map?: SolarEclipseMap
	// Whether an eclipse or its map is being loaded.
	loading: boolean
	// Why the eclipse or its map could not be loaded.
	error?: string
	// Why a search left the eclipse shown as it was, such as no visible eclipse within the searched range.
	notice?: string
	// Map layers shown.
	layers: SolarEclipseLayers
	// Contact drawn in the Local View.
	selectedEvent: LocalEclipseContactKind
	// Place whose local circumstances are shown.
	place?: EclipsePlace
	// Local circumstances of the eclipse shown from the place, once loaded.
	local?: LocalSolarEclipse
	// Whether the local circumstances are being loaded.
	localLoading: boolean
	// Why the local circumstances could not be loaded.
	localError?: string
	// Presentation of the Local View.
	view: SolarEclipseViewSettings
	// Time zone chosen for the times: UTC, an IANA zone, or empty for the browser's; undefined follows the place
	// (see displayTimeZone).
	timeZone?: string
	// Whether stepping between eclipses skips those whose Sun stays below the place's horizon.
	visibleOnly: boolean
}

// Initial state of the tool: every layer but the sunrise/sunset curves, which clutter the map, is shown.
export function initialSolarEclipseState(): SolarEclipseState {
	return {
		loading: false,
		layers: { centralLine: true, umbralLimits: true, penumbralLimits: true, riseSet: false, points: true },
		selectedEvent: 'MAX',
		localLoading: false,
		view: { orientation: 'zenith', handedness: 'eastRight', ghosts: true },
		visibleOnly: false,
	}
}

// Solar Eclipse Map state of the tab.
export const solarEclipseState = proxy<SolarEclipseState>(initialSolarEclipseState())

// Requests of the eclipse shown and of its map; a new search supersedes them.
const eclipseGuard = createRequestGuard()

// Requests of the local circumstances; a new place, contact, presentation, or eclipse supersedes them.
const localGuard = createRequestGuard()

// Names of the eclipse types, for people.
export const ECLIPSE_TYPE_NAMES: Readonly<Record<SolarEclipseType, string>> = { total: 'Total', annular: 'Annular', hybrid: 'Hybrid', partial: 'Partial' }

// Names of the global points drawn on the map, for people. C1 and C2 are the ends of the central line on the
// Earth and P1 and P4 those of the eclipse, never the contacts of a place.
export const GLOBAL_POINT_NAMES: Readonly<Partial<Record<SolarEclipsePointKind, string>>> = {
	P1: 'Eclipse begins on Earth',
	C1: 'Central path begins',
	MAX: 'Greatest eclipse',
	C2: 'Central path ends',
	P4: 'Eclipse ends on Earth',
}

// Returns the name of a local contact for people; C2 and C3 name the central phase of the place, total or annular.
export function contactName(kind: LocalEclipseContactKind, centralPhaseKind: LocalCentralPhaseKind): string {
	const central = centralPhaseKind === 'annular' ? 'Annular' : 'Total'

	switch (kind) {
		case 'C1':
			return 'Partial eclipse begins'
		case 'C2':
			return `${central} eclipse begins`
		case 'MAX':
			return 'Greatest eclipse'
		case 'C3':
			return `${central} eclipse ends`
		case 'C4':
			return 'Partial eclipse ends'
	}
}

// Returns the name of the limits of the central path of an eclipse type, for people.
export function limitName(type: SolarEclipseType): string {
	return type === 'total' ? 'Limits of totality' : type === 'annular' ? 'Limits of annularity' : 'Limits of the central path'
}

// Searches the eclipse nearest an instant (Unix milliseconds) in a direction and shows it with its map. With a
// place, only eclipses whose Sun is above its horizon during the local eclipse count; when none is found the
// eclipse shown stays and notice says why. A newer search discards this one's late answers.
async function searchEclipse(state: SolarEclipseState, time: number, direction: EclipseDirection, place: EclipsePlace | undefined, io: EclipseIo) {
	const request = eclipseGuard.begin()
	const query = place ? `&longitude=${place.longitude}&latitude=${place.latitude}` : ''

	state.loading = true
	state.error = undefined
	state.notice = undefined

	try {
		const eclipse = await fetchJson<SolarEclipseSummary>(io, `/api/eclipses/solar?time=${time}&direction=${direction}${query}`, { signal: request.signal })
		if (!request.current()) return

		state.eclipse = eclipse
		state.map = undefined
		state.local = undefined
		void loadLocal(state, io)

		const map = await fetchJson<SolarEclipseMap>(io, `/api/eclipses/solar/${eclipse.id}/map`, { signal: request.signal })
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
// visibleOnly, only eclipses whose Sun is above the place's horizon during the local eclipse count.
export function findEclipse(state: SolarEclipseState, time: number, direction: EclipseDirection, io: EclipseIo = browserEclipseIo) {
	return searchEclipse(state, time, direction, state.visibleOnly ? state.place : undefined, io)
}

// Loads again the eclipse shown and its map after a failure, or the next eclipse after now when none is shown.
export function retryEclipse(state: SolarEclipseState, io: EclipseIo = browserEclipseIo) {
	return state.eclipse ? searchEclipse(state, state.eclipse.maximum - 1, 'next', undefined, io) : searchEclipse(state, io.time(), 'next', undefined, io)
}

// Shows the next eclipse after the one shown, or the first one after now when none is shown.
export function nextEclipse(state: SolarEclipseState, io: EclipseIo = browserEclipseIo) {
	return findEclipse(state, state.eclipse?.maximum ?? io.time(), 'next', io)
}

// Shows the eclipse before the one shown, or the last one before now when none is shown.
export function previousEclipse(state: SolarEclipseState, io: EclipseIo = browserEclipseIo) {
	return findEclipse(state, state.eclipse?.maximum ?? io.time(), 'previous', io)
}

// Shows the first eclipse on or after a UTC calendar date (YYYY-MM-DD).
export function findEclipseFrom(state: SolarEclipseState, date: string, io: EclipseIo = browserEclipseIo) {
	return findEclipse(state, utcDateStart(date) - 1, 'next', io)
}

// Opens the tool: on the first visit, takes the Sky observer as the place, when there is one, and shows the next
// eclipse after now; later visits keep what was shown.
export function openSolarEclipseMap(state: SolarEclipseState, observer: SkyObserverSettings | undefined, io: EclipseIo = browserEclipseIo) {
	state.place ??= observer && observerPlace(observer)
	if (!state.eclipse && !state.loading) void findEclipse(state, io.time(), 'next', io)
}

// Loads the local circumstances of the eclipse shown from the place, with the Local View of the selected contact;
// does nothing without both. A newer request discards this one's late answer.
export async function loadLocal(state: SolarEclipseState, io: EclipseIo = browserEclipseIo) {
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
		const local = await fetchJson<LocalSolarEclipse>(io, `/api/eclipses/solar/${eclipse.id}/local?${query}`, { signal: request.signal })
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
export function selectPlace(state: SolarEclipseState, place: EclipsePlace, io: EclipseIo = browserEclipseIo) {
	state.place = place
	state.local = undefined
	return loadLocal(state, io)
}

// Draws a contact in the Local View; the global map is not loaded again.
export function selectEvent(state: SolarEclipseState, kind: LocalEclipseContactKind, io: EclipseIo = browserEclipseIo) {
	if (state.selectedEvent === kind) return
	state.selectedEvent = kind
	return loadLocal(state, io)
}

// Changes the presentation of the Local View.
export function setViewSettings(state: SolarEclipseState, settings: Partial<SolarEclipseViewSettings>, io: EclipseIo = browserEclipseIo) {
	Object.assign(state.view, settings)
	return loadLocal(state, io)
}

// Shows or hides a map layer; nothing is asked of the API.
export function setLayer(state: SolarEclipseState, layer: keyof SolarEclipseLayers, shown: boolean) {
	state.layers[layer] = shown
}
