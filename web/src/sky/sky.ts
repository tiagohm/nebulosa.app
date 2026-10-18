import type { MinorBody, MinorBodySearchResponse, SkyBodyPosition, SkyCatalogObject, SkyConstellations, SkyDeepSkyData, SkyEvents, SkyObjectCategory, SkyObjectRef, SkyObserver, SkyPosition, SkyPositionResponse, SkySearchResult, SkyStarData } from 'api'
import { proxy } from 'valtio'
import { responseError } from '../http'
import type { SkyObserverSettings } from '../profile/profile'
import type { CoordinateSystem, ViewState } from './celestial/celestial'
import { refKey } from './objects'
import { createRequestGuard } from './selection'

// State and API access of the tab's Sky workspace: the selected object with its catalog data, minor
// body data, position, and events; the contextual panel view; and the map view kept while the workspace
// is not shown. The selection is independent of where it came from (a click on the map or a search
// result); only the latest selection's responses are applied. Map data (stars, deep-sky objects, and
// constellations) is downloaded once per tab and kept in memory, so returning to the workspace never
// downloads it again. Positions are computed for the real current time: the Sky simulation clock is a
// later addition, and every request already carries its instant.

// Where a selection came from.
export type SkySelectionSource = 'map' | 'search'

// Selected object of the Sky workspace.
export interface SkySelection {
	// Identity of the object.
	readonly ref: SkyObjectRef
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
	// Position at the latest instant computed.
	position?: SkyPosition
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
export type SkyPanelView = 'inspector' | 'observer'

// Sky workspace state of the tab.
export interface SkyState {
	// Selected object; absent when nothing is selected.
	selection?: SkySelection
	// Content of the contextual panel.
	panel: SkyPanelView
	// Map view saved when the workspace unmounts, with the coordinate system of the chart it belongs to;
	// restored when the workspace mounts again with the same kind of chart.
	view?: { readonly coordinateSystem: CoordinateSystem; readonly state: ViewState }
}

// What is known about an object when it is selected.
export interface SkySelectionInput {
	// Identity of the object.
	readonly ref: SkyObjectRef
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
}

// Browser services the store uses, replaced in tests.
export interface SkyIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Current Unix time in milliseconds.
	readonly now: () => number
}

// Browser implementation of SkyIo.
export const browserSkyIo: SkyIo = {
	fetch: (input, init) => fetch(input, init),
	now: () => Date.now(),
}

// Sky workspace state of the tab.
export const skyState = proxy<SkyState>({ panel: 'inspector' })

// Requests of the current selection; a new selection supersedes them.
const selectionGuard = createRequestGuard()

// Map data download of the tab, started on the first visit to the workspace.
let mapData: Promise<SkyMapData> | undefined

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
	return fetchJson<T>(io, input, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
}

// Returns the map data, downloading it on the first call of the tab. A failed download is forgotten so
// the next visit retries.
export function loadSkyMapData(io: SkyIo = browserSkyIo): Promise<SkyMapData> {
	if (!mapData) {
		const time = io.now()
		mapData = Promise.all([fetchJson<SkyStarData>(io, `/api/sky/catalog/stars?time=${time}`), fetchJson<SkyDeepSkyData>(io, `/api/sky/catalog/dsos?time=${time}`), fetchJson<SkyConstellations>(io, `/api/sky/constellations?time=${time}`)]).then(([stars, dsos, constellations]) => ({ stars, dsos, constellations }))
		mapData.catch(() => (mapData = undefined))
	}

	return mapData
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
		void refreshSkySelection(state, observer, io)
		return
	}

	state.selection = { ref: input.ref, key, source: input.source, category: input.category, name: input.name, minorBody: input.minorBody, loading: true }
	state.panel = 'inspector'
	void loadSelection(state, observer, io, true)
}

// Clears the selection and abandons its requests.
export function clearSkySelection(state: SkyState) {
	selectionGuard.cancel()
	state.selection = undefined
}

// Recomputes the position of the selection, keeping its details, after the observer changed or time
// passed.
export function refreshSkySelection(state: SkyState, observer: SkyObserverSettings | undefined, io: SkyIo = browserSkyIo): Promise<void> {
	return loadSelection(state, observer, io, false)
}

// Recomputes the position of the selection for a new observer, first dropping the position and events
// of the previous one so they are never shown as the new observer's.
export function changeSkyObserver(state: SkyState, observer: SkyObserverSettings | undefined, io: SkyIo = browserSkyIo): Promise<void> {
	if (state.selection) {
		state.selection.position = undefined
		state.selection.events = undefined
	}

	return loadSelection(state, observer, io, false)
}

// Loads the position of the selection and, when `details` is true or they are missing, its catalog or
// minor body data. Responses are applied only while the request is the latest one for the same object.
async function loadSelection(state: SkyState, observer: SkyObserverSettings | undefined, io: SkyIo, details: boolean) {
	const selection = state.selection
	if (!selection) return

	const request = selectionGuard.begin()
	const { key, ref } = selection
	const applies = () => request.current() && state.selection?.key === key
	selection.loading = true

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
		fetchSkyPosition(ref, io.now(), apiObserver(observer), 'accurate', request.signal, io).then(
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
