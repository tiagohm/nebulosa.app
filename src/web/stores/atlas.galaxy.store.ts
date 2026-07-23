import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { skyObjectName } from '@shared/util'
import { atlasStore, isLocationChanged, isTimeChanged, type BookmarkItem, type TagItem } from '@stores/atlas.store'
import { framingStore } from '@stores/framing.store'
import { settingsStore } from '@stores/settings.store'
import type { Constellation } from 'nebulosa/src/astronomy/coordinates/constellation'
import type { Writable } from 'nebulosa/src/core/types'
import type { Mount, UTCTime } from 'nebulosa/src/devices/indi/device'
import type { StellariumObjectType } from 'nebulosa/src/devices/protocols/stellarium'
import { formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { type SearchSkyObject, type SkyObjectSearchItem, type BodyPosition, DEFAULT_BODY_POSITION, DEFAULT_SKY_OBJECT_SEARCH } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'

export type AtlasGalaxyStore = typeof galaxyStore

export interface AtlasGalaxyState {
	loading: boolean
	readonly request: Writable<Required<SearchSkyObject>>
	result: readonly SkyObjectSearchItem[]
	selected?: SkyObjectSearchItem
	readonly position: BodyPosition
	chart: readonly number[]
	favorite: boolean
	readonly bookmark: BookmarkItem[]
	bookmarkedOnly: boolean
	readonly tags: readonly TagItem[]
}

const state = proxy<AtlasGalaxyState>({
	loading: false,
	request: structuredClone(DEFAULT_SKY_OBJECT_SEARCH),
	result: [],
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
	bookmark: [],
	bookmarkedOnly: false,
	get favorite() {
		const { selected, bookmark } = this
		const id = selected?.id.toFixed(0)
		return !!id && bookmark.some((e) => e.code === id)
	},
	get tags() {
		const { selected } = this
		const { names, constellation } = this.position

		if (names?.length) {
			const res = new Array<TagItem>(names.length)

			for (let i = 0; i < names.length; i++) {
				const label = skyObjectName(names[i], constellation)!
				res[i] = { label, color: 'primary' }
			}

			return res
		} else if (selected) {
			return [{ label: selected.name, color: 'primary' }] as const
		} else {
			return []
		}
	},
} satisfies AtlasGalaxyState)

let chartUpdate = true
let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return

	console.info('galaxy mounted')

	mounted = true

	atlasStore.state.galaxy = ref(galaxyStore)

	u[0] = initProxy(state, 'atlas.galaxy', ['o:request', 'o:bookmark', 'o:bookmarkedOnly'])

	void atlasStore.tick('galaxy')
	void search(true)

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('galaxy unmounted')
	unsubscribe(u)
	mounted = false
}

function setName(value: string) {
	state.request.name = value
}

function setNameType(value: number) {
	state.request.nameType = value
}

function setConstellations(value: readonly Constellation[]) {
	state.request.constellations = value
}

function setTypes(value: readonly StellariumObjectType[]) {
	state.request.types = value
}

function setRightAscension(value: string) {
	state.request.rightAscension = value
}

function setDeclination(value: string) {
	state.request.declination = value
}

function setRadius(value: number) {
	state.request.radius = value
}

function setBookmarkedOnly(value: boolean) {
	state.bookmarkedOnly = value
}

function setVisible(value: boolean) {
	state.request.visible = value
}

function setVisibleAbove(value: number) {
	state.request.visibleAbove = value
}

function setMagnitudeMin(value: number) {
	state.request.magnitudeMin = value
}

function setMagnitudeMax(value: number) {
	state.request.magnitudeMax = value
}

function setPage(value: number) {
	state.request.page = value

	void search(false)
}

function setMagnitude(value: number | readonly number[]) {
	if (typeof value === 'number') {
		setMagnitudeMin(value)
		setMagnitudeMax(30)
	} else {
		setMagnitudeMin(value[0])
		setMagnitudeMax(value[1])
	}
}

async function search(reset: boolean | React.UIEvent) {
	try {
		state.loading = true

		if (reset === true || typeof reset !== 'boolean') state.request.page = 1

		const request = { ...state.request }

		if (state.bookmarkedOnly) {
			request.id = state.bookmark.map((e) => e.code)
		}

		const result = await Api.Atlas.searchSkyObject(request)
		state.result = result ?? []
	} finally {
		state.loading = false
	}
}

function next() {
	if (state.result.length === 0) return
	setPage(state.request.page + 1)
}

function prev() {
	if (state.request.page <= 1) return
	setPage(state.request.page - 1)
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

async function selectWithId(id: number | string) {
	const selected = await Api.Atlas.searchSkyObject({ id, limit: 1, location: state.request.location, time: state.request.time })

	if (selected?.length) {
		state.selected = selected[0]

		await updatePosition()
		await updateChart(true)
	}
}

async function updatePosition() {
	const { id } = state.selected!
	const position = await Api.Atlas.positionOfSkyObject(state.request, id)
	if (position) Object.assign(state.position, position)
}

async function updateChart(force: boolean = false) {
	if (!chartUpdate && !force) return
	chartUpdate = false
	const { id } = state.selected!
	const chart = await Api.Atlas.chartOfSkyObject(state.request, id)
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
		const id = selected.id.toFixed(0)
		const index = state.bookmark.findIndex((e) => e.code === id)

		if (favorite !== index < 0) return

		if (favorite) {
			state.bookmark.push({ code: id, name: selected.name, type: 'galaxy' })
		} else {
			state.bookmark.splice(index, 1)
		}
	}
}

export const galaxyStore = {
	state,
	mount,
	unmount,
	setName,
	setNameType,
	setConstellations,
	setTypes,
	setRightAscension,
	setDeclination,
	setRadius,
	setBookmarkedOnly,
	setVisible,
	setVisibleAbove,
	setMagnitudeMin,
	setMagnitudeMax,
	setPage,
	setMagnitude,
	search,
	next,
	prev,
	select,
	selectWithId,
	tick,
	sync,
	goTo,
	frame,
	handleFavorite,
} as const
