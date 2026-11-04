import type { SatelliteDetails, SatelliteEphemerisResponse, SatelliteEphemerisRow, SatelliteImportResponse, SatellitePassesResponse, SatellitePosition, SatellitePositionResponse, SatelliteSearchPage } from 'api'
import { proxy } from 'valtio'
import { fetchJson, jsonInit } from '../../http'
import type { SkyObserverSettings } from '../../profile/schema'
import { navigate, type RouteState, routeState } from '../../shell/route'
import { setSkyTime, SKY_REALTIME_TICK_MS, type SkyClock, skyClock, skyTime } from '../../sky/clock'
import { createRequestGuard } from '../../sky/selection'
import { apiObserver, browserSkyIo, selectSkyObject, type SkyIo, type SkyState, skyState } from '../../sky/sky'

// State of the Artificial Satellites tool, tab-lived and never persisted: the catalog search, the satellite selected
// with its details and position, the windows of its passes and ephemeris, and an import being typed. Every prediction
// is for the Sky observer of the active profile, or the Earth's center without one. The catalog, its downloads, and
// every prediction are the server's; each kind of answer has a request guard of its own, so an old answer never replaces
// a newer one, and only the position now repeats by itself (POSITION_REFRESH_MS). Times are Unix milliseconds (UTC), and
// angles radians until they are formatted. The profile's favorites and the Sky change only
// through explicit actions.

// Milliseconds per hour and per day.
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// Interval between two readings of the position now, in milliseconds: the real-time tick of the Sky.
export const POSITION_REFRESH_MS = SKY_REALTIME_TICK_MS

// Rows of a page of the catalog.
export const CATALOG_PAGE_SIZE = 50

// Longest pass window, in days, which keeps a search within a couple of seconds of the server.
export const MAX_PASS_DAYS = 7

// Longest ephemeris, in hours, and the most rows the server answers.
export const MAX_EPHEMERIS_HOURS = 72
export const MAX_EPHEMERIS_ROWS = 5000

// Views of the tool.
export const SATELLITE_TABS = ['catalog', 'passes', 'ephemeris'] as const

// View of the tool.
export type SatelliteTab = (typeof SATELLITE_TABS)[number]

// Name of each view.
export const SATELLITE_TAB_LABELS: Readonly<Record<SatelliteTab, string>> = { catalog: 'Catalog', passes: 'Passes', ephemeris: 'Ephemeris' }

// Start of a pass search or an ephemeris: the real current time, or the instant the Sky shows.
export type SatelliteWindowStart = 'now' | 'sky'

// Twilight limits of a visible part of a pass, by the altitude of the Sun's center in degrees.
export const TWILIGHT_LIMITS = { civil: -6, nautical: -12, astronomical: -18 } as const

// Twilight limit of a visible part of a pass.
export type TwilightLimit = keyof typeof TWILIGHT_LIMITS

// Name of each twilight limit.
export const TWILIGHT_LABELS: Readonly<Record<TwilightLimit, string>> = { civil: 'Civil (−6°)', nautical: 'Nautical (−12°)', astronomical: 'Astronomical (−18°)' }

// Pass search being edited.
export interface PassDraft {
	// Start of the window.
	start: SatelliteWindowStart
	// Length of the window, days, 1 to MAX_PASS_DAYS.
	days: number
	// Minimum altitude, degrees, 0 to 89.
	minAltitude: number
	// Twilight limit of the visible parts.
	twilight: TwilightLimit
	// Whether passes without a visible part are listed.
	showAll: boolean
}

// Ephemeris being edited.
export interface EphemerisDraft {
	// Start of the table.
	start: SatelliteWindowStart
	// Length, hours, up to MAX_EPHEMERIS_HOURS.
	hours: number
	// Step between rows, seconds, at least 1.
	stepSeconds: number
}

