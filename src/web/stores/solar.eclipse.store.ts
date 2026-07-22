import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { settingsStore } from '@stores/settings.store'
import type { WorldMapPosition } from '@ui/components/WorldMap'
import type { InteractTransform } from '@ui/Interactable'
import type { SolarEclipse } from 'nebulosa/src/astronomy/bodies/sun'
import type { LocalEclipseContactKind, LocalSolarEclipseCircumstances, LocalSolarEclipseViewGeometry, LocalSolarEclipseViewOptions, LocalViewOrientationMode } from 'nebulosa/src/astronomy/events/eclipse/solar/local'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { temporalFromTime } from 'nebulosa/src/astronomy/time/temporal'
import type { Writable } from 'nebulosa/src/core/types'
import { deg } from 'nebulosa/src/math/units/angle'
import { DEFAULT_GEOGRAPHIC_COORDINATE, type SolarEclipseMap } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
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
	location: structuredClone(DEFAULT_GEOGRAPHIC_COORDINATE),
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

let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return

	console.info('solar eclipse mounted')

	mounted = true

	state.location.latitude = settingsStore.state.location.latitude
	state.location.longitude = settingsStore.state.location.longitude
	state.location.elevation = settingsStore.state.location.elevation

	u[0] = initProxy(state, 'solareclipse', ['p:scale', 'o:localViewOptions'])

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('solar eclipse unmounted')
	unsubscribe(u)
	mounted = false
}

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

function setOrientationMode(value: LocalViewOrientationMode) {
	state.localViewOptions.orientationMode = value
	void loadView()
}

function setSelectedEvent(value: LocalEclipseContactKind) {
	state.localViewOptions.selectedEvent = value
	void loadView()
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
	const eclipse = await Api.Atlas.solarEclipses({ time: { utc, offset: 0 }, location: settingsStore.state.location, count: 1, next })
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
	mount,
	unmount,
	load,
	prev,
	next,
	handleCoordinateChange,
	handleTransformChange,
	setOrientationMode,
	setSelectedEvent,
} as const
