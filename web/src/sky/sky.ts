import type { MinorBody, MinorBodySearchResponse, SkyBodyPosition, SkyCatalogObject, SkyConstellation, SkyConstellations, SkyDeepSkyData, SkyEvents, SkyObjectCategory, SkyObjectRef, SkyObserver, SkyPosition, SkyPositionResponse, SkySearchResult, SkyStarData } from 'api'
import { proxy } from 'valtio'
import { jsonInit, responseError } from '../http'
import type { SkyObserverSettings } from '../profile/schema'
import { skyClock, skyTime } from './clock'
import { MAP_STAR_MAGNITUDE_LIMIT } from './display'
import { refKey, type SkySelectionRef } from './objects'
import { createRequestGuard } from './selection'

// State and API access of the tab's Sky workspace: the selected object with its catalog, minor body,
// or constellation data, position, and events; and the contextual panel view. The selection is independent of where it came from (a click on the map or a search
// result); only the latest selection's responses are applied. Map data (stars, deep-sky objects, and
// constellations) is kept in memory for the tab, so returning to the workspace never downloads it again;
// it is downloaded again only for an instant more than a year away from the one it was computed for, as
// precession moves its positions of date. Positions and events are computed for the instant of the Sky
// simulation clock (./clock), which is the real current time unless the user chose another. The mount
// marker can be selected too: its identity and name are kept here, and its position is the mount
// runtime's (./mount), never requested from the sky API.

// Where a selection came from.
export type SkySelectionSource = 'map' | 'search'

// Selected object of the Sky workspace.
export interface SkySelection {
	// Identity of the object.
	readonly ref: SkySelectionRef
	// Stable key of the identity.
	readonly key: string
	// Where the object was selected.
	readonly source: SkySelectionSource
	// Group of the object, when known before its details arrive.
	category?: SkyObjectCategory
	// Display name: the name known when it was selected, replaced by the catalog name.
	name: string
	// Catalog data of a star or deep-sky object, once loaded.
	catalog?: SkyCatalogObject
	// SBDB data of a minor body, once loaded.
	minorBody?: MinorBody
	// Data of a constellation, once loaded.
	constellation?: SkyConstellation
	// Position at the latest instant computed.
	position?: SkyPosition
	// Instant of the latest position requested, Unix milliseconds (UTC), whether it succeeded or not.
	requestedTime?: number
	// Rise, transit, and set for the observer, when there is one.
	events?: SkyEvents
	// Whether the position is being computed.
	loading: boolean
	// Why the latest position could not be computed; previous data stays shown.
	positionError?: string
	// Why the catalog or minor body data could not be loaded.
	detailsError?: string
}

// Content of the contextual panel.
export type SkyPanelView = 'inspector' | 'observer' | 'display' | 'framing'

// Sky workspace state of the tab.
export interface SkyState {
	// Selected object; absent when nothing is selected.
	selection?: SkySelection
	// Content of the contextual panel.
	panel: SkyPanelView
}

// What is known about an object when it is selected.
export interface SkySelectionInput {
	// Identity of the object.
	readonly ref: SkySelectionRef
	// Where it was selected.
	readonly source: SkySelectionSource
	// Name shown until its details arrive.
	readonly name: string
	// Group, when known.
	readonly category?: SkyObjectCategory
	// SBDB data already found by a search.
	readonly minorBody?: MinorBody
}

// Map data of the Sky workspace.
export interface SkyMapData {
	// Stars to render.
	readonly stars: SkyStarData
	// Deep-sky objects to render.
	readonly dsos: SkyDeepSkyData
	// Constellation figures, boundaries, and labels.
	readonly constellations: SkyConstellations
	// Instant the positions of date were computed for, Unix milliseconds (UTC).
	readonly time: number
}

// Browser services the store uses, replaced in tests.
export interface SkyIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Instant the Sky shows, Unix milliseconds (UTC): the simulation clock's.
	readonly time: () => number
}

// Browser implementation of SkyIo.
export const browserSkyIo: SkyIo = {
	fetch: (input, init) => fetch(input, init),
	time: () => skyTime(skyClock, Date.now()),
}

// How a refresh recomputes the selection's position.
export interface SkyRefreshOptions {
	// Largest distance in milliseconds between a kept position's instant and the instant shown.
	readonly tolerance: number
	// Calculation path: `accurate` asks Horizons first; `fast` is local only.
	readonly mode: 'fast' | 'accurate'
}

// Age in milliseconds below which a position is fresh enough that a refresh skips it, such as when the
// selected object is selected again; shorter than the real-time tick of the map (SKY_REALTIME_TICK_MS), so
// every tick refreshes.
const FRESH_POSITION_MS = 5_000

