import type { EclipseDirection, LocalLunarEclipse, LocalLunarViewHandedness, LocalLunarViewOrientationMode, LunarEclipseContactKind, LunarEclipseMap, LunarEclipseSummary, LunarEclipseType } from 'api'
import { proxy } from 'valtio'
import { aborted, ApiResponseError, fetchJson } from '../../http'
import { ACTIVE_TOOL_LOCATION, type GeographicLocation, type ToolLocation } from '../../location/site'
import { DEFAULT_ZONE_OVERRIDE, type DisplayZoneOverride } from '../../location/zone'
import { createRequestGuard } from '../../sky/selection'
import type { GeoBounds } from '../../ui/worldmap.geometry'
import { browserEclipseIo, type EclipseIo, type EclipsePlace, eclipsePlace, errorMessage, mapLocation, samePlace, utcDateStart } from '../eclipse/eclipse'

// State of the Lunar Eclipse Map tool and its requests to /api/eclipses/lunar: the eclipse shown and its global
// map, the contact highlighted, the location whose local circumstances are shown, how they are presented, and the
// zone of the times. The location follows eclipse.ts: it is the active profile's site until another site,
// coordinates, or a point of the map is chosen, which never changes the profile; choosing a zone asks for nothing.
// The state lives as long as the tab, so leaving and reopening the tool keeps it; nothing is stored on the server.
// It also holds the pure helpers the map and panel share: the phase of an instant, the visibility headline, the box
// framed on the map, and where the moonrise/moonset lines cross the equator, where they are named.
// Times are Unix milliseconds (UTC), geographic positions degrees, longitude east positive.

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
	// Whether the error is that the eclipse a link names does not exist, a mistyped or cut link rather than a failure.
	unknownLink: boolean
	// Why a search left the eclipse shown as it was, such as no visible eclipse within the searched range.
	notice?: string
	// Contact highlighted on the map and drawn in the Local View.
	selectedEvent: LunarEclipseContactKind
	// Fraction of the local eclipse drawn in the Local View in place of selectedEvent, 0 being P1 and 1 being P4;
	// absent while a contact is drawn. It is kept for another place or eclipse, so they can be compared at the same
	// stage.
	viewFraction?: number
	// Where the tool observes from; the active profile's site until another is chosen.
	location: ToolLocation
	// Coordinates of the location whose local circumstances are asked for, kept by syncPlace; absent without one.
	place?: EclipsePlace
	// Local circumstances of the eclipse shown from the place, once loaded.
	local?: LocalLunarEclipse
	// Whether the local circumstances are being loaded.
	localLoading: boolean
	// Why the local circumstances could not be loaded.
	localError?: string
	// Presentation of the Local View.
	view: LunarEclipseViewSettings
	// Zone the times are shown in, resolved with the location; it never changes a request.
	zone: DisplayZoneOverride
	// Whether stepping between eclipses skips those whose Moon stays below the place's horizon.
	visibleOnly: boolean
	// Whether the map's legend is shown; kept across eclipses, collapsed at first.
	legendOpen: boolean
}

