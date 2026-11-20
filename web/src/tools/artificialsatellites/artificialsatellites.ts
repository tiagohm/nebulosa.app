import type {
	AstroWeatherNight,
	AstroWeatherNightRequest,
	SatelliteDetails,
	SatelliteEphemerisResponse,
	SatelliteEphemerisRow,
	SatelliteGroundTrackResponse,
	SatelliteImportResponse,
	SatellitePassesRequest,
	SatellitePassesResponse,
	SatellitePassPrediction,
	SatellitePosition,
	SatellitePositionResponse,
	SatelliteQuality,
	SatelliteSearchPage,
} from 'api'
import { proxy } from 'valtio'
import { downloadText } from '../../download'
import { formatDateTime } from '../../format'
import { aborted, type ApiFetch, browserFetch, fetchJson, jsonInit } from '../../http'
import { type GeographicLocation, locationKey, type SiteLocation, siteObserver } from '../../location/site'
import { navigate, type RouteState, routeState } from '../../shell/route'
import { setSkyTime, type SkyClock, skyClock, skyTime } from '../../sky/clock'
import { createRequestGuard } from '../../sky/selection'
import { browserSkyIo, selectSkyObject, type SkyIo, type SkyState, skyState } from '../../sky/sky'

// State of the Artificial Satellites tool, tab-lived and never persisted: the visible passes tonight of the profile's
// favorites or of a downloaded group, the satellite selected with its details, position, and next visible pass, the
// windows of its passes, ephemeris, and ground track, and an import being typed. The search that selects a satellite
// keeps its text and list in its own component; searchSatelliteList reads the catalog for it.
// Every prediction is for the observing site of the active profile, or the Earth's center without one; the tool has no
// place of its own, and the ground track needs none. The catalog, its downloads, and every prediction are the server's;
// each kind of answer has a request guard of its own, so an old answer never replaces a newer one, and only the
// position now (POSITION_REFRESH_MS) and a ground track following the real time (once an orbit) repeat by themselves.
// Times are Unix milliseconds (UTC), and angles radians until they are formatted; civil times are shown in the
// profile's display zone, which only formats them, never asks for anything again. The profile's favorites and the Sky
// change only through explicit actions.

// Milliseconds per hour and per day.
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// Interval between two readings of the position now, in milliseconds: five seconds, a third of the Sky's real-time tick, so
// the altitude and the motion keep up with a low orbit. A reading costs the server under a millisecond; the crossings of
// the umbra it answers with come from a search kept for 1.5 orbits.
export const POSITION_REFRESH_MS = 5000

// Most satellites the search lists at once; the others are counted and found by typing more.
export const SEARCH_LIST_LIMIT = 20

// Longest pass window, in days, which keeps a search within a couple of seconds of the server.
export const MAX_PASS_DAYS = 7

// Longest ephemeris, in hours, and the most rows the server answers.
export const MAX_EPHEMERIS_HOURS = 72
export const MAX_EPHEMERIS_ROWS = 5000

// Most orbits a ground track shows after its instant: GROUND_TRACK_MAX_ORBITS of the server.
export const MAX_GROUND_TRACK_ORBITS = 5

// Views of the tool; Tonight is the one it opens on.
export const SATELLITE_TABS = ['tonight', 'passes', 'groundTrack', 'ephemeris'] as const

// View of the tool.
export type SatelliteTab = (typeof SATELLITE_TABS)[number]

// Name of each view.
export const SATELLITE_TAB_LABELS: Readonly<Record<SatelliteTab, string>> = { tonight: 'Tonight', passes: 'Passes', groundTrack: 'Ground Track', ephemeris: 'Ephemeris' }

// Satellites Tonight predicts: the profile's favorites (an empty key), or the members of a downloaded group by its GP
// source key (gp:GROUP:<name>), never a large group.
export type TonightSource = string

// Most satellites Tonight predicts, the first of the favorites or of the group: SATELLITE_TRACKS_LIMIT of the Sky, which keeps the
// searches of a night within a few seconds of the server.
export const TONIGHT_LIMIT = 50

