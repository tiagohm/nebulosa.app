import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { atlasStore, isLocationChanged, isTimeChanged } from '@stores/atlas.store'
import type { TagItem } from '@stores/atlas.store'
import { framingStore } from '@stores/framing.store'
import { homeStore } from '@stores/home.store'
import { settingsStore } from '@stores/settings.store'
import { solarEclipseStore } from '@stores/solar.eclipse.store'
import type { SolarEclipse } from 'nebulosa/src/astronomy/bodies/sun'
import { temporalAdd, temporalGet } from 'nebulosa/src/astronomy/time/temporal'
import type { Mount, UTCTime } from 'nebulosa/src/devices/indi/device'
import { formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { unsubscribe } from 'src/shared/util'
import { DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY } from 'src/types/atlas'
import type { BodyPosition, PositionOfBody } from 'src/types/atlas'
import type { SolarImageSource, SolarSeasons } from 'src/types/sun'
import { proxy, ref } from 'valtio'

export type AtlasSunStore = typeof sunStore

export interface AtlasSunState {
	readonly request: PositionOfBody
	source: SolarImageSource
	readonly position: BodyPosition
	chart: readonly number[]
	readonly seasons: SolarSeasons
	eclipses: readonly SolarEclipse[]
	readonly tags: readonly TagItem[]
}

const state = proxy<AtlasSunState>({
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
	eclipses: [],
	source: 'HMI_INTENSITYGRAM_FLATTENED',
	seasons: { spring: 0, summer: 0, autumn: 0, winter: 0 },
	tags: [{ label: 'Sun', color: 'primary' }],
})

let chartUpdate = true
let seasonsUpdate = true
let seasonsYear = 0
let eclipsesUpdate = true
let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return unmount

	console.info('sun mounted')

	mounted = true

	atlasStore.state.sun = ref(sunStore)

	u[0] = initProxy(state, 'atlas.sun', ['p:source'])

	void atlasStore.tick('sun')

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

		if ((!seasonsUpdate && dateHasChanged) || seasonsYear === 0) {
			const local = temporalAdd(time.utc, time.offset, 'm')
			const year = temporalGet(local, 'y')

			if (seasonsYear !== year) {
				seasonsUpdate = true
				seasonsYear = year
			}
		}
	}

	if (changed || chartUpdate || seasonsUpdate || eclipsesUpdate) {
		void updateSeasons()
		void updateEclipses()

		await updatePosition()
		await updateChart(dateHasChanged)
	}
}

async function updatePosition() {
	const position = await Api.Atlas.positionOfSun(state.request)
	if (position) Object.assign(state.position, position)
}

async function updateChart(force: boolean = false) {
	if (!chartUpdate && !force) return
	chartUpdate = false
	const chart = await Api.Atlas.chartOfSun(state.request)
	if (chart) state.chart = chart
	else chartUpdate = true
}

async function updateSeasons() {
	if (!seasonsUpdate) return
	seasonsUpdate = false
	const seasons = await Api.Atlas.seasons(state.request)
	if (seasons) Object.assign(state.seasons, seasons)
	else seasonsUpdate = true
}

async function updateEclipses() {
	if (!eclipsesUpdate) return
	eclipsesUpdate = false
	const request = { ...state.request, count: 1, next: true }
	const eclipses = await Api.Atlas.solarEclipses(request)
	if (eclipses) state.eclipses = eclipses
	else eclipsesUpdate = true
}

function showSolarEclipse() {
	if (state.eclipses.length === 0) return
	void solarEclipseStore.load(state.eclipses[0])
	homeStore.addSolarEclipse()
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

export const sunStore = {
	type: 'sun',
	state,
	mount,
	unmount,
	tick,
	showSolarEclipse,
	sync,
	goTo,
	frame,
} as const
