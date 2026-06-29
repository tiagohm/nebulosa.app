import type { LunarEclipse } from 'nebulosa/src/astronomy/bodies/moon'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { temporalAdd, temporalGet } from 'nebulosa/src/astronomy/time/temporal'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY, type BodyPosition, type LunarApsis, type LunarPhaseTime, type PositionOfBody } from 'src/shared/types'
import { proxy, ref } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { atlasStore, isLocationChanged, isTimeChanged } from './atlas.store'

export type AtlasMoonStore = typeof moonStore

export interface AtlasMoonState {
	mode: 'info' | 'chart'
	readonly request: PositionOfBody
	readonly position: BodyPosition
	chart: readonly number[]
	phases: readonly LunarPhaseTime[]
	eclipses: readonly LunarEclipse[]
	apsis: readonly [LunarApsis, LunarApsis]
}

const state = proxy<AtlasMoonState>({
	mode: 'info',
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
	phases: [],
	eclipses: [],
	apsis: [
		{ time: { day: 0, fraction: 0, scale: 3 }, distance: 0, diameter: 0 },
		{ time: { day: 0, fraction: 0, scale: 3 }, distance: 0, diameter: 0 },
	],
})

initProxy(state, 'atlas.moon', ['o:request'])
state.request.time.utc = 0

let chartUpdate = true
let phasesUpdate = true
let phasesMonth = 0
let eclipsesUpdate = true
let apsisUpdate = true

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

		eclipsesUpdate ||= dateHasChanged
		apsisUpdate ||= dateHasChanged

		if ((!phasesUpdate && dateHasChanged) || phasesMonth === 0) {
			const local = temporalAdd(time.utc, time.offset, 'm')
			const month = temporalGet(local, 'mo')

			if (phasesMonth !== month) {
				phasesUpdate = true
				phasesMonth = month
			}
		}
	}

	if (changed) {
		void updatePhases()
		void updateEclipses()
		void updateApsis()

		await updatePosition()
		await updateChart(dateHasChanged)
	}
}

async function updatePosition() {
	const position = await Api.Atlas.positionOfMoon(state.request)
	if (position) Object.assign(state.position, position)
}

async function updateChart(force: boolean = false) {
	if (!chartUpdate && !force) return
	chartUpdate = false
	const chart = await Api.Atlas.chartOfMoon(state.request)
	if (chart) state.chart = chart
	else chartUpdate = true
}

async function updatePhases() {
	if (!phasesUpdate) return
	phasesUpdate = false
	const phases = await Api.Atlas.moonPhases(state.request)
	if (phases) state.phases = phases
	else phasesUpdate = true
}

async function updateEclipses() {
	if (!eclipsesUpdate) return
	eclipsesUpdate = false
	const request = { ...state.request, count: 1, next: true }
	const eclipses = await Api.Atlas.lunarEclipses(request)
	if (eclipses) state.eclipses = eclipses
	else eclipsesUpdate = true
}

async function updateApsis() {
	if (!apsisUpdate) return
	apsisUpdate = false
	const request = { ...state.request, count: 1 }
	const apsis = await Api.Atlas.moonApsis(request)
	if (apsis) state.apsis = apsis
	else apsisUpdate = true
}

export const moonStore = {
	state,
	tick,
} as const

atlasStore.state.moon = ref(moonStore)