// Refresh while the clock follows the real time: positions younger than FRESH_POSITION_MS are kept.
export const REALTIME_REFRESH: SkyRefreshOptions = { tolerance: FRESH_POSITION_MS, mode: 'accurate' }

// Largest distance in milliseconds between the instant shown and the instant of the map data before the
// data is downloaded again: one Julian year, about 50″ of precession.
export const MAP_DATA_EPOCH_MS = 365.25 * 86_400_000

// Sky workspace state of the tab.
export const skyState = proxy<SkyState>({ panel: 'inspector' })

// Requests of the current selection; a new selection supersedes them.
const selectionGuard = createRequestGuard()

// Latest map data download of the tab, started on the first visit to the workspace, with its instant.
let mapData: { readonly time: number; readonly data: Promise<SkyMapData> } | undefined

// Converts the profile's observer to the API's.
export function apiObserver(observer: SkyObserverSettings | undefined): SkyObserver | undefined {
	return observer && { latitude: observer.latitude, longitude: observer.longitude, elevation: observer.elevation }
}

// Fetches JSON from the API, rejecting with the API's error message on failure.
async function fetchJson<T>(io: SkyIo, input: string, init?: RequestInit): Promise<T> {
	const response = await io.fetch(input, init)
	if (!response.ok) throw new Error(await responseError(response))
	return (await response.json()) as T
}

// Posts a JSON body to the API and returns the JSON answer.
function postJson<T>(io: SkyIo, input: string, body: unknown, signal?: AbortSignal): Promise<T> {
	return fetchJson<T>(io, input, jsonInit('POST', body, signal))
}

// Whether map data computed for an instant can show another instant (both Unix milliseconds).
export function mapDataCovers(dataTime: number, time: number) {
	return Math.abs(time - dataTime) <= MAP_DATA_EPOCH_MS
}

// Returns the map data for the instant shown, downloading it on the first call of the tab and again only
// when the instant is more than MAP_DATA_EPOCH_MS away from the data's. Only the latest download is
// kept; a failed download is forgotten so the next call retries.
export function loadSkyMapData(io: SkyIo = browserSkyIo): Promise<SkyMapData> {
	const time = io.time()

	if (!mapData || !mapDataCovers(mapData.time, time)) {
		const data = Promise.all([fetchJson<SkyStarData>(io, `/api/sky/catalog/stars?time=${time}&magnitude=${MAP_STAR_MAGNITUDE_LIMIT}`), fetchJson<SkyDeepSkyData>(io, `/api/sky/catalog/dsos?time=${time}`), fetchJson<SkyConstellations>(io, `/api/sky/constellations?time=${time}`)]).then(
			([stars, dsos, constellations]) => ({ stars, dsos, constellations, time }),
		)
		const download = { time, data }
		mapData = download

		data.catch(() => {
			if (mapData === download) mapData = undefined
		})
	}

	return mapData.data
}

// Searches the local catalog and the major bodies.
export function searchSky(query: string, signal: AbortSignal, io: SkyIo = browserSkyIo): Promise<SkySearchResult[]> {
	return fetchJson<SkySearchResult[]>(io, `/api/sky/search?q=${encodeURIComponent(query)}`, { signal })
}

// Searches asteroids and comets in SBDB.
export function searchMinorBodies(query: string, signal: AbortSignal, io: SkyIo = browserSkyIo): Promise<MinorBodySearchResponse> {
	return fetchJson<MinorBodySearchResponse>(io, `/api/sky/minorbodies/search?q=${encodeURIComponent(query)}`, { signal })
}

// Computes the position of an object at an instant (Unix milliseconds).
export function fetchSkyPosition(ref: SkyObjectRef, time: number, observer: SkyObserver | undefined, mode: 'fast' | 'accurate', signal?: AbortSignal, io: SkyIo = browserSkyIo): Promise<SkyPositionResponse> {
	return postJson<SkyPositionResponse>(io, '/api/sky/position', { target: ref, time, observer, mode }, signal)
}

// Computes the local positions of the major bodies at an instant (Unix milliseconds) for the map.
export function fetchSkyBodies(time: number, observer: SkyObserver | undefined, signal?: AbortSignal, io: SkyIo = browserSkyIo): Promise<SkyBodyPosition[]> {
	return postJson<SkyBodyPosition[]>(io, '/api/sky/bodies', { time, observer }, signal)
}

