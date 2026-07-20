import { Api } from '@shared/api'
import { atlasStore, isLocationChanged, isTimeChanged, type TagItem } from '@stores/atlas.store'
import { framingStore } from '@stores/framing.store'
import { homeStore } from '@stores/home.store'
import { lunarEclipseStore } from '@stores/lunar.eclipse.store'
import { settingsStore } from '@stores/settings.store'
import type { LunarEclipse } from 'nebulosa/src/astronomy/bodies/moon'
import { temporalAdd, temporalGet } from 'nebulosa/src/astronomy/time/temporal'
import type { Mount, UTCTime } from 'nebulosa/src/devices/indi/device'
import { formatRA, formatDEC } from 'nebulosa/src/math/units/angle'
import { DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY, type BodyPosition, type LunarApsis, type LunarPhaseTime, type PositionOfBody } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'

export type AtlasMoonStore = typeof moonStore

export interface AtlasMoonState {
	readonly request: PositionOfBody
	readonly position: BodyPosition
	chart: readonly number[]
	phases: readonly LunarPhaseTime[]
	eclipses: readonly LunarEclipse[]
	apsis: readonly [LunarApsis, LunarApsis]
	readonly tags: readonly TagItem[]
}

const state = proxy<AtlasMoonState>({
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
	phases: [],
	eclipses: [],
	apsis: [
		{ time: { day: 0, fraction: 0, scale: 3 }, distance: 0, diameter: 0 },
		{ time: { day: 0, fraction: 0, scale: 3 }, distance: 0, diameter: 0 },
	],
	tags: [{ label: 'Moon', color: 'primary' }],
})

let chartUpdate = true
let phasesUpdate = true
let phasesMonth = 0
let eclipsesUpdate = true
let apsisUpdate = true
let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return

	console.info('sun mounted')

	mounted = true

	atlasStore.state.moon = ref(moonStore)

	void atlasStore.tick('moon')

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('sun unmounted')
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

function showLunarEclipse() {
	if (state.eclipses.length === 0) return
	void lunarEclipseStore.load(state.eclipses[0])
	homeStore.addLunarEclipse()
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

export const moonStore = {
	state,
	mount,
	unmount,
	tick,
	showLunarEclipse,
	sync,
	goTo,
	frame,
} as const
