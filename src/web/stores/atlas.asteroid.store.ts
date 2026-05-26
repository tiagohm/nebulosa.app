import type { UTCTime } from 'nebulosa/src/indi.device'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import { type FindCloseApproaches, type CloseApproach, type MinorPlanet, type PositionOfBody, type BodyPosition, DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY } from 'src/shared/types'
import { proxy, ref } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { atlasStore, isLocationChanged, isTimeChanged } from './atlas.store'

export type AtlasAsteroidStore = typeof asteroidStore

export interface AtlasAsteroidState {
	tab: 'search' | 'closeapproaches'
	mode: 'info' | 'chart'
	loading: boolean
	readonly search: {
		text: string
	}
	readonly closeApproaches: {
		readonly request: FindCloseApproaches
		result: readonly CloseApproach[]
	}
	selected?: Exclude<MinorPlanet, 'list'>
	list?: MinorPlanet['list']
	readonly request: PositionOfBody
	readonly position: BodyPosition
	chart: readonly number[]
}

const state = proxy<AtlasAsteroidState>({
	tab: 'search',
	mode: 'info',
	loading: false,
	search: {
		text: '',
	},
	closeApproaches: {
		request: { days: 7, distance: 10 },
		result: [],
	},
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
})

initProxy(state, 'atlas.asteroid', ['p:tab', 'o:request'])
initProxy(state, 'atlas.asteroid.closeapproaches', ['o:request'])
state.request.time.utc = 0
let chartUpdate = true

function updateSearch(value: string) {
	state.search.text = value
}

function updateCloseApproaches<K extends keyof FindCloseApproaches>(key: K, value: FindCloseApproaches[K]) {
	state.closeApproaches.request[key] = value
}

async function search() {
	try {
		state.loading = true

		const result = await Api.Atlas.searchMinorPlanet({ text: state.search.text })

		if (!result) return

		if ('list' in result) {
			state.list = result.list
		} else {
			state.selected = result
			state.list = undefined

			await updatePosition()
			await updateChart(true)
		}
	} finally {
		state.loading = false
	}
}

async function closeApproaches() {
	try {
		state.loading = true

		const result = await Api.Atlas.findCloseApproaches(state.closeApproaches.request)
		state.closeApproaches.result = result ?? []
	} finally {
		state.loading = false
	}
}

function select(pdes: string) {
	state.search.text = pdes
	state.tab = 'search'
	return search()
}

async function updatePosition() {
	const code = `DES=${state.selected!.id};`
	const position = await Api.Atlas.positionOfPlanet(state.request, code)
	if (position) Object.assign(state.position, position)
}

async function updateChart(force: boolean = false) {
	if (!chartUpdate && !force) return
	chartUpdate = false
	const code = `DES=${state.selected!.id};`
	const chart = await Api.Atlas.chartOfPlanet(state.request, code)
	if (chart) state.chart = chart
	else chartUpdate = true
}

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

	// Refresh selected object
	if (changed && state.selected) {
		await updatePosition()
		await updateChart(dateHasChanged)
	}
}

export const asteroidStore = {
	state,
	updateSearch,
	updateCloseApproaches,
	search,
	closeApproaches,
	select,
	tick,
} as const

atlasStore.state.asteroid = ref(asteroidStore)
