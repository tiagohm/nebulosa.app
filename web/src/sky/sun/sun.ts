import type { LocalSolarEclipse, SkyObserver, SolarEclipseSummary, SunActiveRegionsResponse, SunAlmanacResponse, SunImageChannel, SunImageSize } from 'api'
import { proxy } from 'valtio'
import { fetchJson, jsonInit, responseError } from '../../http'
import { zonedWallTime } from '../clock'
import { createRequestGuard } from '../selection'

// State of the Sun Inspector and its requests: the solar almanac of the instant the Sky shows (the observer's day,
// the next seasons, the equation of time), the next solar eclipse after that instant with its local circumstances,
// and the latest SDO image and NOAA active region report, which are current observations whatever the Sky clock
// shows. Each resource keeps its own loading and error, so one failing never hides another, and its own request
// guard, so a late answer never replaces a newer one. The almanac is asked again only when the observer, the time
// zone, the civil date, or the 10-minute bucket of the instant changes, or when the instant passes the next season,
// never on every tick; the eclipse only when the instant leaves the interval its search covers. The state lives
// as long as the tab: nothing is persisted. Times are Unix milliseconds (UTC).

// Width of the buckets of the instant within which the almanac is not asked again, in milliseconds (10 minutes):
// the equation of time changes by less than a second in that time.
export const ALMANAC_BUCKET_MS = 600_000

// How often the image and the active region report are asked again while the inspector is shown, in milliseconds
// (15 minutes, about the cadence SDO refreshes its images at; the server caches both).
export const SUN_OBSERVATION_REFRESH_MS = 15 * 60_000

// Channels of the SDO image, in the order offered.
export const SUN_IMAGE_CHANNELS: readonly SunImageChannel[] = ['aia193', 'aia171', 'aia304', 'hmiIntensitygram', 'hmiMagnetogram']

// Names of the SDO channels, for people.
export const SUN_IMAGE_CHANNEL_NAMES: Readonly<Record<SunImageChannel, string>> = {
	aia193: 'AIA 193 Å (corona)',
	aia171: 'AIA 171 Å (quiet corona)',
	aia304: 'AIA 304 Å (chromosphere)',
	hmiIntensitygram: 'HMI intensitygram (sunspots)',
	hmiMagnetogram: 'HMI magnetogram',
}

// Data loaded from the API, with the state of its latest request.
export interface SunResource<T> {
	// Latest value answered; kept while a newer request of the same key loads.
	value?: T
	// Whether a request is in progress.
	loading: boolean
	// Why the latest request failed.
	error?: string
}

// SDO image shown.
export interface SunImage {
	// Object URL of the JPEG.
	readonly url: string
	// Channel of the image.
	readonly channel: SunImageChannel
	// Width and height in pixels.
	readonly size: SunImageSize
	// When SDO last modified the file, Unix milliseconds; absent when the server did not say. Not the observation time.
	readonly updatedAt?: number
	// When the server downloaded it, Unix milliseconds.
	readonly fetchedAt: number
	// Whether SDO could not be read and this is the last image the server downloaded.
	readonly stale: boolean
}

// Next solar eclipse after an instant.
export interface SunNextEclipse {
	// Eclipse.
	readonly eclipse: SolarEclipseSummary
	// Its circumstances from the observer; absent without one.
	readonly local?: LocalSolarEclipse
	// Instant the search started from, Unix milliseconds; the answer holds from it until the eclipse's maximum.
	readonly from: number
}

// State of the Sun Inspector in the tab.
export interface SunState {
	// Solar almanac.
	almanac: SunResource<SunAlmanacResponse> & { key?: string; dayKey?: string }
	// Next solar eclipse.
	eclipse: SunResource<SunNextEclipse> & { key?: string; from?: number }
	// SDO image of the panel.
	image: SunResource<SunImage>
	// Larger SDO image of the enlarged view.
	enlarged: SunResource<SunImage>
	// NOAA active region report.
	regions: SunResource<SunActiveRegionsResponse>
	// SDO channel chosen.
	channel: SunImageChannel
}

// Browser services the store uses, replaced in tests.
export interface SunIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Creates an object URL of a blob.
	readonly createObjectURL: (blob: Blob) => string
	// Releases an object URL.
	readonly revokeObjectURL: (url: string) => void
}

// Browser implementation of SunIo.
export const browserSunIo: SunIo = {
	fetch: (input, init) => fetch(input, init),
	createObjectURL: (blob) => URL.createObjectURL(blob),
	revokeObjectURL: (url) => URL.revokeObjectURL(url),
}

// Initial state: nothing loaded, the image on AIA 193 Å.
export function initialSunState(): SunState {
	return {
		almanac: { loading: false },
		eclipse: { loading: false },
		image: { loading: false },
		enlarged: { loading: false },
		regions: { loading: false },
		channel: 'aia193',
	}
}

// Sun Inspector state of the tab.
export const sunState = proxy<SunState>(initialSunState())

// Requests of each resource; a newer one supersedes the previous.
const guards = { almanac: createRequestGuard(), eclipse: createRequestGuard(), image: createRequestGuard(), enlarged: createRequestGuard(), regions: createRequestGuard() }

// Returns the message of a failure, or a generic one.
function failure(error: unknown) {
	return error instanceof Error ? error.message : 'Request failed'
}

// Whether a failure is the abort of a superseded request.
function aborted(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError'
}