// Artificial Satellites state of the tab.
export interface ArtificialSatellitesState {
	// View shown.
	tab: SatelliteTab
	// Text of the search, as typed.
	query: string
	// Source key of the group searched; empty for every object.
	group: string
	// Whether only the profile's favorites are searched.
	favoritesOnly: boolean
	// First object of the page, from 0.
	offset: number
	// Latest page received.
	results?: SatelliteSearchPage
	// Whether a page is being read, and why the latest could not be.
	searching: boolean
	searchError?: string
	// NORAD id of the satellite selected.
	selectedId?: string
	// Details of the satellite selected, its position at the latest instant asked for, and their states.
	details?: SatelliteDetails
	detailsError?: string
	position?: SatellitePositionResponse
	positionError?: string
	// Latitude, longitude, and elevation of the observer the predictions shown were made for; empty for the Earth's
	// center, absent before the first observer was seen.
	observerKey?: string
	// Pass search being edited, the latest answer, and its state.
	passDraft: PassDraft
	passes?: SatellitePassesResponse
	passesLoading: boolean
	passesError?: string
	// Pass shown in the profile, by its position in the answer.
	selectedPass?: number
	// Ephemeris being edited, the latest answer, and its state.
	ephemerisDraft: EphemerisDraft
	ephemeris?: SatelliteEphemerisResponse
	ephemerisLoading: boolean
	ephemerisError?: string
	// Text of an import, the latest answer, and its state.
	importText: string
	importing: boolean
	importResult?: SatelliteImportResponse
	importError?: string
}

// Side effects of the tool, replaced in tests.
export interface ArtificialSatellitesIo {
	// Fetch of the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Real current time, Unix milliseconds.
	readonly now: () => number
	// Instant the Sky shows, Unix milliseconds (UTC).
	readonly skyTime: () => number
}

// Browser implementation of the side effects.
const browserIo: ArtificialSatellitesIo = { fetch: (input, init) => fetch(input, init), now: () => Date.now(), skyTime: () => skyTime(skyClock, Date.now()) }

// Requests of each kind of answer; a newer request of a kind supersedes the older.
const searchGuard = createRequestGuard()
const detailsGuard = createRequestGuard()
const positionGuard = createRequestGuard()
const passesGuard = createRequestGuard()
const ephemerisGuard = createRequestGuard()

// Initial state of the tool.
export function initialArtificialSatellitesState(): ArtificialSatellitesState {
	return {
		tab: 'catalog',
		query: '',
		group: '',
		favoritesOnly: false,
		offset: 0,
		searching: false,
		passDraft: { start: 'now', days: 2, minAltitude: 10, twilight: 'civil', showAll: true },
		passesLoading: false,
		ephemerisDraft: { start: 'now', hours: 2, stepSeconds: 60 },
		ephemerisLoading: false,
		importText: '',
		importing: false,
	}
}

// Artificial Satellites state of the tab.
export const artificialSatellitesState = proxy<ArtificialSatellitesState>(initialArtificialSatellitesState())

