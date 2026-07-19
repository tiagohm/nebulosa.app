import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { atlasStore, isLocationChanged, isTimeChanged, type BookmarkItem, type TagItem } from '@stores/atlas.store'
import { framingStore } from '@stores/framing.store'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import type { Mount, UTCTime } from 'nebulosa/src/devices/indi/device'
import { formatRA, formatDEC } from 'nebulosa/src/math/units/angle'
import { type SearchSatellite, type PositionOfBody, type Satellite, type BodyPosition, DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY, DEFAULT_SEARCH_SATELLITE } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'

export type AtlasSatelliteStore = typeof satelliteStore

export interface AtasSatelliteState {
	mode: 'info' | 'chart'
	loading: boolean
	readonly request: SearchSatellite & PositionOfBody
	selected?: Satellite
	page: number
	result: readonly Satellite[]
	readonly position: BodyPosition
	chart: readonly number[]
	readonly tags: readonly TagItem[]
	readonly bookmark: readonly BookmarkItem[]
	readonly favorite: boolean
}

const state = proxy<AtasSatelliteState>({
	mode: 'info',
	loading: false,
	request: {
		...structuredClone(DEFAULT_SEARCH_SATELLITE),
		...structuredClone(DEFAULT_POSITION_OF_BODY),
	},
	result: [],
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
	page: 1,
	bookmark: [],
	get tags() {
		const { selected } = this

		if (selected) {
			const res: TagItem[] = [{ label: selected.name, color: 'primary' }]
			for (const group of selected.groups) res.push({ label: group, color: 'warning' })
			return res
		}

		return []
	},
	get favorite() {
		const id = this.selected?.id?.toFixed(0)
		return id !== undefined && this.bookmark.some((e) => e.code === id)
	},
} satisfies AtasSatelliteState)

let chartUpdate = true
let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return

	console.info('satellite mounted')

	mounted = true

	u[0] = initProxy(state, 'atlas.satellite', ['o:request', 'o:bookmark'])

	state.request.time.utc = 0

	void atlasStore.tick('satellite')
	void search(true)

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('satellite unmounted')
	unsubscribe(u)
	mounted = false
}

function update<K extends keyof AtasSatelliteState['request']>(key: K, value: AtasSatelliteState['request'][K]) {
	state.request[key] = value

	// Search again if page or sort has been changed
	if (key === 'page') void search(false)
}

async function search(reset: boolean | React.UIEvent) {
	try {
		state.loading = true

		if (reset === true || typeof reset !== 'boolean') state.request.page = 1

		const result = await Api.Atlas.searchSatellite(state.request)
		state.result = result ?? []
	} finally {
		state.loading = false
	}
}

function resetFilter() {
	state.request.category = [...DEFAULT_SEARCH_SATELLITE.category]
	state.request.groups = [...DEFAULT_SEARCH_SATELLITE.groups]
}

async function select(row: number, col: number = 0, force: boolean = true, rowMode: boolean = true) {
	const selected = rowMode ? state.result[row] : state.result.find((dso) => dso.id === row)

	// Fetches object's position and chart if a new one was selected
	if (selected && (force || state.selected?.id !== selected.id)) {
		state.selected = selected

		await updatePosition()
		await updateChart(true)
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

async function updatePosition() {
	if (!state.selected) return
	const position = await Api.Atlas.positionOfSatellite(state.request, state.selected.id)
	if (position) Object.assign(state.position, position)
}

async function updateChart(force: boolean = false) {
	if (!state.selected) return
	if (!chartUpdate && !force) return
	chartUpdate = false
	const chart = await Api.Atlas.chartOfSatellite(state.request, state.selected.id)
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
	if (changed && state.selected?.id) {
		await updatePosition()
		await updateChart(dateHasChanged)
	}
}

function sync(mount?: Mount) {
	if (mount === undefined) return undefined
	const [rightAscension, declination] = state.position.equatorial
	return Api.Mounts.sync(mount, { type: 'JNOW', JNOW: { x: rightAscension, y: declination } })
}

function goTo(mount?: Mount) {
	if (mount === undefined) return undefined
	const [rightAscension, declination] = state.position.equatorial
	return Api.Mounts.goTo(mount, { type: 'JNOW', JNOW: { x: rightAscension, y: declination } })
}

function frame() {
	const [rightAscension, declination] = state.position.equatorialJ2000
	return framingStore.load({ rightAscension: formatRA(rightAscension), declination: formatDEC(declination) })
}

export const satelliteStore = {
	state,
	mount,
	update,
	search,
	resetFilter,
	next,
	prev,
	select,
	tick,
	sync,
	goTo,
	frame,
} as const

atlasStore.state.satellite = ref(satelliteStore)