// Key of the observer's place, empty without one.
function observerKey(observer: SkyObserver | undefined) {
	return observer ? `${observer.latitude},${observer.longitude},${observer.elevation}` : ''
}

// Key of the almanac's day: the civil date of an instant in a time zone, the zone, and the observer.
export function almanacDayKey(time: number, observer: SkyObserver | undefined, timeZone: string) {
	const { year, month, day } = zonedWallTime(time, timeZone)
	return `${year}-${month}-${day}|${timeZone}|${observerKey(observer)}`
}

// Asks for the almanac of an instant (the one the Sky shows) for an observer in an IANA time zone, unless the one
// loaded or loading has the same day and 10-minute bucket and its next season is still ahead. A value of another day,
// zone, or observer is cleared at once, so a row is never shown for the wrong day; one of the same day is kept while
// the new one loads.
export async function refreshSunAlmanac(state: SunState, time: number, observer: SkyObserver | undefined, timeZone: string, io: SunIo = browserSunIo) {
	const almanac = state.almanac
	const dayKey = almanacDayKey(time, observer, timeZone)
	const key = `${dayKey}|${Math.floor(time / ALMANAC_BUCKET_MS)}`
	const nextSeason = almanac.value?.seasons[0]?.time
	if (almanac.key === key && (nextSeason === undefined || time < nextSeason)) return

	const request = guards.almanac.begin()
	if (almanac.dayKey !== dayKey) almanac.value = undefined
	almanac.key = key
	almanac.dayKey = dayKey
	almanac.loading = true
	almanac.error = undefined

	try {
		const value = await fetchJson<SunAlmanacResponse>(io, '/api/sky/sun/almanac', jsonInit('POST', { time, observer, timeZone }, request.signal))
		if (!request.current()) return
		almanac.value = value
		almanac.loading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		almanac.error = failure(error)
		almanac.loading = false
	}
}

// Asks for the next solar eclipse after an instant, with its local circumstances for an observer, unless the one
// loaded or loading was searched for the same observer from an instant not after this one and its maximum is still
// ahead. A failed search is asked again only when the observer changes or the instant goes back.
export async function refreshSunEclipse(state: SunState, time: number, observer: SkyObserver | undefined, io: SunIo = browserSunIo) {
	const resource = state.eclipse
	const key = observerKey(observer)
	const until = resource.value?.eclipse.maximum ?? Number.POSITIVE_INFINITY
	if (resource.key === key && resource.from !== undefined && resource.from <= time && time < until) return

	const request = guards.eclipse.begin()
	resource.value = undefined
	resource.key = key
	resource.from = time
	resource.loading = true
	resource.error = undefined

	try {
		const eclipse = await fetchJson<SolarEclipseSummary>(io, `/api/eclipses/solar?time=${time}&direction=next`, { signal: request.signal })
		const query = observer && `longitude=${observer.longitude}&latitude=${observer.latitude}&event=MAX&orientation=zenith&handedness=eastRight&ghosts=false`
		const local = query ? await fetchJson<LocalSolarEclipse>(io, `/api/eclipses/solar/${eclipse.id}/local?${query}`, { signal: request.signal }) : undefined
		if (!request.current()) return
		resource.value = { eclipse, local, from: time }
		resource.loading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		resource.error = failure(error)
		resource.loading = false
	}
}

// Downloads the latest SDO image of a channel at a size into the panel's or the enlarged view's resource, releasing
// the image it replaces. The image shown says its own channel, so the one kept while another channel loads is never
// taken for it.
export async function loadSunImage(state: SunState, target: 'image' | 'enlarged', channel: SunImageChannel, io: SunIo = browserSunIo) {
	const resource = state[target]
	const size: SunImageSize = target === 'image' ? 512 : 1024
	const request = guards[target].begin()
	resource.loading = true
	resource.error = undefined

	try {
		const response = await io.fetch(`/api/sky/sun/image?channel=${channel}&size=${size}`, { signal: request.signal })
		if (!response.ok) throw new Error(await responseError(response))
		const blob = await response.blob()
		if (!request.current()) return

		const updatedAt = Date.parse(response.headers.get('Last-Modified') ?? '')
		const previous = resource.value?.url
		resource.value = { url: io.createObjectURL(blob), channel, size, updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined, fetchedAt: +(response.headers.get('X-Sun-Fetched-At') ?? 0), stale: response.headers.get('X-Sun-Stale') === '1' }
		resource.loading = false
		if (previous) io.revokeObjectURL(previous)
	} catch (error) {
		if (!request.current() || aborted(error)) return
		resource.error = failure(error)
		resource.loading = false
	}
}

// Chooses the SDO channel and downloads its image for the panel.
export function selectSunImageChannel(state: SunState, channel: SunImageChannel, io: SunIo = browserSunIo) {
	state.channel = channel
	return loadSunImage(state, 'image', channel, io)
}

// Downloads the latest NOAA active region report; the report shown stays while it loads.
export async function loadActiveRegions(state: SunState, io: SunIo = browserSunIo) {
	const resource = state.regions
	const request = guards.regions.begin()
	resource.loading = true
	resource.error = undefined

	try {
		const value = await fetchJson<SunActiveRegionsResponse>(io, '/api/sky/sun/active-regions', { signal: request.signal })
		if (!request.current()) return
		resource.value = value
		resource.loading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		resource.error = failure(error)
		resource.loading = false
	}
}