// Message of a failure.
function messageOf(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

// Whether a failure is the abort of a superseded request.
function aborted(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError'
}

// Searches the catalog with the text, group, and favorites of the state, from `offset`. Favorites only with no favorite
// answers an empty page without asking.
export async function searchSatellites(state: ArtificialSatellitesState, favorites: readonly string[], offset = 0, io: ArtificialSatellitesIo = browserIo) {
	const request = searchGuard.begin()
	state.offset = offset
	state.searching = true
	state.searchError = undefined

	if (state.favoritesOnly && favorites.length === 0) {
		state.results = { items: [], total: 0 }
		state.searching = false
		return
	}

	const params = new URLSearchParams({ limit: `${CATALOG_PAGE_SIZE}`, offset: `${offset}` })
	if (state.query.trim()) params.set('q', state.query.trim())
	if (state.group) params.set('group', state.group)
	if (state.favoritesOnly) params.set('ids', favorites.join(','))

	try {
		const results = await fetchJson<SatelliteSearchPage>(io, `/api/satellites?${params}`, { signal: request.signal })
		if (!request.current()) return
		state.results = results
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.searchError = messageOf(error)
	}

	state.searching = false
}

// Selects a satellite: reads its details and its position now for the observer. Another satellite drops the passes and the
// ephemeris of the previous one at once, so they are never shown as the new one's.
export async function selectSatellite(state: ArtificialSatellitesState, noradId: string, observer: SkyObserverSettings | undefined, io: ArtificialSatellitesIo = browserIo) {
	if (state.selectedId !== noradId) {
		state.selectedId = noradId
		state.details = undefined
		state.position = undefined
		state.passes = undefined
		state.passesError = undefined
		state.selectedPass = undefined
		state.ephemeris = undefined
		state.ephemerisError = undefined
		passesGuard.cancel()
		ephemerisGuard.cancel()
	}

	await Promise.all([loadSatelliteDetails(state, io), loadSatellitePosition(state, observer, io)])
}

// Reads the details of the satellite selected.
export async function loadSatelliteDetails(state: ArtificialSatellitesState, io: ArtificialSatellitesIo = browserIo) {
	const noradId = state.selectedId
	if (!noradId) return
	const request = detailsGuard.begin()
	state.detailsError = undefined

	try {
		const details = await fetchJson<SatelliteDetails>(io, `/api/satellites/${encodeURIComponent(noradId)}`, { signal: request.signal })
		if (!request.current()) return
		state.details = details
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.details = undefined
		state.detailsError = messageOf(error)
	}
}

// Reads the position of the satellite selected at the real current time, for the observer or the Earth's center.
export async function loadSatellitePosition(state: ArtificialSatellitesState, observer: SkyObserverSettings | undefined, io: ArtificialSatellitesIo = browserIo) {
	const noradId = state.selectedId
	if (!noradId) return
	const request = positionGuard.begin()
	state.positionError = undefined

	try {
		const position = await fetchJson<SatellitePositionResponse>(io, `/api/satellites/${encodeURIComponent(noradId)}/position`, jsonInit('POST', { time: io.now(), observer: apiObserver(observer) }, request.signal))
		if (!request.current()) return
		state.position = position
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.position = undefined
		state.positionError = messageOf(error)
	}
}

// Follows the Sky observer: when it differs from the one the predictions shown were made for, the position is read
// again, and the passes and ephemeris of the previous observer are dropped at once. The first observer seen is only
// recorded.
export function followSatelliteObserver(state: ArtificialSatellitesState, observer: SkyObserverSettings | undefined, io: ArtificialSatellitesIo = browserIo) {
	const key = observer ? `${observer.latitude},${observer.longitude},${observer.elevation}` : ''
	if (state.observerKey === key) return
	const first = state.observerKey === undefined
	state.observerKey = key
	if (first) return
	state.passes = undefined
	state.selectedPass = undefined
	state.ephemeris = undefined
	passesGuard.cancel()
	ephemerisGuard.cancel()
	void loadSatellitePosition(state, observer, io)
}

// Start of a window, Unix milliseconds: the real current time, or the instant the Sky shows.
function windowStart(start: SatelliteWindowStart, io: ArtificialSatellitesIo) {
	return start === 'now' ? io.now() : io.skyTime()
}

// Searches the passes of the satellite selected over the observer, with the draft. Needs an observer.
export async function loadSatellitePasses(state: ArtificialSatellitesState, observer: SkyObserverSettings | undefined, io: ArtificialSatellitesIo = browserIo) {
	const site = apiObserver(observer)
	if (!state.selectedId || !site) return
	const request = passesGuard.begin()
	const { start, days, minAltitude, twilight } = state.passDraft
	const from = windowStart(start, io)
	const body = { observer: site, start: from, end: from + Math.min(Math.max(days, 1), MAX_PASS_DAYS) * DAY_MS, minAltitude: (minAltitude * Math.PI) / 180, maxSunAltitude: (TWILIGHT_LIMITS[twilight] * Math.PI) / 180 }
	state.passesLoading = true
	state.passesError = undefined

	try {
		const passes = await fetchJson<SatellitePassesResponse>(io, `/api/satellites/${encodeURIComponent(state.selectedId)}/passes`, jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.passes = passes
		state.selectedPass = passes.passes.length > 0 ? 0 : undefined
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.passes = undefined
		state.passesError = messageOf(error)
	}

	state.passesLoading = false
}

// Number of rows an ephemeris draft asks for.
export function ephemerisRowCount({ hours, stepSeconds }: Pick<EphemerisDraft, 'hours' | 'stepSeconds'>) {
	return Math.floor((hours * 3600) / Math.max(stepSeconds, 1)) + 1
}

// Why an ephemeris draft cannot be computed; undefined when it can.
export function ephemerisDraftError(draft: EphemerisDraft) {
	if (!(draft.stepSeconds >= 1)) return 'The step must be at least 1 second.'
	if (!(draft.hours > 0 && draft.hours <= MAX_EPHEMERIS_HOURS)) return `The length must be between 0 and ${MAX_EPHEMERIS_HOURS} hours.`
	if (ephemerisRowCount(draft) > MAX_EPHEMERIS_ROWS) return `At most ${MAX_EPHEMERIS_ROWS} rows: lengthen the step or shorten the table.`
	return undefined
}

// Computes the ephemeris of the satellite selected with the draft, for the observer or the Earth's center.
export async function loadSatelliteEphemeris(state: ArtificialSatellitesState, observer: SkyObserverSettings | undefined, io: ArtificialSatellitesIo = browserIo) {
	if (!state.selectedId || ephemerisDraftError(state.ephemerisDraft)) return
	const request = ephemerisGuard.begin()
	const { start, hours, stepSeconds } = state.ephemerisDraft
	const from = windowStart(start, io)
	const body = { start: from, end: from + hours * HOUR_MS, step: stepSeconds * 1000, observer: apiObserver(observer) }
	state.ephemerisLoading = true
	state.ephemerisError = undefined

	try {
		const ephemeris = await fetchJson<SatelliteEphemerisResponse>(io, `/api/satellites/${encodeURIComponent(state.selectedId)}/ephemeris`, jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.ephemeris = ephemeris
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.ephemeris = undefined
		state.ephemerisError = messageOf(error)
	}

	state.ephemerisLoading = false
}

// Imports the text of the state as element sets; the objects imported can then be searched and predicted.
export async function importSatelliteElements(state: ArtificialSatellitesState, io: ArtificialSatellitesIo = browserIo) {
	if (!state.importText.trim() || state.importing) return
	state.importing = true
	state.importError = undefined
	state.importResult = undefined

	try {
		state.importResult = await fetchJson<SatelliteImportResponse>(io, '/api/satellites/import', jsonInit('POST', { text: state.importText }))
		if (state.importResult.imported.length > 0) state.importText = ''
	} catch (error) {
		state.importError = messageOf(error)
	}

	state.importing = false
}

// Sets the element set the predictions of the satellite selected use (null for GP, then imported), then reads it again.
export async function setSatelliteElementSource(state: ArtificialSatellitesState, kind: 'gp' | 'manual' | null, observer: SkyObserverSettings | undefined, io: ArtificialSatellitesIo = browserIo) {
	const noradId = state.selectedId
	if (!noradId) return

	try {
		const response = await io.fetch(`/api/satellites/${encodeURIComponent(noradId)}/element-source`, jsonInit('PUT', { kind }))
		if (!response.ok) throw new Error(`${response.status}`)
	} catch (error) {
		state.detailsError = messageOf(error)
		return
	}

	state.passes = undefined
	state.ephemeris = undefined
	await Promise.all([loadSatelliteDetails(state, io), loadSatellitePosition(state, observer, io)])
}

// Places the Sky in a tool: what showing an object changes, replaced in tests.
export interface SatelliteSkyHandoff {
	readonly sky: SkyState
	readonly clock: SkyClock
	readonly route: RouteState
	readonly io: SkyIo
	readonly history: Pick<History, 'pushState'>
}

// Returns the Sky of the tab.
function browserHandoff(): SatelliteSkyHandoff {
	return { sky: skyState, clock: skyClock, route: routeState, io: browserSkyIo, history: window.history }
}

// Shows a satellite in the Sky workspace, selected through the Sky's own path. With `time` (Unix milliseconds) the
// simulation clock moves there first; without it the clock is left alone. Neither the observer nor any device changes.
export function showSatelliteInSky(noradId: string, name: string, observer: SkyObserverSettings | undefined, time?: number, handoff: SatelliteSkyHandoff = browserHandoff()) {
	if (time !== undefined) setSkyTime(handoff.clock, time)
	selectSkyObject(handoff.sky, { ref: { kind: 'satellite', noradId }, source: 'search', name, category: 'satellite' }, observer, handoff.io)
	navigate(handoff.route, { workspace: 'sky' }, handoff.history)
}

// Opens the Observer panel of the Sky, where the observer of every prediction of the tool is set.
export function openSkyObserver(sky: SkyState = skyState, route: RouteState = routeState) {
	sky.panel = 'observer'
	navigate(route, { workspace: 'sky' })
}

// Opens the tool on a satellite: /tools/artificial-satellites/<noradId>.
export function openArtificialSatellites(noradId: string, route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	navigate(route, { workspace: 'tools', tool: 'artificial-satellites', satellite: noradId }, history)
}

// Name of each illumination state.
export const SHADOW_LABELS: Readonly<Record<SatellitePosition['shadow'], string>> = { sunlit: 'Sunlit', penumbra: 'Penumbra', umbra: 'In shadow' }

// Returns a time as YYYY-MM-DD HH:mm:ss in a zone (empty for the browser's), from Unix milliseconds.
export function formatSatelliteTime(time: number, timeZone: string) {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: timeZone || undefined, dateStyle: 'short', timeStyle: 'medium' }).format(time)
}

// Formats an angle in radians as degrees with a number of decimals.
export function degrees(radians: number, decimals = 2) {
	return `${((radians * 180) / Math.PI).toFixed(decimals)}°`
}

// Formats an age in days, with its sign: elements older than the instant are a positive age.
export function formatElementAge(days: number) {
	const value = Math.abs(days)
	const text = value < 1 ? `${(value * 24).toFixed(1)} h` : `${value.toFixed(1)} d`
	return days < 0 ? `${text} before the epoch` : text
}

// Columns of the ephemeris export, with how each row gives them. Angles are degrees, distances km, rates km/s.
const CSV_COLUMNS: readonly (readonly [string, (row: SatelliteEphemerisRow, timeZone: string) => string])[] = [
	['time_utc', (row) => new Date(row.time).toISOString()],
	['time_local', (row, timeZone) => formatSatelliteTime(row.time, timeZone)],
	['ra_of_date_deg', (row) => ((row.rightAscension * 180) / Math.PI).toFixed(6)],
	['dec_of_date_deg', (row) => ((row.declination * 180) / Math.PI).toFixed(6)],
	['ra_j2000_deg', (row) => ((row.rightAscensionJ2000 * 180) / Math.PI).toFixed(6)],
	['dec_j2000_deg', (row) => ((row.declinationJ2000 * 180) / Math.PI).toFixed(6)],
	['azimuth_deg', (row) => (row.azimuth === undefined ? '' : ((row.azimuth * 180) / Math.PI).toFixed(4))],
	['altitude_deg', (row) => (row.altitude === undefined ? '' : ((row.altitude * 180) / Math.PI).toFixed(4))],
	['distance_km', (row) => row.distanceKm.toFixed(3)],
	['range_rate_km_s', (row) => (row.rangeRateKmPerSecond === undefined ? '' : row.rangeRateKmPerSecond.toFixed(4))],
	['subpoint_lat_deg', (row) => ((row.subpointLatitude * 180) / Math.PI).toFixed(4)],
	['subpoint_lon_deg', (row) => ((row.subpointLongitude * 180) / Math.PI).toFixed(4)],
	['height_km', (row) => row.heightKm.toFixed(3)],
	['shadow', (row) => row.shadow],
]

// Returns the rows of an ephemeris as CSV text (RFC 4180, comma-separated, CRLF lines), with a header. RA/Dec of date
// are geometric topocentric (or geocentric without an observer) on the true equator and equinox; J2000 is ICRS.
export function ephemerisCsv(rows: readonly SatelliteEphemerisRow[], timeZone: string) {
	const lines = [CSV_COLUMNS.map(([name]) => name).join(',')]
	for (const row of rows) lines.push(CSV_COLUMNS.map(([, value]) => value(row, timeZone)).join(','))
	return `${lines.join('\r\n')}\r\n`
}

// Has the browser save an ephemeris as a CSV file.
export function downloadEphemerisCsv(rows: readonly SatelliteEphemerisRow[], timeZone: string, name: string) {
	const url = URL.createObjectURL(new Blob([ephemerisCsv(rows, timeZone)], { type: 'text/csv' }))
	const link = document.createElement('a')
	link.href = url
	link.download = `${name.replaceAll(/[^\w.-]+/g, '_')}.csv`
	link.click()
	URL.revokeObjectURL(url)
}
