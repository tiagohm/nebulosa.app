import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { atlasStore, isLocationChanged, isTimeChanged, type TagItem } from '@stores/atlas.store'
import { framingStore } from '@stores/framing.store'
import { settingsStore } from '@stores/settings.store'
import type { Mount, UTCTime } from 'nebulosa/src/devices/indi/device'
import { formatRA, formatDEC } from 'nebulosa/src/math/units/angle'
import { unsubscribe } from 'src/shared/util'
import { type BodyPosition, type PositionOfBody, DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY } from 'src/types/atlas'
import type { PlanetType } from 'src/types/planet'
import { proxy, ref } from 'valtio'

export type AtlasPlanetStore = typeof planetStore

export interface AtlasPlanetState {
	readonly search: {
		name: string
		type: PlanetType | 'all'
	}
	readonly request: PositionOfBody
	selected?: { readonly name: string; readonly code: string }
	readonly position: BodyPosition
	chart: readonly number[]
	readonly tags: readonly TagItem[]
}

const state = proxy<AtlasPlanetState>({
	search: {
		name: '',
		type: 'all',
	},
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
	get tags() {
		const { selected } = this
		return selected ? ([{ label: selected.name, color: 'primary' }] as const) : []
	},
} satisfies AtlasPlanetState)

let chartUpdate = true
let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return unmount

	console.info('planet mounted')

	mounted = true

	atlasStore.state.planet = ref(planetStore)

	u[0] = initProxy(state, 'atlas.planet', ['o:search'])

	void atlasStore.tick('planet')

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('planet unmounted')
	unsubscribe(u)
	mounted = false
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

	if (changed) {
		await updatePosition()
		await updateChart(dateHasChanged)
	}
}

function setName(value: string) {
	state.search.name = value
}

function setType(value: PlanetType | 'all') {
	state.search.type = value
}

async function updatePosition() {
	if (state.selected === undefined) return
	const position = await Api.Atlas.positionOfPlanet(state.request, state.selected.code)
	if (position) Object.assign(state.position, position)
}

async function updateChart(force: boolean = false) {
	if (state.selected === undefined) return
	if (!chartUpdate && !force) return
	chartUpdate = false
	const chart = await Api.Atlas.chartOfPlanet(state.request, state.selected.code)
	if (chart) state.chart = chart
	else chartUpdate = true
}

async function select(planet: AtlasPlanetState['selected'], force: boolean = true) {
	// Fetches object's position and chart if a new one was selected
	if (planet !== undefined && (force || state.selected?.code !== planet.code)) {
		state.selected = planet

		await updatePosition()
		await updateChart(true)
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

export const planetStore = {
	type: 'planet',
	state,
	mount,
	unmount,
	tick,
	setName,
	setType,
	select,
	sync,
	goTo,
	frame,
} as const
