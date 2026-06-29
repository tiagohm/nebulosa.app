import type { LunarEclipse } from 'nebulosa/src/astronomy/bodies/moon'
import type { LocalLunarEclipseCircumstances, LocalLunarEclipseCircumstancesOptions, LocalLunarEclipseViewGeometry, LocalLunarEclipseViewOptions } from 'nebulosa/src/astronomy/events/eclipse/lunar/local'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { temporalFromTime } from 'nebulosa/src/astronomy/time/temporal'
import type { Writable } from 'nebulosa/src/core/types'
import { deg } from 'nebulosa/src/math/units/angle'
import type { LunarEclipseMap } from 'src/shared/types'
import { proxy, ref } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { WorldMapPosition } from '../ui/components/WorldMap'
import type { InteractTransform } from '../ui/Interactable'
import { atlasStore } from './atlas.store'

export type LunarEclipseStore = typeof lunarEclipseStore

export interface LunarEclipseState {
	show: boolean
	eclipse?: LunarEclipse
	map?: LunarEclipseMap
	circumstances?: LocalLunarEclipseCircumstances
	localView?: LocalLunarEclipseViewGeometry
	localViewOptions: Writable<LocalLunarEclipseViewOptions>
	localCircumstancesOptions: Writable<LocalLunarEclipseCircumstancesOptions>
	location: GeographicCoordinate
	scale: number
}

const state = proxy<LunarEclipseState>({
	show: false,
	location: {
		latitude: atlasStore.state.request.location.latitude,
		longitude: atlasStore.state.request.location.longitude,
		elevation: atlasStore.state.request.location.elevation,
	},
	scale: 5,
	localViewOptions: {
		width: 400,
		height: 200,
		selectedEvent: 'P1',
		orientationMode: 'zenith',
		umbraRadiusPx: 35,
		includeGhostDisks: false,
		includeHorizon: true,
	},
	localCircumstancesOptions: {
		altitudeSamples: 36, // 10 min, 6h / 36 = 10 min
	},
})

initProxy(state, 'lunareclipse', ['p:scale', 'o:localViewOptions', 'o:localCircumstancesOptions'])

async function loadMap() {
	if (state.eclipse === undefined) return false
	const map = await Api.Atlas.lunarEclipseMap(state.eclipse)
	if (map) state.map = ref(map)
	return map !== undefined
}

async function loadCircumstances() {
	if (state.eclipse === undefined) return false
	const circumstances = await Api.Atlas.lunarEclipseLocalCircumstances({ eclipse: state.eclipse, location: state.location })
	if (circumstances) state.circumstances = ref(circumstances)
	return circumstances !== undefined
}

async function loadView() {
	if (state.circumstances === undefined) return false
	const localView = await Api.Atlas.lunarEclipseLocalView({ eclipse: state.eclipse!, events: state.circumstances.events, options: state.localViewOptions })

	if (localView) {
		state.localView = ref(localView)
		if (localView.selectedEvent) state.localViewOptions.selectedEvent = localView.selectedEvent
	}

	return localView !== undefined
}

async function load(next: LunarEclipse) {
	show()

	if (next.maximalTime !== state.eclipse?.maximalTime) {
		state.eclipse = ref(next)

		await loadMap()
		await loadCircumstances()
		await loadView()
	}
}

async function updateLocalViewOptions<K extends 'orientationMode' | 'selectedEvent'>(key: K, value: LocalLunarEclipseViewOptions[K]) {
	state.localViewOptions[key] = value

	await loadView()
}

function handleTransformChange(transform: InteractTransform) {
	state.scale = transform.scale
}

async function handleCoordinateChange(position: WorldMapPosition) {
	state.location.latitude = deg(position.latitude)
	state.location.longitude = deg(position.longitude)

	await loadCircumstances()
	await loadView()
}

async function find(next: boolean) {
	if (!state.eclipse) return
	const utc = temporalFromTime(state.eclipse.maximalTime) + (next ? 86400000 : -86400000)
	const eclipse = await Api.Atlas.lunarEclipses({ time: { utc, offset: 0 }, location: atlasStore.state.request.location, count: 1, next })
	if (!eclipse || eclipse.length === 0) return
	await load(eclipse[0])
}

function prev() {
	return find(false)
}

function next() {
	return find(true)
}

function show() {
	state.show = true
}

function hide() {
	state.show = false
}

export const lunarEclipseStore = {
	state,
	load,
	prev,
	next,
	handleCoordinateChange,
	handleTransformChange,
	updateLocalViewOptions,
	show,
	hide,
} as const
