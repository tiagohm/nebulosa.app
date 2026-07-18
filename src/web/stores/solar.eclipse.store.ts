import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { atlasStore } from '@stores/atlas.store'
import type { WorldMapPosition } from '@ui/components/WorldMap'
import type { InteractTransform } from '@ui/Interactable'
import type { SolarEclipse } from 'nebulosa/src/astronomy/bodies/sun'
import type { LocalSolarEclipseCircumstances, LocalSolarEclipseViewGeometry, LocalSolarEclipseViewOptions } from 'nebulosa/src/astronomy/events/eclipse/solar/local'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { temporalFromTime } from 'nebulosa/src/astronomy/time/temporal'
import type { Writable } from 'nebulosa/src/core/types'
import { deg } from 'nebulosa/src/math/units/angle'
import type { SolarEclipseMap } from 'src/shared/types'
import { proxy, ref } from 'valtio'

export type SolarEclipseStore = typeof solarEclipseStore

export interface SolarEclipseState {
	eclipse?: SolarEclipse
	map?: SolarEclipseMap
	circumstances?: LocalSolarEclipseCircumstances
	localView?: LocalSolarEclipseViewGeometry
	localViewOptions: Writable<LocalSolarEclipseViewOptions>
	location: GeographicCoordinate
	scale: number
}

const state = proxy<SolarEclipseState>({
	location: {
		latitude: atlasStore.state.request.location.latitude,
		longitude: atlasStore.state.request.location.longitude,
		elevation: atlasStore.state.request.location.elevation,
	},
	scale: 5,
	localViewOptions: {
		width: 400,
		height: 200,
		selectedEvent: 'C1',
		orientationMode: 'zenith',
		solarRadiusPx: 28,
		includeGhostDisks: false,
		includeHorizon: true,
	},
})

initProxy(state, 'solareclipse', ['p:scale', 'o:localViewOptions'])

async function loadMap() {
	if (state.eclipse === undefined) return false
	const map = await Api.Atlas.solarEclipseMap(state.eclipse)
	if (map) state.map = ref(map)
	return map !== undefined
}

async function loadCircumstances() {
	if (state.eclipse === undefined) return false
	const circumstances = await Api.Atlas.solarEclipseLocalCircumstances({ eclipse: state.eclipse, location: state.location })
	if (circumstances) state.circumstances = ref(circumstances)
	return circumstances !== undefined
}

async function loadView() {
	if (state.circumstances === undefined) return false
	const localView = await Api.Atlas.solarEclipseLocalView({ events: state.circumstances.events, options: state.localViewOptions })

	if (localView) {
		state.localView = ref(localView)
		if (localView.selectedEvent) state.localViewOptions.selectedEvent = localView.selectedEvent
	}

	return localView !== undefined
}

async function load(next: SolarEclipse) {
	if (next.maximalTime !== state.eclipse?.maximalTime) {
		state.eclipse = ref(next)

		await loadMap()
		await loadCircumstances()
		await loadView()
	}
}

async function updateLocalViewOptions<K extends 'orientationMode' | 'selectedEvent'>(key: K, value: LocalSolarEclipseViewOptions[K]) {
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
	const eclipse = await Api.Atlas.solarEclipses({ time: { utc, offset: 0 }, location: atlasStore.state.request.location, count: 1, next })
	if (!eclipse || eclipse.length === 0) return
	await load(eclipse[0])
}

function prev() {
	return find(false)
}

function next() {
	return find(true)
}

export const solarEclipseStore = {
	state,
	load,
	prev,
	next,
	handleCoordinateChange,
	handleTransformChange,
	updateLocalViewOptions,
} as const
