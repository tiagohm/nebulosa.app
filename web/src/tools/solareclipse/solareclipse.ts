import type { EclipseDirection, LocalCentralPhaseKind, LocalEclipseContactKind, LocalSolarEclipse, LocalViewHandedness, LocalViewOrientationMode, SolarEclipseExtreme, SolarEclipseMap, SolarEclipseMapPoint, SolarEclipsePointKind, SolarEclipseSummary, SolarEclipseType } from 'api'
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
	// Named global points: contacts, ends of the central line and of the partial limits, greatest eclipse and duration.
	points: boolean
	// Names of the global points, beside their markers.
	labels: boolean
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
	// Global point highlighted on the map and detailed in the panel.
	selectedPoint?: GlobalPointKind
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
		layers: { centralLine: true, umbralLimits: true, penumbralLimits: true, riseSet: true, points: true, labels: true },
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

// A global point: a named point of the map, or GD, the greatest duration of the central phase.
export type GlobalPointKind = SolarEclipsePointKind | 'GD'

// Family of a global point, which sets its marker: a contact of the penumbra or of the umbra with the Earth's
// limb, an end of the central line, an end of a partial limit, or an extreme of the eclipse.
export type GlobalPointFamily = 'penumbralContact' | 'umbralContact' | 'centralLineEnd' | 'limitEnd' | 'extreme'

// Description of a global point, for people.
export interface GlobalPointInfo {
	// Short name.
	readonly name: string
	// What the point is.
	readonly description: string
	// Family.
	readonly family: GlobalPointFamily
}

// Descriptions of the global points. They are global: C1 and C2 here are the ends of the central line on the
// Earth, never the contacts of a place, and the umbra stands for the antumbra of an annular eclipse.
export const GLOBAL_POINTS: Readonly<Record<GlobalPointKind, GlobalPointInfo>> = {
	P1: { name: 'Eclipse begins on Earth', description: 'First external contact of the penumbra with the Earth: the partial eclipse begins, at sunrise.', family: 'penumbralContact' },
	P2: { name: 'Penumbra wholly on Earth', description: 'First internal contact of the penumbra: from now on the whole penumbra lies on the Earth.', family: 'penumbralContact' },
	P3: { name: 'Penumbra starts leaving Earth', description: 'Last internal contact of the penumbra: from now on part of the penumbra misses the Earth.', family: 'penumbralContact' },
	P4: { name: 'Eclipse ends on Earth', description: 'Last external contact of the penumbra with the Earth: the partial eclipse ends, at sunset.', family: 'penumbralContact' },
	U1: { name: 'Central shadow reaches Earth', description: 'First external contact of the umbra (the antumbra of an annular eclipse) with the Earth: the central eclipse begins, at sunrise.', family: 'umbralContact' },
	U2: { name: 'Central shadow wholly on Earth', description: 'First internal contact of the umbra: from now on the whole umbra lies on the Earth.', family: 'umbralContact' },
	U3: { name: 'Central shadow starts leaving Earth', description: 'Last internal contact of the umbra: from now on part of the umbra misses the Earth.', family: 'umbralContact' },
	U4: { name: 'Central shadow leaves Earth', description: 'Last external contact of the umbra with the Earth: the central eclipse ends, at sunset.', family: 'umbralContact' },
	C1: { name: 'Central line begins', description: 'Where the shadow axis first meets the Earth: the central line begins, with the Sun on the horizon at sunrise.', family: 'centralLineEnd' },
	C2: { name: 'Central line ends', description: 'Where the shadow axis leaves the Earth: the central line ends, with the Sun on the horizon at sunset.', family: 'centralLineEnd' },
	N1: { name: 'Northern limit begins', description: 'Earlier end of the northern limit of the partial eclipse, on the sunrise/sunset curve: there the Moon just grazes the Sun on the horizon. With a single limit, N1 and S1 are its two ends, in time order.', family: 'limitEnd' },
	N2: { name: 'Northern limit ends', description: 'Later end of the northern limit of the partial eclipse, on the sunrise/sunset curve: there the Moon just grazes the Sun on the horizon.', family: 'limitEnd' },
	S1: { name: 'Southern limit begins', description: 'Earlier end of the southern limit of the partial eclipse, on the sunrise/sunset curve: there the Moon just grazes the Sun on the horizon. With a single limit, S1 is its later end.', family: 'limitEnd' },
	S2: { name: 'Southern limit ends', description: 'Later end of the southern limit of the partial eclipse, on the sunrise/sunset curve: there the Moon just grazes the Sun on the horizon.', family: 'limitEnd' },
	MAX: { name: 'Greatest eclipse', description: 'Where the shadow axis passes closest to the Earth’s center, at the instant of greatest eclipse; for a partial eclipse, the place on the Earth’s limb nearest the axis.', family: 'extreme' },
	GD: { name: 'Greatest duration', description: 'The point of the central line where the total or annular phase lasts longest, generally not the greatest eclipse.', family: 'extreme' },
}