// Initial state of the tool.
export function initialLunarEclipseState(): LunarEclipseState {
	return { loading: false, unknownLink: false, selectedEvent: 'MAX', location: ACTIVE_TOOL_LOCATION, localLoading: false, view: { orientation: 'zenith', handedness: 'eastRight', ghosts: true }, zone: DEFAULT_ZONE_OVERRIDE, visibleOnly: false, legendOpen: false }
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
	state.unknownLink = false
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

// Shows the eclipse an id names with its map, as a link to it asks; does nothing when it is already shown. The
// eclipse shown before is cleared at once, so an id that names no eclipse shows the error, never another eclipse. A
// newer search or id discards this one's late answers.
export async function showLunarEclipse(state: LunarEclipseState, id: string, io: EclipseIo = browserEclipseIo) {
	if (state.eclipse?.id === id && state.map && !state.loading) return

	const request = eclipseGuard.begin()

	state.loading = true
	state.error = undefined
	state.unknownLink = false
	state.notice = undefined

	if (state.eclipse?.id !== id) {
		state.eclipse = undefined
		state.map = undefined
		state.local = undefined
	}

	try {
		const map = await fetchJson<LunarEclipseMap>(io, `/api/eclipses/lunar/${encodeURIComponent(id)}/map`, { signal: request.signal })
		if (!request.current()) return
		state.eclipse = map.eclipse
		state.map = map
		state.loading = false
		if (!map.eclipse.contacts.some((contact) => contact.kind === state.selectedEvent)) state.selectedEvent = 'MAX'
		void loadLocal(state, io)
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.error = errorMessage(error)
		state.unknownLink = error instanceof ApiResponseError && error.status === 404
		state.loading = false
	}
}

// Opens the tool: takes the place of location, the one state.location gives now, and on the first visit shows the
// next eclipse after now; later visits keep what was shown, and the location chosen is never reset.
export function openLunarEclipseMap(state: LunarEclipseState, location: GeographicLocation | undefined, io: EclipseIo = browserEclipseIo) {
	void syncPlace(state, location, io)
	if (!state.eclipse && !state.loading) void findEclipse(state, io.time(), 'next', io)
}

// Loads the local circumstances of the eclipse shown from the place, with the Local View of the selected contact;
// does nothing without both. A newer request discards this one's late answer. Those of the previous place stay shown
// until the answer arrives (see isStaleLocal), and are cleared if it fails, so they never pass for this place's.
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
		const query = `longitude=${place.longitude}&latitude=${place.latitude}&event=${state.viewFraction ?? state.selectedEvent}&orientation=${view.orientation}&handedness=${view.handedness}&ghosts=${view.ghosts}`
		const local = await fetchJson<LocalLunarEclipse>(io, `/api/eclipses/lunar/${eclipse.id}/local?${query}`, { signal: request.signal })
		if (!request.current()) return
		state.local = local
		state.localLoading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.localError = errorMessage(error)
		state.localLoading = false
		if (isStaleLocal(state.local, place)) state.local = undefined
	}
}

// Returns whether local circumstances are those of another place than the one asked for, shown only while the new
// ones load; false without either.
export function isStaleLocal(local: { readonly location: EclipsePlace } | undefined, place: EclipsePlace | undefined): boolean {
	return local !== undefined && place !== undefined && !samePlace(local.location, place)
}

// Takes the place of location, the one state.location gives now (undefined when it gives none), and asks for its
// local circumstances; does nothing when its longitude and latitude are those asked for already, so a new elevation,
// name, or zone of the same place asks for nothing.
export function syncPlace(state: LunarEclipseState, location: GeographicLocation | undefined, io: EclipseIo = browserEclipseIo) {
	const place = eclipsePlace(location)
	if (samePlace(state.place, place)) return
	state.place = place
	// The circumstances of the previous place stay until the new ones arrive, so the panel keeps its sections and its
	// scroll; without a place there are none.
	if (!place) state.local = undefined
	state.localError = undefined
	return loadLocal(state, io)
}

// Observes from a point clicked on the map (degrees, east positive): coordinates typed in, in the zone of the
// coordinates before or UTC (see mapLocation). The profile is never changed.
export function selectMapPlace(state: LunarEclipseState, point: EclipsePlace, io: EclipseIo = browserEclipseIo) {
	const location = mapLocation(state.location, point)
	state.location = location
	return syncPlace(state, location, io)
}

// Highlights a contact on the map and draws it in the Local View; the global map is not loaded again. A fraction drawn before gives way to the
// contact.
export function selectEvent(state: LunarEclipseState, kind: LunarEclipseContactKind, io: EclipseIo = browserEclipseIo) {
	if (state.selectedEvent === kind && state.viewFraction === undefined) return
	state.selectedEvent = kind
	state.viewFraction = undefined
	return loadLocal(state, io)
}

