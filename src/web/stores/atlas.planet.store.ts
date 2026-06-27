import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import { type PlanetType, type PositionOfBody, type BodyPosition, DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY } from 'src/shared/types'
import { proxy, ref } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { atlasStore, isLocationChanged, isTimeChanged } from './atlas.store'

export type AtlasPlanetStore = typeof planetStore

export interface AtlasPlanetState {
	mode: 'info' | 'chart'
	readonly search: {
		name: string
		type: PlanetType | 'ALL'
	}
	readonly request: PositionOfBody
	code?: string
	readonly position: BodyPosition
	chart: readonly number[]
}

const state = proxy<AtlasPlanetState>({
	mode: 'info',
	search: {
		name: '',
		type: 'ALL',
	},
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
})

initProxy(state, 'atlas.planet', ['o:search', 'o:request'])
state.request.time.utc = 0

let chartUpdate = true

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
	}

	if (changed) {
		await updatePosition()
		await updateChart(dateHasChanged)
	}
}

function update<K extends keyof AtlasPlanetState['search']>(key: K, value: AtlasPlanetState['search'][K]) {
	state.search[key] = value
}

async function updatePosition() {
	if (!state.code) return
	const position = await Api.Atlas.positionOfPlanet(state.request, state.code)
	if (position) Object.assign(state.position, position)
}

async function updateChart(force: boolean = false) {
	if (!state.code) return
	if (!chartUpdate && !force) return
	chartUpdate = false
	const chart = await Api.Atlas.chartOfPlanet(state.request, state.code)
	if (chart) state.chart = chart
	else chartUpdate = true
}

async function select(code: string, force: boolean = true) {
	// Fetches object's position and chart if a new one was selected
	if (code && (force || state.code !== code)) {
		state.code = code

		await updatePosition()
		await updateChart(true)
	}
}

export const planetStore = {
	state,
	tick,
	update,
	select,
} as const

atlasStore.state.planet = ref(planetStore)
