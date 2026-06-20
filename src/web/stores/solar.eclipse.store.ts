import { deg } from 'nebulosa/src/angle'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import type { LocalSolarEclipseCircumstances, LocalSolarEclipseViewGeometry, LocalSolarEclipseViewOptions } from 'nebulosa/src/sun.eclipse.local'
import type { Writable } from 'nebulosa/src/types'
import type { NextSolarEclipse, SolarEclipseMap } from 'src/shared/types'
import { proxy, ref } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { WorldMapMethods, WorldMapPosition } from '../ui/components/WorldMap'
import type { InteractTransform } from '../ui/Interactable'
import { atlasStore } from './atlas.store'

export type SolarEclipseStore = typeof solarEclipseStore

let worldMap: WorldMapMethods | null = null

export interface SolarEclipseState {
	show: boolean
	eclipse?: NextSolarEclipse
	map?: SolarEclipseMap
	circumstances?: LocalSolarEclipseCircumstances
	localView?: LocalSolarEclipseViewGeometry
	localViewOptions: Writable<LocalSolarEclipseViewOptions>
	location: GeographicCoordinate
	scale: number
}

const state = proxy<SolarEclipseState>({
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
		selectedEvent: 'C1',
		orientationMode: 'zenith',
		solarRadiusPx: 28,
		includeGhostDisks: false,
		includeHorizon: true,
	},
})

initProxy(state, 'solareclipse', ['p:show', 'p:scale', 'o:localViewOptions'])

async function loadMap() {
	if (state.eclipse === undefined) return false
	const map = await Api.Atlas.solarEclipseMap(state.eclipse)
	if (map) state.map = ref(map)
	return map !== undefined
}

async function loadCircumstances() {
	if (state.eclipse === undefined) return false
	const circumstances = await Api.Atlas.solarEclipseLocalCircumstances({ next: state.eclipse, location: state.location })
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

async function load(next: NextSolarEclipse) {
	show()

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

function setWorldMap(map: WorldMapMethods | null) {
	worldMap = map
}

function show() {
	state.show = true
}

function hide() {
	state.show = false
}

export const solarEclipseStore = {
	state,
	load,
	setWorldMap,
	handleCoordinateChange,
	handleTransformChange,
	updateLocalViewOptions,
	show,
	hide,
} as const
