import type { SatelliteDetails, SatellitePassesResponse, SatellitePassPrediction } from 'api'
import { proxy } from 'valtio'
import { type ApiFetch, browserFetch, fetchJson, jsonInit } from '../../http'
import { type GeographicLocation, siteObserver } from '../../location/site'
import { createRequestGuard } from '../selection'

// State of the Satellite Inspector of the Sky, tab memory: the details of the satellite selected, its next pass for the
// Sky observer after the instant the Sky shows, and whether the map follows it and draws its track. The position is the
// selection's, refreshed by the Sky like every object's.

// Window of the next pass search, in milliseconds after the Sky's instant.
const NEXT_PASS_WINDOW_MS = 2 * 86_400_000

// Twilight limit of the visible parts of the next pass: the Sun's center 6° below the horizon, radians.
const CIVIL_TWILIGHT = (-6 * Math.PI) / 180

// Satellite Inspector state of the tab.
export interface SkySatelliteState {
	// NORAD id the details and the next pass are for.
	noradId?: string
	// Details of the satellite, and why they could not be read.
	details?: SatelliteDetails
	detailsError?: string
	// Next pass found (null when none in the window), its search state, and why it failed.
	nextPass?: SatellitePassPrediction | null
	nextPassLoading: boolean
	nextPassError?: string
	// Whether the map keeps the view on the satellite; a pan stops it.
	tracking: boolean
	// Whether the map draws the track of the satellite around the instant shown.
	trail: boolean
}

// Satellite Inspector state of the tab.
export const skySatelliteState = proxy<SkySatelliteState>({ nextPassLoading: false, tracking: false, trail: false })

// Requests of the details and of the next pass.
const detailsGuard = createRequestGuard()
const passGuard = createRequestGuard()

// Shows another satellite (or the same one again after a failure): forgets the details and the next pass of the previous
// one at once, stops following it, and
// reads the new details.
export async function inspectSatellite(state: SkySatelliteState, noradId: string, fetch: ApiFetch = browserFetch) {
	if (state.noradId === noradId && !state.detailsError) return
	state.noradId = noradId
	state.details = undefined
	state.detailsError = undefined
	state.nextPass = undefined
	state.nextPassError = undefined
	state.nextPassLoading = false
	state.tracking = false
	passGuard.cancel()
	const request = detailsGuard.begin()

	try {
		const details = await fetchJson<SatelliteDetails>({ fetch }, `/api/satellites/${encodeURIComponent(noradId)}`, { signal: request.signal })
		if (request.current()) state.details = details
	} catch (error) {
		if (request.current()) state.detailsError = error instanceof Error ? error.message : String(error)
	}
}

// Finds the next pass above the horizon for the observer within two days of an instant (Unix milliseconds).
export async function findNextSatellitePass(state: SkySatelliteState, observer: GeographicLocation, time: number, fetch: ApiFetch = browserFetch) {
	const noradId = state.noradId
	if (!noradId) return
	const request = passGuard.begin()
	state.nextPassLoading = true
	state.nextPassError = undefined

	try {
		const body = { observer: siteObserver(observer), start: time, end: time + NEXT_PASS_WINDOW_MS, minAltitude: 0, maxSunAltitude: CIVIL_TWILIGHT }
		const { passes } = await fetchJson<SatellitePassesResponse>({ fetch }, `/api/satellites/${encodeURIComponent(noradId)}/passes`, jsonInit('POST', body, request.signal))
		if (!request.current()) return
		// A pass already in progress is the current one; the next is the first that rises.
		state.nextPass = passes.find((pass) => !pass.startsBeforeWindow) ?? null
	} catch (error) {
		if (!request.current()) return
		state.nextPass = undefined
		state.nextPassError = error instanceof Error ? error.message : String(error)
	}

	state.nextPassLoading = false
}