// Selects an object and loads its details and position for an observer. Selecting the object already
// selected only refreshes its position.
export function selectSkyObject(state: SkyState, input: SkySelectionInput, observer: SkyObserverSettings | undefined, io: SkyIo = browserSkyIo) {
	const key = refKey(input.ref)

	if (state.selection?.key === key) {
		if (input.minorBody) state.selection.minorBody ??= input.minorBody
		void refreshSkySelection(state, observer, REALTIME_REFRESH, io)
		return
	}

	state.selection = { ref: input.ref, key, source: input.source, category: input.category, name: input.name, minorBody: input.minorBody, loading: true }
	state.panel = 'inspector'
	void loadSelection(state, observer, io, true, 'accurate')
}

// Clears the selection and abandons its requests.
export function clearSkySelection(state: SkyState) {
	selectionGuard.cancel()
	state.selection = undefined
}

// Recomputes the position and events of the selection for an instant (Unix milliseconds; by default the
// instant shown), keeping its details. The map passes the instant of its own update, so the map, the
// position, and the events show the same instant. Skips a selection still loading or whose latest request
// was within the tolerance of the instant, so remounting the workspace, a fast clock, or a failing service
// never piles up requests.
export async function refreshSkySelection(state: SkyState, observer: SkyObserverSettings | undefined, options: SkyRefreshOptions = REALTIME_REFRESH, io: SkyIo = browserSkyIo, time: number = io.time()): Promise<void> {
	const selection = state.selection
	if (!selection || selection.loading || (selection.requestedTime !== undefined && Math.abs(time - selection.requestedTime) <= options.tolerance)) return
	await loadSelection(state, observer, io, false, options.mode, time)
}

// Recomputes the position of the selection for a new observer, first dropping the position and events
// of the previous one so they are never shown as the new observer's.
export function changeSkyObserver(state: SkyState, observer: SkyObserverSettings | undefined, io: SkyIo = browserSkyIo): Promise<void> {
	if (state.selection) {
		state.selection.position = undefined
		state.selection.events = undefined
	}

	return loadSelection(state, observer, io, false, 'accurate')
}

// Loads the position and events of the selection for an instant (Unix milliseconds; by default the instant
// shown) and, when `details` is true or they are missing, its catalog or minor body data. Responses are
// applied only while the request is the latest one for the same object; the position and events of one
// response always replace both, so they never show different instants.
async function loadSelection(state: SkyState, observer: SkyObserverSettings | undefined, io: SkyIo, details: boolean, mode: 'fast' | 'accurate', time: number = io.time()) {
	const selection = state.selection
	if (!selection) return

	const request = selectionGuard.begin()
	const { key, ref } = selection

	// The mount's position comes from its runtime.
	if (ref.kind === 'mount') {
		selection.loading = false
		return
	}

	const applies = () => request.current() && state.selection?.key === key
	selection.loading = true
	selection.requestedTime = time

	const tasks: Promise<void>[] = []

	if (ref.kind === 'catalog' && (details || !selection.catalog)) {
		tasks.push(
			fetchJson<SkyCatalogObject>(io, `/api/sky/objects/${ref.id}`, { signal: request.signal }).then(
				(catalog) => {
					if (!applies()) return
					state.selection!.catalog = catalog
					state.selection!.name = catalog.name
					state.selection!.category = catalog.category
					state.selection!.detailsError = undefined
				},
				(error: unknown) => {
					if (applies()) state.selection!.detailsError = errorMessage(error)
				},
			),
		)
	}

	if (ref.kind === 'constellation' && (details || !selection.constellation)) {
		tasks.push(
			fetchJson<SkyConstellation>(io, `/api/sky/constellations/${ref.code}`, { signal: request.signal }).then(
				(constellation) => {
					if (!applies()) return
					state.selection!.constellation = constellation
					state.selection!.name = constellation.name
					state.selection!.detailsError = undefined
				},
				(error: unknown) => {
					if (applies()) state.selection!.detailsError = errorMessage(error)
				},
			),
		)
	}

	if (ref.kind === 'minorBody' && !selection.minorBody) {
		tasks.push(
			searchMinorBodies(ref.spkId, request.signal, io).then(
				(result) => {
					if (!applies()) return
					if (result.kind === 'found') state.selection!.minorBody = result.body
					else state.selection!.detailsError = 'The Small-Body Database has no data for this object'
				},
				(error: unknown) => {
					if (applies()) state.selection!.detailsError = errorMessage(error)
				},
			),
		)
	}

	tasks.push(
		fetchSkyPosition(ref, time, apiObserver(observer), mode, request.signal, io).then(
			({ position, events }) => {
				if (!applies()) return
				state.selection!.position = position
				state.selection!.events = events
				state.selection!.positionError = undefined
			},
			(error: unknown) => {
				if (applies()) state.selection!.positionError = errorMessage(error)
			},
		),
	)

	await Promise.all(tasks)
	if (applies()) state.selection!.loading = false
}

// Returns the message of a failure, or a generic one.
function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : 'Request failed'
}
