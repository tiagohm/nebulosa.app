import type { LocalLunarEclipse, LunarEclipseSummary, MoonAlmanacResponse, MoonPhaseName, SkyObserver } from 'api'
import { proxy } from 'valtio'
import { fetchJson, jsonInit } from '../../http'
import { createRequestGuard } from '../selection'
import { effectiveUp, type MoonViewUp } from './moon.geometry'

// State of the Moon Inspector and its requests: the lunar almanac of the instant the Sky shows (the Moon's appearance,
// the next phases and apsides) and the next lunar eclipse after that instant with its local circumstances, plus how
// the Moon is drawn and the names and captions its views share. Each resource keeps its own loading and error, so one
// failing never hides another, and its own request guard, so a late answer for a former instant or observer never
// replaces a newer one. The almanac is asked again for every new instant the Sky shows (the Sky refreshes the
// selection at its own bounded cadence) and keeps the last answer for the same observer while the next one loads,
// saying it is loading; an answer for another observer is cleared at once. The eclipse is asked again only when the
// instant leaves the interval its search covers. The state lives as long as the tab: nothing is persisted. Times are
// Unix milliseconds (UTC).

// Names of the phases, for people.
export const MOON_PHASE_NAMES: Readonly<Record<MoonPhaseName, string>> = {
	newMoon: 'New Moon',
	waxingCrescent: 'Waxing Crescent',
	firstQuarter: 'First Quarter',
	waxingGibbous: 'Waxing Gibbous',
	fullMoon: 'Full Moon',
	waningGibbous: 'Waning Gibbous',
	lastQuarter: 'Last Quarter',
	waningCrescent: 'Waning Crescent',
}

// Credit of the color maps, as NASA asks.
export const MOON_IMAGE_CREDIT = "Color map: NASA's Scientific Visualization Studio, CGI Moon Kit (LRO LROC and LOLA); illustrative colors."

// Says from where and with which side up a drawing is shown.
export function moonOrientationCaption(almanac: MoonAlmanacResponse, up: 'zenith' | 'north') {
	const from = almanac.appearance.center === 'topocentric' ? 'From the observer' : "From the Earth's center"
	return `${from} · ${effectiveUp(up, almanac.appearance) === 'zenith' ? 'Zenith up' : 'North up'}`
}

// Data loaded from the API, with the state of its latest request.
export interface MoonResource<T> {
	// Latest value answered; kept while a newer request of the same observer loads.
	value?: T
	// Whether a request is in progress.
	loading: boolean
	// Why the latest request failed.
	error?: string
}

// Next lunar eclipse after an instant.
export interface MoonNextEclipse {
	// Eclipse.
	readonly eclipse: LunarEclipseSummary
	// Its circumstances from the observer; absent without one.
	readonly local?: LocalLunarEclipse
	// Instant the search started from, Unix milliseconds; the answer holds from it until the eclipse's maximum.
	readonly from: number
}

// State of the Moon Inspector in the tab.
export interface MoonState {
	// Lunar almanac; `key` names the instant and observer asked for, `observer` the observer alone.
	almanac: MoonResource<MoonAlmanacResponse> & { key?: string; observer?: string }
	// Next lunar eclipse.
	eclipse: MoonResource<MoonNextEclipse> & { key?: string; from?: number }
	// Which direction is up in the drawings; the zenith needs an observer.
	up: MoonViewUp
}

// Browser services the store uses, replaced in tests.
export interface MoonIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
}

// Browser implementation of MoonIo.
export const browserMoonIo: MoonIo = { fetch: (input, init) => fetch(input, init) }

// Initial state: nothing loaded, zenith up.
export function initialMoonState(): MoonState {
	return { almanac: { loading: false }, eclipse: { loading: false }, up: 'zenith' }
}

// Moon Inspector state of the tab.
export const moonState = proxy<MoonState>(initialMoonState())

// Requests of each resource; a newer one supersedes the previous.
const guards = { almanac: createRequestGuard(), eclipse: createRequestGuard() }

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

// Whether the almanac shown is the one of an instant and observer, so its drawing and labels belong to them.
export function almanacCurrent(state: MoonState, time: number, observer: SkyObserver | undefined) {
	return state.almanac.value?.time === time && state.almanac.observer === observerKey(observer) && !state.almanac.loading
}

// Asks for the almanac of an instant (the one the Sky shows) for an observer, unless the one loaded or loading is
// of the same instant and observer. A value of another observer is cleared at once; one of the same observer is kept
// while the new one loads.
export async function refreshMoonAlmanac(state: MoonState, time: number, observer: SkyObserver | undefined, io: MoonIo = browserMoonIo) {
	const almanac = state.almanac
	const place = observerKey(observer)
	const key = `${time}|${place}`
	if (almanac.key === key) return

	const request = guards.almanac.begin()
	if (almanac.observer !== place) almanac.value = undefined
	almanac.key = key
	almanac.observer = place
	almanac.loading = true
	almanac.error = undefined

	try {
		const value = await fetchJson<MoonAlmanacResponse>(io, '/api/sky/moon/almanac', jsonInit('POST', { time, observer }, request.signal))
		if (!request.current()) return
		almanac.value = value
		almanac.loading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		almanac.error = failure(error)
		almanac.loading = false
	}
}

// Asks for the next lunar eclipse after an instant, with its local circumstances for an observer, unless the one
// loaded or loading was searched for the same observer from an instant not after this one and its maximum is still
// ahead. A failed search is asked again only when the observer changes or the instant goes back.
export async function refreshMoonEclipse(state: MoonState, time: number, observer: SkyObserver | undefined, io: MoonIo = browserMoonIo) {
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
		const eclipse = await fetchJson<LunarEclipseSummary>(io, `/api/eclipses/lunar?time=${time}&direction=next`, { signal: request.signal })
		const query = observer && `longitude=${observer.longitude}&latitude=${observer.latitude}&event=MAX&orientation=zenith&handedness=eastRight&ghosts=false`
		const local = query ? await fetchJson<LocalLunarEclipse>(io, `/api/eclipses/lunar/${eclipse.id}/local?${query}`, { signal: request.signal }) : undefined
		if (!request.current()) return
		resource.value = { eclipse, local, from: time }
		resource.loading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		resource.error = failure(error)
		resource.loading = false
	}
}

// Chooses which direction is up in the drawings.
export function setMoonViewUp(state: MoonState, up: MoonViewUp) {
	state.up = up
}
