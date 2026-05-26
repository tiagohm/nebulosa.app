import type { UTCTime } from 'nebulosa/src/indi.device'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import { temporalAdd, temporalGet } from 'nebulosa/src/temporal'
import { type PositionOfBody, type SolarImageSource, type BodyPosition, type SolarSeasons, type NextSolarEclipse, DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY } from 'src/shared/types'
import { proxy, ref } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { atlasStore, isLocationChanged, isTimeChanged } from './atlas.store'

export type AtlasSunStore = typeof sunStore

export interface AtlasSunState {
	mode: 'info' | 'chart'
	readonly request: PositionOfBody
	source: SolarImageSource
	readonly position: BodyPosition
	chart: readonly number[]
	readonly seasons: SolarSeasons
	eclipses: readonly NextSolarEclipse[]
}

const state = proxy<AtlasSunState>({
	mode: 'info',
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
	eclipses: [],
	source: 'HMI_INTENSITYGRAM_FLATTENED',
	seasons: { spring: 0, summer: 0, autumn: 0, winter: 0 },
})

initProxy(state, 'atlas.sun', ['o:request', 'p:source'])
state.request.time.utc = 0

let chartUpdate = true
let seasonsUpdate = true
let seasonsYear = 0
let eclipsesUpdate = true

async function tick(time: UTCTime, location: GeographicCoordinate, dateHasChanged: boolean) {
	let changed = false

	if (isLocationChanged(location, state.request.location)) {
		chartUpdate = true
		Object.assign(state.request.location, location)
		changed = true
	}

	// Updates only if passed more than 1 minute since last update
	if (isTimeChanged(time, state.request.time)) {
		chartUpdate ||= time.offset !== state.request.time.offset
		Object.assign(state.request.time, time)
		changed = true

		eclipsesUpdate ||= dateHasChanged

		if ((!seasonsUpdate && dateHasChanged) || seasonsYear === 0) {
			const local = temporalAdd(time.utc, time.offset, 'm')
			const year = temporalGet(local, 'y')

			if (seasonsYear !== year) {
				seasonsUpdate = true
				seasonsYear = year
			}
		}
	}

	if (changed) {
		void updateSeasons()
		void updateEclipses()

		await updatePosition()
		await updateChart(dateHasChanged)
	}
}

async function updatePosition() {
	const position = await Api.Atlas.positionOfSun(state.request)
	if (position) Object.assign(state.position, position)
}

async function updateChart(force: boolean = false) {
	if (!chartUpdate && !force) return
	chartUpdate = false
	const chart = await Api.Atlas.chartOfSun(state.request)
	if (chart) state.chart = chart
	else chartUpdate = true
}

async function updateSeasons() {
	if (!seasonsUpdate) return
	seasonsUpdate = false
	const seasons = await Api.Atlas.seasons(state.request)
	if (seasons) Object.assign(state.seasons, seasons)
	else seasonsUpdate = true
}

async function updateEclipses() {
	if (!eclipsesUpdate) return
	eclipsesUpdate = false
	const request = { ...state.request, count: 1 }
	const eclipses = await Api.Atlas.solarEclipses(request)
	if (eclipses) state.eclipses = eclipses
	else eclipsesUpdate = true
}

export const sunStore = {
	state,
	tick,
} as const

atlasStore.state.sun = ref(sunStore)