// A global point of an eclipse, with what is known of it.
export interface GlobalPoint extends SolarEclipseMapPoint {
	// Which point.
	readonly kind: GlobalPointKind
	// Circumstances of the greatest eclipse or duration, for MAX and GD.
	readonly extreme?: SolarEclipseExtreme
}

// Returns the global points of a map in time order, the greatest duration among them; points without a time last.
export function globalPoints(map: SolarEclipseMap): GlobalPoint[] {
	const points: GlobalPoint[] = []

	for (const [kind, point] of Object.entries(map.points) as [SolarEclipsePointKind, SolarEclipseMapPoint | undefined][]) {
		if (point) points.push(kind === 'MAX' && map.greatestEclipse ? { ...point, kind, extreme: map.greatestEclipse } : { ...point, kind })
	}

	const duration = map.greatestDuration
	if (duration) points.push({ kind: 'GD', longitude: duration.longitude, latitude: duration.latitude, time: duration.time, sunAltitude: duration.sunAltitude, extreme: duration })

	return points.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity))
}

// Distance in degrees, along each axis, below which two global points share a stack of labels, so the labels of
// points that nearly coincide on the whole map, such as C1, U1, and U2, do not overlap.
const LABEL_STACK_DISTANCE = 3

// Returns the row of each point's label in its stack, 0 for the first point of a stack; points are taken in order,
// and a point joins the stack of the first earlier point within LABEL_STACK_DISTANCE of it.
export function labelRows(points: readonly GlobalPoint[]): number[] {
	const rows: number[] = []
	const anchors: { readonly point: GlobalPoint; size: number }[] = []

	for (const point of points) {
		const anchor = anchors.find(({ point: other }) => Math.abs(other.latitude - point.latitude) < LABEL_STACK_DISTANCE && Math.abs(((other.longitude - point.longitude + 540) % 360) - 180) < LABEL_STACK_DISTANCE)

		if (anchor) {
			rows.push(anchor.size++)
		} else {
			anchors.push({ point, size: 1 })
			rows.push(0)
		}
	}

	return rows
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
		state.selectedPoint = undefined
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

// Shows the eclipse an id names with its map, as a link to it asks; does nothing when it is already shown. The
// eclipse shown before is cleared at once, so an id that names no eclipse shows the error, never another eclipse. A
// newer search or id discards this one's late answers.
export async function showEclipse(state: SolarEclipseState, id: string, io: EclipseIo = browserEclipseIo) {
	if (state.eclipse?.id === id && state.map && !state.loading) return

	const request = eclipseGuard.begin()

	state.loading = true
	state.error = undefined
	state.notice = undefined

	if (state.eclipse?.id !== id) {
		state.eclipse = undefined
		state.map = undefined
		state.selectedPoint = undefined
		state.local = undefined
	}

	try {
		const map = await fetchJson<SolarEclipseMap>(io, `/api/eclipses/solar/${encodeURIComponent(id)}/map`, { signal: request.signal })
		if (!request.current()) return
		state.eclipse = map.eclipse
		state.map = map
		state.loading = false
		void loadLocal(state, io)
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.error = errorMessage(error)
		state.loading = false
	}
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

// Highlights a global point on the map and details it in the panel; choosing the highlighted one again clears it.
// Nothing is asked of the API.
export function selectPoint(state: SolarEclipseState, kind: GlobalPointKind | undefined) {
	state.selectedPoint = state.selectedPoint === kind ? undefined : kind
}