// Pass searches Tonight keeps in flight at once.
const TONIGHT_CONCURRENCY = 4

// Window of the next visible pass of the satellite selected, in milliseconds after now: two days, as the Sky's Show Next
// Pass.
export const NEXT_PASS_WINDOW_MS = 2 * 86_400_000

// Minimum altitude of the next visible pass of the satellite selected, degrees: low enough to count a pass over the
// trees of most sites, as the default of the pass search.
export const NEXT_PASS_MIN_ALTITUDE = 10

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

// Search of tonight's passes being edited.
export interface TonightDraft {
	// Minimum altitude, degrees, 0 to 89.
	minAltitude: number
	// Twilight limit of the visible parts, which also bounds the dark part of the night shown.
	twilight: TwilightLimit
}

// A visible pass of a favorite tonight.
export interface TonightPass {
	// NORAD id and name of the satellite.
	readonly noradId: string
	readonly name: string
	// The pass, with at least one visible part.
	readonly pass: SatellitePassPrediction
	// Quality of the prediction over the night.
	readonly quality: SatelliteQuality
}

// A satellite whose passes could not be predicted tonight, and why.
export interface TonightFailure {
	readonly noradId: string
	readonly name: string
	// Message of the server, such as no elements or a refused prediction.
	readonly error: string
}

