import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { settingsStore } from '@stores/settings.store'
import type { WorldMapPosition } from '@ui/components/WorldMap'
import type { InteractTransform } from '@ui/Interactable'
import type { LunarEclipse } from 'nebulosa/src/astronomy/bodies/moon'
import type { LocalLunarEclipseCircumstances, LocalLunarEclipseCircumstancesOptions, LocalLunarEclipseViewGeometry, LocalLunarEclipseViewOptions, LocalLunarViewOrientationMode } from 'nebulosa/src/astronomy/events/eclipse/lunar/local'
import type { LunarEclipseContactKind } from 'nebulosa/src/astronomy/events/eclipse/lunar/map'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { temporalFromTime } from 'nebulosa/src/astronomy/time/temporal'
import type { Writable } from 'nebulosa/src/core/types'
import { deg } from 'nebulosa/src/math/units/angle'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'
import { DEFAULT_GEOGRAPHIC_COORDINATE } from '#/atlas'
import type { LunarEclipseMap } from '#/moon'

export type LunarEclipseStore = typeof lunarEclipseStore

export interface LunarEclipseState {
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
	location: structuredClone(DEFAULT_GEOGRAPHIC_COORDINATE),
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

let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return unmount

	console.info('lunar eclipse mounted')

	mounted = true

	state.location.latitude = settingsStore.state.location.latitude
	state.location.longitude = settingsStore.state.location.longitude
	state.location.elevation = settingsStore.state.location.elevation

	u[0] = initProxy(state, 'lunareclipse', ['p:scale', 'o:localViewOptions', 'o:localCircumstancesOptions'])

	if (!state.eclipse) {
		void Api.Atlas.lunarEclipses({ location: state.location, time: { utc: Date.now(), offset: settingsStore.state.time.offset }, next: true, count: 1 }).then((eclipses) => {
			if (eclipses?.length) {
				void load(eclipses[0])
			}
		})
	}

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('lunar eclipse unmounted')
	unsubscribe(u)
	mounted = false
}

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
	if (next.maximalTime !== state.eclipse?.maximalTime) {
		state.eclipse = ref(next)

		await loadMap()
		await loadCircumstances()
		await loadView()
	}
}

function setOrientationMode(value: LocalLunarViewOrientationMode) {
	state.localViewOptions.orientationMode = value
	void loadView()
}

function setSelectedEvent(value: LunarEclipseContactKind) {
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
	const eclipse = await Api.Atlas.lunarEclipses({ time: { utc, offset: 0 }, location: settingsStore.state.location, count: 1, next })
	if (!eclipse || eclipse.length === 0) return
	await load(eclipse[0])
}

function prev() {
	return find(false)
}

function next() {
	return find(true)
}

export const lunarEclipseStore = {
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
