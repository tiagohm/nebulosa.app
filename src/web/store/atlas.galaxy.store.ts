import type { UTCTime } from 'nebulosa/src/indi.device'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import { type SearchSkyObject, type SkyObjectSearchItem, type BodyPosition, DEFAULT_BODY_POSITION, DEFAULT_SKY_OBJECT_SEARCH } from 'src/shared/types'
import { proxy, ref } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { atlasStore, isLocationChanged, isTimeChanged } from './atlas.store'

export type AtlasGalaxyStore = typeof galaxyStore

export interface AtlasGalaxyState {
	mode: 'info' | 'chart'
	loading: boolean
	readonly request: SearchSkyObject
	result: readonly SkyObjectSearchItem[]
	selected?: SkyObjectSearchItem
	readonly position: BodyPosition
	chart: readonly number[]
}

const state = proxy<AtlasGalaxyState>({
	mode: 'info',
	loading: false,
	request: structuredClone(DEFAULT_SKY_OBJECT_SEARCH),
	result: [],
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
})

initProxy(state, 'atlas.galaxy', ['o:request'])
state.request.time.utc = 0

let chartUpdate = true

function mount() {
	void search(true)
}

function update<K extends keyof SearchSkyObject>(key: K, value: SearchSkyObject[K]) {
	state.request[key] = value

	// Search again if page or sort has been changed
	if (key === 'page') void search(false)
}

function updateMagnitude(value: number | readonly number[]) {
	if (typeof value === 'number') {
		update('magnitudeMin', value)
		update('magnitudeMax', 30)
	} else {
		update('magnitudeMin', value[0])
		update('magnitudeMax', value[1])
	}
}

async function search(reset: boolean | React.UIEvent) {
	try {
		state.loading = true

		if (reset === true || typeof reset !== 'boolean') state.request.page = 1

		const result = await Api.SkyAtlas.searchSkyObject(state.request)
		state.result = result ?? []
	} finally {
		state.loading = false
	}
}

function next() {
	if (state.result.length === 0) return
	update('page', state.request.page + 1)
}

function prev() {
	if (state.request.page <= 1) return
	update('page', state.request.page - 1)
}

async function select(row: number, col: number, force: boolean = true, rowMode: boolean = true) {
	const selected = rowMode ? state.result[row] : state.result.find((dso) => dso.id === row)

	// Fetches object's position and chart if a new one was selected
	if (selected && (force || state.selected?.id !== selected.id)) {
		state.selected = selected

		await updatePosition()
		await updateChart(true)
	}
}

async function updatePosition() {
	const { id } = state.selected!
	const position = await Api.SkyAtlas.positionOfSkyObject(state.request, id)
	if (position) Object.assign(state.position, position)
}

async function updateChart(force: boolean = false) {
	if (!chartUpdate && !force) return
	chartUpdate = false
	const { id } = state.selected!
	const chart = await Api.SkyAtlas.chartOfSkyObject(state.request, id)
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

	if (!changed) return

	// Refresh visible objects above horizon
	if (state.request.visible) {
		void search(false)
	}

	// Refresh selected object
	if (state.selected) {
		await updatePosition()
		await updateChart(dateHasChanged)
	}
}

export const galaxyStore = {
	state,
	mount,
	update,
	updateMagnitude,
	search,
	next,
	prev,
	select,
	tick,
} as const

atlasStore.state.galaxy = ref(galaxyStore)