// Draws the Local View at a fraction of the local eclipse, 0 being P1 and 1 being P4, between its contacts;
// only the local circumstances are asked for again.
export function setViewFraction(state: LunarEclipseState, fraction: number, io: EclipseIo = browserEclipseIo) {
	if (state.viewFraction === fraction) return
	state.viewFraction = fraction
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

// Phase of an eclipse at an instant: the Moon in the penumbra only, partly in the umbra, or wholly in it.
export type LunarEclipsePhase = 'penumbral' | 'partial' | 'total'

// Words of each phase, as the end of "during …".
export const PHASE_NAMES: Readonly<Record<LunarEclipsePhase, string>> = { penumbral: 'the penumbral phase', partial: 'the partial phase', total: 'totality' }

// Returns the phase of an eclipse at an instant (Unix milliseconds) between its P1 and P4, from its contacts: total
// from U2 to U3, partial from U1 to U4 outside it, penumbral otherwise.
export function phaseAt(eclipse: LunarEclipseSummary, time: number): LunarEclipsePhase {
	const at = (kind: LunarEclipseContactKind) => eclipse.contacts.find((contact) => contact.kind === kind)?.time
	const within = (from: LunarEclipseContactKind, to: LunarEclipseContactKind) => {
		const start = at(from)
		const end = at(to)
		return start !== undefined && end !== undefined && time >= start && time <= end
	}

	return within('U2', 'U3') ? 'total' : within('U1', 'U4') ? 'partial' : 'penumbral'
}

// Returns the headline of what a place sees of an eclipse: the toolkit's text, except that a penumbral eclipse seen
// only in part reads as such, since its only phase is the penumbral one.
export function visibilityHeadline(type: LunarEclipseType, visibility: LocalLunarEclipse['visibility']): string {
	return type === 'PENUMBRAL' && visibility.kind === 'penumbralOnlyVisible' ? 'Part of the eclipse visible' : visibility.text
}

// Returns the box to frame on the map for an eclipse: the hemisphere where the Moon is up at greatest eclipse, 180°
// of longitude centered on its sublunar point from pole to pole, widened to hold the place when it lies outside, on
// the nearer side; undefined without the greatest eclipse. Degrees, east positive.
export function moonUpBounds(map: LunarEclipseMap, place?: EclipsePlace): GeoBounds | undefined {
	const max = map.events.find((event) => event.kind === 'MAX')
	if (!max) return undefined

	let west = max.sublunar.longitude - 90
	let east = west + 180

	if (place) {
		// Degrees east of the western edge, in [0, 360): beyond 180 the place is outside, nearer one side or the other.
		const offset = (((place.longitude - west) % 360) + 360) % 360
		if (offset > 180) {
			if (offset - 180 <= 360 - offset) east = west + offset
			else west -= 360 - offset
		}
	}

	const wrapped = ((((west + 180) % 360) + 360) % 360) - 180
	return { west: wrapped, east: wrapped + (east - west), south: -90, north: 90 }
}

// A vertex of SVG path data on the degree plane: the command (M starts a subpath, L continues it) and x, y.
const PATH_VERTEX = /([ML])\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g

// Returns the longitudes, in degrees in [−180, 180), where a line of the map (SVG path data on the degree plane,
// x = longitude + 180 and y = 90 − latitude) crosses the equator, interpolated between its vertices, in path order;
// the moonrise/moonset line of a contact crosses it twice, once where the Moon rises and once where it sets.
export function equatorCrossings(path: string): number[] {
	const longitudes: number[] = []
	let previous: { readonly x: number; readonly y: number } | undefined

	for (const [, command, x, y] of path.matchAll(PATH_VERTEX)) {
		const point = { x: +x, y: +y }

		if (command === 'L' && previous && (previous.y - 90) * (point.y - 90) <= 0 && previous.y !== point.y) {
			const t = (90 - previous.y) / (point.y - previous.y)
			// A vertex exactly on the equator ends one segment and starts the next; it counts once.
			if (t > 0 || longitudes.length === 0) longitudes.push(((((previous.x + t * (point.x - previous.x)) % 360) + 360) % 360) - 180)
		}

		previous = point
	}

	return longitudes
}

// Returns the durations of the phases of an eclipse from its contacts, the same for every observer.
export function phaseDurations(eclipse: LunarEclipseSummary): LunarEclipsePhaseDurations {
	const times: Partial<Record<LunarEclipseContactKind, number>> = {}
	for (const contact of eclipse.contacts) times[contact.kind] = contact.time
	const span = (from: LunarEclipseContactKind, to: LunarEclipseContactKind) => (times[from] !== undefined && times[to] !== undefined ? (times[to] - times[from]) / 1000 : undefined)
	return { penumbral: span('P1', 'P4'), partial: span('U1', 'U4'), total: span('U2', 'U3') }
}