// Visible passes of the favorites, or of a group, over one night of the observing site.
export interface TonightResult {
	// Satellites predicted: the favorites or a group.
	readonly source: TonightSource
	// The night: the Sun from noon to noon, with its twilight crossings.
	readonly night: AstroWeatherNight
	// Window searched, Unix milliseconds (UTC): the rest of the night from the instant asked, to its closing noon.
	readonly start: number
	readonly end: number
	// Twilight limit and minimum altitude (degrees) of the search.
	readonly twilight: TwilightLimit
	readonly minAltitude: number
	// Visible passes of every satellite predicted, by the start of their first visible part.
	readonly passes: readonly TonightPass[]
	// Satellites predicted, those that could not be, and those beyond TONIGHT_LIMIT left out.
	readonly predicted: number
	readonly failures: readonly TonightFailure[]
	readonly leftOut: number
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

// Ground track being edited.
export interface GroundTrackDraft {
	// Instant the window is placed around.
	start: SatelliteWindowStart
	// Orbits shown after the instant, 1 to MAX_GROUND_TRACK_ORBITS; one is shown before it.
	orbits: number
}

// Instant a ground track was asked for.
export interface GroundTrackAnchor {
	// Whether it was the real current time, which the ground track then follows, or the instant of the Sky.
	readonly start: SatelliteWindowStart
	// Instant, Unix milliseconds (UTC).
	readonly time: number
}

// Layers of the ground track map that can be hidden; the track and the satellite are always drawn.
export interface GroundTrackLayers {
	// Region that sees the satellite above the horizon.
	footprint: boolean
	// Night side of the Earth.
	night: boolean
	// Observing site of the active profile.
	observer: boolean
	// Parts of the track in the Earth's shadow drawn apart.
	shadow: boolean
}

// Artificial Satellites state of the tab.
export interface ArtificialSatellitesState {
	// View shown.
	tab: SatelliteTab
	// Satellites Tonight predicts, chosen at once; the search of tonight's passes being edited, the latest answer, the
	// inputs it was made for (source, favorites, place, catalog revision), the pass chosen in it by its position, and its
	// state.
	tonightSource: TonightSource
	tonightDraft: TonightDraft
	tonight?: TonightResult
	tonightKey?: string
	tonightSelected?: number
	tonightLoading: boolean
	tonightError?: string
	// NORAD id of the satellite selected.
	selectedId?: string
	// Details of the satellite selected, its position at the latest instant asked for, and their states.
	details?: SatelliteDetails
	detailsError?: string
	position?: SatellitePositionResponse
	positionError?: string
	// Next visible pass of the satellite selected within NEXT_PASS_WINDOW_MS for the observing site: null when it has none,
	// absent before an answer or without a site.
	nextPass?: SatellitePassPrediction | null
	nextPassLoading: boolean
	nextPassError?: string
	// Place (locationKey) of the site the predictions shown were made for: its latitude, longitude, and elevation, never
	// its name or zone; empty for the Earth's center, absent before the first site was seen.
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
	// Ground track being edited, the latest answer with the instant it was asked for, and its state.
	groundTrackDraft: GroundTrackDraft
	groundTrack?: SatelliteGroundTrackResponse
	groundTrackAnchor?: GroundTrackAnchor
	groundTrackLoading: boolean
	groundTrackError?: string
	// Instant chosen on the ground track, Unix milliseconds (UTC); absent to show the anchor, or the real current time
	// when the ground track follows it.
	groundTrackCursor?: number
	// Real current time of the latest tick, Unix milliseconds, shown while the ground track follows it.
	groundTrackNow?: number
	// Layers shown on the ground track map.
	groundTrackLayers: GroundTrackLayers
	// Text of an import, the latest answer, and its state.
	importText: string
	importing: boolean
	importResult?: SatelliteImportResponse
	importError?: string
}

// Side effects of the tool, replaced in tests.
export interface ArtificialSatellitesIo {
	// Fetch of the API.
	readonly fetch: ApiFetch
	// Real current time, Unix milliseconds.
	readonly now: () => number
	// Instant the Sky shows, Unix milliseconds (UTC).
	readonly skyTime: () => number
}

// Browser implementation of the side effects.
const browserIo: ArtificialSatellitesIo = { fetch: browserFetch, now: () => Date.now(), skyTime: () => skyTime(skyClock, Date.now()) }

// Requests of each kind of answer; a newer request of a kind supersedes the older.
const detailsGuard = createRequestGuard()
const positionGuard = createRequestGuard()
const passesGuard = createRequestGuard()
const ephemerisGuard = createRequestGuard()
const groundTrackGuard = createRequestGuard()
const tonightGuard = createRequestGuard()
const nextPassGuard = createRequestGuard()

// Initial state of the tool.
export function initialArtificialSatellitesState(): ArtificialSatellitesState {
	return {
		tab: 'tonight',
		tonightSource: '',
		tonightDraft: { minAltitude: 10, twilight: 'civil' },
		tonightLoading: false,
		nextPassLoading: false,
		passDraft: { start: 'now', days: 2, minAltitude: 10, twilight: 'civil', showAll: false },
		passesLoading: false,
		ephemerisDraft: { start: 'now', hours: 2, stepSeconds: 60 },
		ephemerisLoading: false,
		groundTrackDraft: { start: 'now', orbits: 2 },
		groundTrackLoading: false,
		groundTrackLayers: { footprint: true, night: true, observer: true, shadow: true },
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

// Lists the satellites of the catalog (never CelesTrak) whose name, NORAD id, or COSPAR id matches the text (every one
// for an empty text), among `ids` when given, at most SEARCH_LIST_LIMIT, with how many match in all. An empty list of
// ids asks nothing.
export function searchSatelliteList(text: string, ids: readonly string[] | undefined, signal: AbortSignal, io: Pick<ArtificialSatellitesIo, 'fetch'> = browserIo): Promise<SatelliteSearchPage> {
	if (ids?.length === 0) return Promise.resolve({ items: [], total: 0 })
	const params = new URLSearchParams({ limit: `${SEARCH_LIST_LIMIT}` })
	if (text.trim()) params.set('q', text.trim())
	if (ids) params.set('ids', ids.join(','))
	return fetchJson<SatelliteSearchPage>(io, `/api/satellites?${params}`, { signal })
}

// Drops the passes and the ephemeris shown and cancels those being read, so a view that shows them reads them again.
function dropPredictions(state: ArtificialSatellitesState) {
	state.passes = undefined
	state.passesError = undefined
	state.passesLoading = false
	state.selectedPass = undefined
	state.ephemeris = undefined
	state.ephemerisError = undefined
	state.ephemerisLoading = false
	passesGuard.cancel()
	ephemerisGuard.cancel()
}

// Drops the next visible pass shown and cancels the one being read.
function dropNextPass(state: ArtificialSatellitesState) {
	state.nextPass = undefined
	state.nextPassError = undefined
	state.nextPassLoading = false
	nextPassGuard.cancel()
}

// Selects a satellite: reads its details, its position now, and its next visible pass for the observing site. Another
// satellite drops the passes, the ephemeris, the next pass, and the ground track of the previous one at once, so they are
// never shown as the new one's.
export async function selectSatellite(state: ArtificialSatellitesState, noradId: string, observer: GeographicLocation | undefined, io: ArtificialSatellitesIo = browserIo) {
	if (state.selectedId !== noradId) {
		state.selectedId = noradId
		state.details = undefined
		state.position = undefined
		dropPredictions(state)
		dropNextPass(state)
		dropGroundTrack(state)
	}

	await Promise.all([loadSatelliteDetails(state, io), loadSatellitePosition(state, observer, io), loadNextVisiblePass(state, observer, io)])
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

// Reads the position of the satellite selected at the real current time, for the observing site or the Earth's center.
export async function loadSatellitePosition(state: ArtificialSatellitesState, observer: GeographicLocation | undefined, io: ArtificialSatellitesIo = browserIo) {
	const noradId = state.selectedId
	if (!noradId) return
	const request = positionGuard.begin()
	state.positionError = undefined

	try {
		const position = await fetchJson<SatellitePositionResponse>(io, `/api/satellites/${encodeURIComponent(noradId)}/position`, jsonInit('POST', { time: io.now(), observer: siteObserver(observer) }, request.signal))
		if (!request.current()) return
		state.position = position
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.position = undefined
		state.positionError = messageOf(error)
	}
}

// Follows the observing site of the active profile: when its place differs from the one the predictions shown were made
// for, the position and the next visible pass are read again, and the passes and ephemeris of the previous place are
// dropped at once. Another name or zone of the same place keeps them. The first site seen is only recorded.
export function followSatelliteObserver(state: ArtificialSatellitesState, observer: GeographicLocation | undefined, io: ArtificialSatellitesIo = browserIo) {
	const key = locationKey(observer)
	if (state.observerKey === key) return
	const first = state.observerKey === undefined
	state.observerKey = key
	if (first) return
	dropPredictions(state)
	dropNextPass(state)
	void loadSatellitePosition(state, observer, io)
	void loadNextVisiblePass(state, observer, io)
}

// Searches the next visible pass of the satellite selected for the observing site: the first pass within
// NEXT_PASS_WINDOW_MS from now above NEXT_PASS_MIN_ALTITUDE with a visible part (sunlit while the Sun is below civil
// twilight) not over yet, or null without one. Without a site nothing is asked and the pass is left absent.
export async function loadNextVisiblePass(state: ArtificialSatellitesState, observer: GeographicLocation | undefined, io: ArtificialSatellitesIo = browserIo) {
	const site = siteObserver(observer)
	if (!state.selectedId || !site) return dropNextPass(state)
	const request = nextPassGuard.begin()
	const now = io.now()
	const body: SatellitePassesRequest = { observer: site, start: now, end: now + NEXT_PASS_WINDOW_MS, minAltitude: (NEXT_PASS_MIN_ALTITUDE * Math.PI) / 180, maxSunAltitude: (TWILIGHT_LIMITS.civil * Math.PI) / 180 }
	state.nextPassLoading = true
	state.nextPassError = undefined

	try {
		const { passes } = await fetchJson<SatellitePassesResponse>(io, `/api/satellites/${encodeURIComponent(state.selectedId)}/passes`, jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.nextPass = passes.find((pass) => pass.visible.some((part) => part.end > now)) ?? null
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.nextPass = undefined
		state.nextPassError = messageOf(error)
	}

	state.nextPassLoading = false
}

// Highest point of the visible parts of a pass, which has at least one: the culmination of the pass when it is visible
// then, else the highest of its visible parts.
export function highestVisiblePoint(pass: SatellitePassPrediction) {
	let highest = pass.visible[0].culmination
	for (const part of pass.visible) if (part.culmination.altitude > highest.altitude) highest = part.culmination
	return highest
}

// Reads the next visible pass again once the one shown is over, on the tick of the position.
export function tickNextVisiblePass(state: ArtificialSatellitesState, observer: GeographicLocation | undefined, io: ArtificialSatellitesIo = browserIo) {
	const last = state.nextPass?.visible.at(-1)
	if (last && last.end <= io.now() && !state.nextPassLoading) void loadNextVisiblePass(state, observer, io)
}

// Key of the inputs tonight's passes are made for: the source, the favorites predicted (for the favorites), the place of
// the site, and the catalog revision; another key makes the passes shown stale.
export function tonightKey(source: TonightSource, favorites: readonly string[], observer: GeographicLocation | undefined, revision: number) {
	return `${source}|${source ? '' : favorites.slice(0, TONIGHT_LIMIT).join(',')}|${locationKey(observer)}|${revision}`
}

// Reads the night of the site containing an instant, its civil date named in an IANA zone.
function readNight(site: AstroWeatherNightRequest['observer'], timeZone: string, time: number, signal: AbortSignal, io: ArtificialSatellitesIo) {
	const body: AstroWeatherNightRequest = { observer: site, timeZone, time }
	return fetchJson<AstroWeatherNight>(io, '/api/astro-weather/night', jsonInit('POST', body, signal))
}

// Runs task on every item with at most `limit` in flight, in the order of the items.
async function eachLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>) {
	let next = 0
	const worker = async () => {
		while (next < items.length) await task(items[next++])
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

// Searches tonight's visible passes of a source (the favorites or the members of a group, the first TONIGHT_LIMIT) for the
// observing site, with the draft. Tonight is the night of the site (noon to noon, the Sun of the server) containing
// now, or the next one once its morning twilight at the limit is past; the window runs from now to its closing noon, and
// only passes with a visible part are kept. A satellite that cannot be predicted is listed with the server's reason,
// never hidden. Needs a site, and at least one favorite for the favorites; the night is named in the site's own zone,
// whatever zone times are shown in. key records the inputs (tonightKey) the answer is for.
export async function loadTonight(state: ArtificialSatellitesState, source: TonightSource, favorites: readonly string[], observer: SiteLocation | undefined, key: string, io: ArtificialSatellitesIo = browserIo) {
	const site = siteObserver(observer)
	if (!observer || !site || (!source && favorites.length === 0)) return
	const request = tonightGuard.begin()
	const { minAltitude, twilight } = state.tonightDraft
	const now = io.now()
	state.tonightKey = key
	state.tonightLoading = true
	state.tonightError = undefined

	try {
		let night = await readNight(site, observer.timeZone, now, request.signal, io)
		const morning = night.sun[twilight].dawn ?? night.sun.sunrise
		if (morning !== undefined && morning <= now) night = await readNight(site, observer.timeZone, night.sun.end, request.signal, io)
		const start = Math.max(now, night.sun.start)
		const end = night.sun.end
		const passes: TonightPass[] = []
		const failures: TonightFailure[] = []
		// The satellites listed, by their names, and how many the source holds in all.
		const query: Record<string, string> = source ? { group: source, limit: `${TONIGHT_LIMIT}` } : { ids: favorites.slice(0, TONIGHT_LIMIT).join(','), limit: `${TONIGHT_LIMIT}` }
		const page = await fetchJson<SatelliteSearchPage>(io, `/api/satellites?${new URLSearchParams(query)}`, { signal: request.signal })
		const ids = source ? page.items.map((item) => item.noradId) : favorites.slice(0, TONIGHT_LIMIT)
		const total = source ? page.total : favorites.length
		const names = new Map(page.items.map((item) => [item.noradId, item.name]))

		// A Sun that never goes below the limit leaves no dark sky to see a satellite in, so nothing is searched.
		if (night.sun[twilight].state !== 'continuousAbove') {
			const body = { observer: site, start, end, minAltitude: (minAltitude * Math.PI) / 180, maxSunAltitude: (TWILIGHT_LIMITS[twilight] * Math.PI) / 180 } satisfies SatellitePassesRequest

			await eachLimited(ids, TONIGHT_CONCURRENCY, async (noradId) => {
				const name = names.get(noradId) ?? noradId
				try {
					const answer = await fetchJson<SatellitePassesResponse>(io, `/api/satellites/${encodeURIComponent(noradId)}/passes`, jsonInit('POST', body, request.signal))
					for (const pass of answer.passes) if (pass.visible.length > 0) passes.push({ noradId, name, pass, quality: answer.quality })
				} catch (error) {
					if (aborted(error)) throw error
					failures.push({ noradId, name, error: messageOf(error) })
				}
			})
		}

		if (!request.current()) return
		passes.sort((a, b) => a.pass.visible[0].start - b.pass.visible[0].start)
		failures.sort((a, b) => ids.indexOf(a.noradId) - ids.indexOf(b.noradId))
		state.tonight = { source, night, start, end, twilight, minAltitude, passes, predicted: ids.length, failures, leftOut: Math.max(0, total - ids.length) }
		// No pass is chosen until the operator chooses one, which also selects its satellite.
		state.tonightSelected = undefined
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.tonight = undefined
		state.tonightError = messageOf(error)
	}

	state.tonightLoading = false
}

// Reads tonight's passes when the view shows them and the answer shown, if any, is for other inputs (key) or for a night
// already over; a failed read waits for Retry.
export function ensureTonight(state: ArtificialSatellitesState, source: TonightSource, favorites: readonly string[], observer: SiteLocation | undefined, key: string, io: ArtificialSatellitesIo = browserIo) {
	if (state.tab !== 'tonight' || state.tonightLoading || (!source && favorites.length === 0) || !observer) return
	if (state.tonightError && state.tonightKey === key) return
	if (state.tonight && state.tonightKey === key && state.tonight.end > io.now()) return
	void loadTonight(state, source, favorites, observer, key, io)
}

// Start of a window, Unix milliseconds: the real current time, or the instant the Sky shows.
function windowStart(start: SatelliteWindowStart, io: ArtificialSatellitesIo) {
	return start === 'now' ? io.now() : io.skyTime()
}

// Searches the passes of the satellite selected over the observing site, with the draft. Needs a site.
export async function loadSatellitePasses(state: ArtificialSatellitesState, observer: GeographicLocation | undefined, io: ArtificialSatellitesIo = browserIo) {
	const site = siteObserver(observer)
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
		// The pass shown first is the first one listed: the first visible one unless the daylight ones are listed too.
		const first = state.passDraft.showAll ? 0 : passes.passes.findIndex((pass) => pass.visible.length > 0)
		state.selectedPass = first >= 0 && first < passes.passes.length ? first : undefined
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

// Computes the ephemeris of the satellite selected with the draft, for the observing site or the Earth's center.
export async function loadSatelliteEphemeris(state: ArtificialSatellitesState, observer: GeographicLocation | undefined, io: ArtificialSatellitesIo = browserIo) {
	if (!state.selectedId || ephemerisDraftError(state.ephemerisDraft)) return
	const request = ephemerisGuard.begin()
	const { start, hours, stepSeconds } = state.ephemerisDraft
	const from = windowStart(start, io)
	const body = { start: from, end: from + hours * HOUR_MS, step: stepSeconds * 1000, observer: siteObserver(observer) }
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

// Searches the passes when the view shows them for a satellite with elements and a site, and none were found, are being
// found, or failed; a failure waits for Retry and another draft for Find Passes.
export function ensureSatellitePasses(state: ArtificialSatellitesState, observer: GeographicLocation | undefined, io: ArtificialSatellitesIo = browserIo) {
	if (state.tab !== 'passes' || !observer || !state.selectedId || !state.details?.elements || state.passes || state.passesLoading || state.passesError) return
	void loadSatellitePasses(state, observer, io)
}

// Computes the ephemeris when the view shows it for a satellite with elements and none was computed, is being computed,
// or failed.
export function ensureSatelliteEphemeris(state: ArtificialSatellitesState, observer: GeographicLocation | undefined, io: ArtificialSatellitesIo = browserIo) {
	if (state.tab !== 'ephemeris' || !state.selectedId || !state.details?.elements || state.ephemeris || state.ephemerisLoading || state.ephemerisError) return
	void loadSatelliteEphemeris(state, observer, io)
}

// Drops the ground track shown and cancels the one being read.
function dropGroundTrack(state: ArtificialSatellitesState) {
	state.groundTrack = undefined
	state.groundTrackAnchor = undefined
	state.groundTrackError = undefined
	state.groundTrackCursor = undefined
	state.groundTrackLoading = false
	groundTrackGuard.cancel()
}

// Reads the ground track of the satellite selected around the instant of the draft, with its orbits. The cursor goes
// back to the anchor, or to the real current time when the ground track follows it.
export async function loadSatelliteGroundTrack(state: ArtificialSatellitesState, io: ArtificialSatellitesIo = browserIo) {
	const noradId = state.selectedId
	if (!noradId) return
	const request = groundTrackGuard.begin()
	const { start, orbits } = state.groundTrackDraft
	const anchor: GroundTrackAnchor = { start, time: windowStart(start, io) }
	const body = { time: anchor.time, orbits: Math.min(Math.max(Math.round(orbits), 1), MAX_GROUND_TRACK_ORBITS) }
	state.groundTrackLoading = true
	state.groundTrackError = undefined

	try {
		const track = await fetchJson<SatelliteGroundTrackResponse>(io, `/api/satellites/${encodeURIComponent(noradId)}/ground-track`, jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.groundTrack = track
		state.groundTrackAnchor = anchor
		state.groundTrackCursor = undefined
		state.groundTrackNow = anchor.time
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.groundTrack = undefined
		state.groundTrackAnchor = undefined
		state.groundTrackError = messageOf(error)
	}

	state.groundTrackLoading = false
}

// Reads the ground track when the view shows it for a satellite with elements and none was read or is being read.
export function ensureSatelliteGroundTrack(state: ArtificialSatellitesState, io: ArtificialSatellitesIo = browserIo) {
	if (state.tab !== 'groundTrack' || !state.selectedId || !state.details?.elements || state.groundTrack || state.groundTrackLoading || state.groundTrackError) return
	void loadSatelliteGroundTrack(state, io)
}

// Advances a ground track that follows the real current time to the instant of a tick, and reads it again once the
// satellite has gone one orbit past the instant it was asked for. A chosen instant or a Sky time is left alone.
export function tickSatelliteGroundTrack(state: ArtificialSatellitesState, io: ArtificialSatellitesIo = browserIo) {
	const { groundTrack: track, groundTrackAnchor: anchor } = state
	if (!track || anchor?.start !== 'now' || state.groundTrackCursor !== undefined || state.groundTrackLoading) return
	const now = io.now()
	state.groundTrackNow = now
	if (now > anchor.time + track.periodMinutes * 60_000) void loadSatelliteGroundTrack(state, io)
}

// Instant the ground track shows, Unix milliseconds (UTC): the instant chosen, else the real current time of the latest
// tick when it follows it, else its anchor; undefined without a ground track.
export function groundTrackInstant(state: Pick<ArtificialSatellitesState, 'groundTrackAnchor' | 'groundTrackCursor' | 'groundTrackNow'>) {
	const { groundTrackAnchor: anchor } = state
	if (!anchor) return undefined
	return state.groundTrackCursor ?? (anchor.start === 'now' ? (state.groundTrackNow ?? anchor.time) : anchor.time)
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
export async function setSatelliteElementSource(state: ArtificialSatellitesState, kind: 'gp' | 'manual' | null, observer: GeographicLocation | undefined, io: ArtificialSatellitesIo = browserIo) {
	const noradId = state.selectedId
	if (!noradId) return

	try {
		const response = await io.fetch(`/api/satellites/${encodeURIComponent(noradId)}/element-source`, jsonInit('PUT', { kind }))
		if (!response.ok) throw new Error(`${response.status}`)
	} catch (error) {
		state.detailsError = messageOf(error)
		return
	}

	dropPredictions(state)
	dropGroundTrack(state)
	await Promise.all([loadSatelliteDetails(state, io), loadSatellitePosition(state, observer, io), loadNextVisiblePass(state, observer, io)])
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

// Shows a satellite in the Sky workspace, selected through the Sky's own path for observer: the active profile's site,
// which the Sky observes from (undefined without one). With `time` (Unix milliseconds) the simulation clock moves there
// first; without it the clock is left alone. Neither the site nor any device changes.
export function showSatelliteInSky(noradId: string, name: string, observer: GeographicLocation | undefined, time?: number, handoff: SatelliteSkyHandoff = browserHandoff()) {
	if (time !== undefined) setSkyTime(handoff.clock, time)
	selectSkyObject(handoff.sky, { ref: { kind: 'satellite', noradId }, source: 'search', name, category: 'satellite' }, observer, handoff.io)
	navigate(handoff.route, { workspace: 'sky' }, handoff.history)
}

// Opens the tool on a satellite: /tools/artificial-satellites/<noradId>.
export function openArtificialSatellites(noradId: string, route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	navigate(route, { workspace: 'tools', tool: 'artificial-satellites', satellite: noradId }, history)
}

// Name of each illumination state.
export const SHADOW_LABELS: Readonly<Record<SatellitePosition['shadow'], string>> = { sunlit: 'Sunlit', penumbra: 'Penumbra', umbra: 'In shadow' }

// Formats an age in days, with its sign: elements older than the instant are a positive age.
export function formatElementAge(days: number) {
	const value = Math.abs(days)
	const text = value < 1 ? `${(value * 24).toFixed(1)} h` : `${value.toFixed(1)} d`
	return days < 0 ? `${text} before the epoch` : text
}

// Columns of the ephemeris export, with how each row gives them: the instant in ISO 8601 UTC, then its civil time in the
// display zone and the IANA name of that zone. Angles are degrees, distances km, rates km/s.
const CSV_COLUMNS: readonly (readonly [string, (row: SatelliteEphemerisRow, timeZone: string) => string])[] = [
	['time_utc', (row) => new Date(row.time).toISOString()],
	['time_civil', (row, timeZone) => formatDateTime(row.time, timeZone)],
	['time_zone', (_, timeZone) => timeZone],
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

// Returns the rows of an ephemeris as CSV text (RFC 4180, comma-separated, CRLF lines), with a header; civil times are
// in timeZone, an IANA zone. RA/Dec of date are geometric topocentric (or geocentric without a site) on the true
// equator and equinox; J2000 is ICRS.
export function ephemerisCsv(rows: readonly SatelliteEphemerisRow[], timeZone: string) {
	const lines = [CSV_COLUMNS.map(([name]) => name).join(',')]
	for (const row of rows) lines.push(CSV_COLUMNS.map(([, value]) => value(row, timeZone)).join(','))
	return `${lines.join('\r\n')}\r\n`
}

// Has the browser save an ephemeris as a CSV file, its civil times in timeZone (IANA).
export function downloadEphemerisCsv(rows: readonly SatelliteEphemerisRow[], timeZone: string, name: string) {
	downloadText(ephemerisCsv(rows, timeZone), `${name}.csv`, 'text/csv')
}
