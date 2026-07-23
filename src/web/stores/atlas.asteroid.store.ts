import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { atlasStore, isLocationChanged, isTimeChanged, type BookmarkItem, type TagItem } from '@stores/atlas.store'
import { framingStore } from '@stores/framing.store'
import { settingsStore } from '@stores/settings.store'
import type { Mount, UTCTime } from 'nebulosa/src/devices/indi/device'
import { formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { type FindCloseApproaches, type CloseApproach, type MinorPlanet, type PositionOfBody, type BodyPosition, DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'

export type AtlasAsteroidStore = typeof asteroidStore

export interface AtlasAsteroidState {
	tab: 'search' | 'closeapproaches'
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
	readonly tags: TagItem[]
	readonly bookmark: BookmarkItem[]
	readonly favorite: boolean
}

const state = proxy<AtlasAsteroidState>({
	tab: 'search',
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
	bookmark: [],
	get tags() {
		const { selected } = this
		const res: TagItem[] = []

		if (selected !== undefined) {
			res.push({ label: selected.name, color: 'primary' })
			if (selected.orbitType) res.push({ label: selected.orbitType, color: 'success' })
			if (selected.neo) res.push({ label: 'NEO', color: 'warning' })
			if (selected.pha) res.push({ label: 'PHA', color: 'danger' })
		}

		return res
	},
	get favorite() {
		const { selected, bookmark } = this
		return selected !== undefined && bookmark.some((e) => e.code === selected.id)
	},
} satisfies AtlasAsteroidState)

let chartUpdate = true
let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return

	console.info('asteroid mounted')

	mounted = true

	atlasStore.state.asteroid = ref(asteroidStore)

	u[0] = initProxy(state, 'atlas.asteroid', ['p:tab', 'o:bookmark'])
	u[1] = initProxy(state, 'atlas.asteroid.closeapproaches', ['o:request'])

	void atlasStore.tick('asteroid')

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('asteroid unmounted')
	unsubscribe(u)
	mounted = false
}

function setSearch(value: string) {
	state.search.text = value
}

function setCloseApproachesDays(value: number) {
	state.closeApproaches.request.days = value
}

function setCloseApproachesDistance(value: number) {
	state.closeApproaches.request.distance = value
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

async function findCloseApproaches() {
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

async function tick(time: UTCTime, dateHasChanged: boolean) {
	let changed = false

	if (isLocationChanged(settingsStore.state.location, state.request.location)) {
		chartUpdate = true
		Object.assign(state.request.location, settingsStore.state.location)
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

function handleFavorite(favorite: boolean) {
	const { selected } = state

	if (selected) {
		const index = state.bookmark.findIndex((e) => e.code === selected.id)

		if (favorite !== index < 0) return

		if (favorite) {
			state.bookmark.push({ code: selected.id, name: selected.name, type: 'asteroid' })
		} else {
			state.bookmark.splice(index, 1)
		}
	}
}

export const asteroidStore = {
	state,
	mount,
	unmount,
	setSearch,
	setCloseApproachesDays,
	setCloseApproachesDistance,
	search,
	findCloseApproaches,
	select,
	tick,
	goTo,
	sync,
	frame,
	handleFavorite,
} as const
