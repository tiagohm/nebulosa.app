import { molecule, onMount } from 'bunshi'
import { formatDEC, formatRA } from 'nebulosa/src/angle'
import type { Temporal } from 'nebulosa/src/temporal'
import type React from 'react'
import bus, { unsubscribe } from 'src/shared/bus'
// biome-ignore format: too long!
import { type BodyPosition, type CloseApproach, DEFAULT_BODY_POSITION, DEFAULT_GEOGRAPHIC_COORDINATE, DEFAULT_POSITION_OF_BODY, DEFAULT_SEARCH_SATELLITE, DEFAULT_SKY_OBJECT_SEARCH, type FindCloseApproaches, type Framing, type GeographicCoordinate, type LocationAndTime, type LunarPhaseTime, type MinorPlanet, type Mount, type NextLunarEclipse, type NextSolarEclipse, type PlanetType, type PositionOfBody, type Satellite, type SearchSatellite, type SearchSkyObject, type SkyObjectSearchItem, type SolarImageSource, type SolarSeasons, type Twilight, type UTCTime } from 'src/shared/types'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'

export interface SkyAtlasState {
	show: boolean
	tab: 'sun' | 'moon' | 'planet' | 'asteroid' | 'galaxy' | 'satellite'
	twilight?: Twilight
	readonly request: LocationAndTime
	readonly sun: SunState
	readonly moon: MoonState
	readonly planet: PlanetState
	readonly asteroid: AsteroidState
	readonly galaxy: GalaxyState
	readonly satellite: SatelliteState
	readonly calendar: {
		show: boolean
		manual: boolean
	}
	readonly location: {
		show: boolean
	}
}

export interface SunState {
	readonly request: PositionOfBody
	source: SolarImageSource
	readonly position: BodyPosition
	chart: number[]
	readonly seasons: SolarSeasons
	eclipses: NextSolarEclipse[]
}

export interface MoonState {
	readonly request: PositionOfBody
	readonly position: BodyPosition
	chart: number[]
	phases: readonly LunarPhaseTime[]
	eclipses: NextLunarEclipse[]
}

export interface PlanetState {
	readonly search: {
		name: string
		type: PlanetType | 'ALL'
	}
	readonly request: PositionOfBody
	code?: string
	readonly position: BodyPosition
	chart: number[]
}

export interface AsteroidState {
	tab: 'search' | 'closeapproaches'
	loading: boolean
	readonly search: {
		text: string
	}
	readonly closeApproaches: {
		readonly request: FindCloseApproaches
		result: CloseApproach[]
	}
	selected?: Exclude<MinorPlanet, 'list'>
	list?: MinorPlanet['list']
	readonly request: PositionOfBody
	readonly position: BodyPosition
	chart: number[]
}

export interface GalaxyState {
	loading: boolean
	readonly request: SearchSkyObject
	result: SkyObjectSearchItem[]
	selected?: SkyObjectSearchItem
	readonly position: BodyPosition
	chart: number[]
}

export interface SatelliteState {
	loading: boolean
	readonly request: SearchSatellite & PositionOfBody
	selected?: Satellite
	page: number
	result: Satellite[]
	readonly position: BodyPosition
	chart: number[]
}

const sunState = proxy<SunState>({
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
	eclipses: [],
	source: 'HMI_INTENSITYGRAM_FLATTENED',
	seasons: { spring: 0, summer: 0, autumn: 0, winter: 0 },
})

initProxy(sunState, 'skyatlas.sun', ['o:request', 'p:source'])

export const SunMolecule = molecule(() => {
	const state = sunState

	let chartUpdate = true
	let seasonsUpdate = true
	let eclipsesUpdate = true

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, state.request.location)) {
			Object.assign(state.request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (isTimeChanged(time, state.request.time)) {
			Object.assign(state.request.time, time)
			changed = true
		}

		if (changed) {
			void updateSeasons()
			void updateEclipses()

			await updatePosition()
			await updateChart(false)
		}
	}

	async function updatePosition() {
		const position = await Api.SkyAtlas.positionOfSun(state.request)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!chartUpdate && !force) return
		const chart = await Api.SkyAtlas.chartOfSun(state.request)
		if (chart) state.chart = chart
		chartUpdate = false
	}

	async function updateSeasons() {
		if (!seasonsUpdate) return
		const seasons = await Api.SkyAtlas.seasons(state.request)
		if (seasons) Object.assign(state.seasons, seasons)
		seasonsUpdate = false
	}

	async function updateEclipses() {
		if (!eclipsesUpdate) return
		const request = { ...state.request, count: 1 }
		const eclipses = await Api.SkyAtlas.solarEclipses(request)
		if (eclipses) state.eclipses = eclipses
		eclipsesUpdate = false
	}

	return { state, tick } as const
})

const moonState = proxy<MoonState>({
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
	phases: [],
	eclipses: [],
})

initProxy(moonState, 'skyatlas.moon', ['o:request'])

export const MoonMolecule = molecule(() => {
	const state = moonState

	let chartUpdate = true
	let phasesUpdate = true
	let eclipsesUpdate = true

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, state.request.location)) {
			Object.assign(state.request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (isTimeChanged(time, state.request.time)) {
			Object.assign(state.request.time, time)
			changed = true
		}

		if (changed) {
			void updatePhases()
			void updateEclipses()

			await updatePosition()
			await updateChart(false)
		}
	}

	async function updatePosition() {
		const position = await Api.SkyAtlas.positionOfMoon(state.request)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!chartUpdate && !force) return
		const chart = await Api.SkyAtlas.chartOfMoon(state.request)
		if (chart) state.chart = chart
		chartUpdate = false
	}

	async function updatePhases() {
		if (!phasesUpdate) return
		const phases = await Api.SkyAtlas.moonPhases(state.request)
		if (phases) state.phases = phases
		phasesUpdate = false
	}

	async function updateEclipses() {
		if (!eclipsesUpdate) return
		const request = { ...state.request, count: 1 }
		const eclipses = await Api.SkyAtlas.moonEclipses(request)
		if (eclipses) state.eclipses = eclipses
		eclipsesUpdate = false
	}

	return { state, tick } as const
})

const planetState = proxy<PlanetState>({
	search: {
		name: '',
		type: 'ALL',
	},
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
})

initProxy(planetState, 'skyatlas.planet', ['o:search', 'o:request'])

export const PlanetMolecule = molecule(() => {
	const state = planetState

	let chartUpdate = true

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, state.request.location)) {
			Object.assign(state.request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (isTimeChanged(time, state.request.time)) {
			Object.assign(state.request.time, time)
			changed = true
		}

		if (changed) {
			await updatePosition()
			await updateChart(false)
		}
	}

	function update<K extends keyof PlanetState['search']>(key: K, value: PlanetState['search'][K]) {
		state.search[key] = value
	}

	async function updatePosition() {
		if (!state.code) return
		const position = await Api.SkyAtlas.positionOfPlanet(state.request, state.code)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!state.code) return
		if (!chartUpdate && !force) return
		const chart = await Api.SkyAtlas.chartOfPlanet(state.request, state.code)
		if (chart) state.chart = chart
		chartUpdate = false
	}

	async function select(code: string, force: boolean = true) {
		// Fetches object's position and chart if a new one was selected
		if (code && (force || state.code !== code)) {
			state.code = code

			await updatePosition()
			await updateChart(true)
		}
	}

	return { state, tick, update, select } as const
})

const asteroidState = proxy<AsteroidState>({
	tab: 'search',
	loading: false,
	search: {
		text: '',
	},
	closeApproaches: {
		request: { days: 7, distance: 10 },
		result: [],
	},
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
})

initProxy(asteroidState, 'skyatlas.asteroid', ['p:tab', 'o:request'])
initProxy(asteroidState, 'skyatlas.asteroid.closeapproaches', ['o:request'])

export const AsteroidMolecule = molecule(() => {
	const state = asteroidState

	let chartUpdate = true

	function updateSearch(value: string) {
		state.search.text = value
	}

	function updateCloseApproaches<K extends keyof FindCloseApproaches>(key: K, value: FindCloseApproaches[K]) {
		state.closeApproaches.request[key] = value
	}

	async function search() {
		try {
			state.loading = true

			const result = await Api.SkyAtlas.searchMinorPlanet({ text: state.search.text })

			if (!result) return

			if ('list' in result) {
				state.list = result.list
			} else {
				state.selected = result
				state.list = undefined

				await updatePosition()
				await updateChart(true)
			}
		} finally {
			state.loading = false
		}
	}

	async function closeApproaches() {
		try {
			state.loading = true

			const result = await Api.SkyAtlas.findCloseApproaches(state.closeApproaches.request)
			state.closeApproaches.result = result ?? []
		} finally {
			state.loading = false
		}
	}

	function select(pdes: React.Key) {
		state.search.text = `${pdes}`
		state.tab = 'search'
		return search()
	}

	async function updatePosition() {
		const code = `DES=${state.selected!.id};`
		const position = await Api.SkyAtlas.positionOfPlanet(state.request, code)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!chartUpdate && !force) return
		const code = `DES=${state.selected!.id};`
		const chart = await Api.SkyAtlas.chartOfPlanet(state.request, code)
		if (chart) state.chart = chart
		chartUpdate = false
	}

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, state.request.location)) {
			Object.assign(state.request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (isTimeChanged(time, state.request.time)) {
			Object.assign(state.request.time, time)
			changed = true
		}

		// Refresh selected object
		if (changed && state.selected) {
			await updatePosition()
			await updateChart(false)
		}
	}

	return { state, updateSearch, updateCloseApproaches, search, closeApproaches, select, tick } as const
})

const galaxyState = proxy<GalaxyState>({
	loading: false,
	request: structuredClone(DEFAULT_SKY_OBJECT_SEARCH),
	result: [],
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
})

initProxy(galaxyState, 'skyatlas.galaxy', ['o:request'])

export const GalaxyMolecule = molecule(() => {
	const state = galaxyState

	let chartUpdate = true

	onMount(() => {
		void search()
	})

	function update<K extends keyof SearchSkyObject>(key: K, value: SearchSkyObject[K]) {
		state.request[key] = value

		// Search again if page or sort has been changed
		if (key === 'page' || key === 'sort') void search(false)
	}

	async function search(reset: boolean = true) {
		try {
			state.loading = true

			if (reset) state.request.page = 1

			const result = await Api.SkyAtlas.searchSkyObject(state.request)
			state.result = result ?? []
		} finally {
			state.loading = false
		}
	}

	function next() {
		if (state.result.length === 0) return
		update('page', state.request.page + 1)
	}

	function prev() {
		if (state.request.page <= 1) return
		update('page', state.request.page - 1)
	}

	async function select(id: number, force: boolean = true) {
		const selected = state.result.find((dso) => dso.id === id)

		// Fetches object's position and chart if a new one was selected
		if (selected && (force || state.selected?.id !== selected.id)) {
			state.selected = selected

			await updatePosition()
			await updateChart(true)
		}
	}

	async function updatePosition() {
		const id = state.selected!.id
		const position = await Api.SkyAtlas.positionOfSkyObject(state.request, id)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!chartUpdate && !force) return
		const id = state.selected!.id
		const chart = await Api.SkyAtlas.chartOfSkyObject(state.request, id)
		if (chart) state.chart = chart
		chartUpdate = false
	}

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, state.request.location)) {
			Object.assign(state.request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (isTimeChanged(time, state.request.time)) {
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
			await updateChart(false)
		}
	}

	return { state, update, search, next, prev, select, tick } as const
})

const satelliteState = proxy<SatelliteState>({
	loading: false,
	request: {
		...DEFAULT_SEARCH_SATELLITE,
		...DEFAULT_POSITION_OF_BODY,
	},
	result: [],
	position: DEFAULT_BODY_POSITION,
	chart: [],
	page: 1,
})

initProxy(satelliteState, 'skyatlas.satellite', ['o:request'])
satelliteState.request.lastId = 0

export const SatelliteMolecule = molecule(() => {
	const state = satelliteState

	let chartUpdate = true
	const pages: number[] = [0]

	onMount(() => {
		void search()
	})

	function update<K extends keyof SatelliteState['request']>(key: K, value: SatelliteState['request'][K]) {
		state.request[key] = value
	}

	async function search() {
		try {
			state.loading = true
			const result = await Api.SkyAtlas.searchSatellite(state.request)
			state.result = result ?? []
		} finally {
			state.loading = false
		}
	}

	function reset() {
		state.request.category = [...DEFAULT_SEARCH_SATELLITE.category]
		state.request.groups = [...DEFAULT_SEARCH_SATELLITE.groups]
	}

	async function select(id: number, force: boolean = true) {
		const selected = state.result.find((dso) => dso.id === id)

		// Fetches object's position and chart if a new one was selected
		if (selected && (force || state.selected?.id !== selected.id)) {
			state.selected = selected

			await updatePosition()
			await updateChart(true)
		}
	}

	function next() {
		if (state.result.length === 0) return
		pages[state.page++] = state.result[0].id - 1
		update('lastId', state.result[state.result.length - 1].id)
		return search()
	}

	function prev() {
		if (state.page <= 1) return
		update('lastId', pages[--state.page])
		return search()
	}

	async function updatePosition() {
		if (!state.selected) return
		const position = await Api.SkyAtlas.positionOfSatellite(state.request, state.selected.id)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!state.selected) return
		if (!chartUpdate && !force) return
		const chart = await Api.SkyAtlas.chartOfSatellite(state.request, state.selected.id)
		if (chart) state.chart = chart
		chartUpdate = false
	}

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, state.request.location)) {
			Object.assign(state.request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (isTimeChanged(time, state.request.time)) {
			Object.assign(state.request.time, time)
			changed = true
		}

		// Refresh selected object
		if (changed && state.selected?.id) {
			await updatePosition()
			await updateChart(false)
		}
	}

	return { state, update, search, reset, next, prev, select, tick } as const
})

const state = proxy<SkyAtlasState>({
	show: false,
	tab: 'sun',
	twilight: undefined,
	request: {
		location: structuredClone(DEFAULT_GEOGRAPHIC_COORDINATE),
		time: {
			utc: 0,
			offset: 0,
		},
	},
	calendar: {
		show: false,
		manual: false,
	},
	location: {
		show: false,
	},
	sun: sunState,
	moon: moonState,
	planet: planetState,
	asteroid: asteroidState,
	galaxy: galaxyState,
	satellite: satelliteState,
})

initProxy(state, 'skyatlas', ['p:show', 'p:tab'])
initProxy(state.request, 'skyatlas', ['o:location'])
initProxy(state.request.time, 'skyatlas.time', ['p:offset'])

export const SkyAtlasMolecule = molecule((m) => {
	const sun = m(SunMolecule)
	const moon = m(MoonMolecule)
	const planet = m(PlanetMolecule)
	const asteroid = m(AsteroidMolecule)
	const galaxy = m(GalaxyMolecule)
	const satellite = m(SatelliteMolecule)

	let twilightUpdate = true

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = subscribeKey(state, 'show', (show) => {
			if (!show) return

			void tick()
		})

		unsubscribers[1] = subscribeKey(state, 'tab', () => {
			void tick()
		})

		if (state.show) {
			void tick()
		}

		const timer = setInterval(tick, 60000)

		return () => {
			unsubscribe(unsubscribers)
			clearInterval(timer)
		}
	})

	function updateTime(utc: number, offset: number, manual: boolean = true) {
		state.request.time.offset = offset
		state.calendar.manual = manual
		void tick(utc)
	}

	function updateLocation(location: GeographicCoordinate) {
		Object.assign(state.request.location, location)
		void tick()
	}

	async function tick(utc?: Temporal) {
		if (!state.show) return

		const { time, location } = state.request

		if (utc === undefined) utc = state.calendar.manual ? time.utc : Date.now()

		time.utc = utc

		await twilight()

		if (state.tab === 'sun') sun.tick(time, location)
		else if (state.tab === 'moon') moon.tick(time, location)
		else if (state.tab === 'planet') planet.tick(time, location)
		else if (state.tab === 'asteroid') asteroid.tick(time, location)
		else if (state.tab === 'galaxy') galaxy.tick(time, location)
		else if (state.tab === 'satellite') satellite.tick(time, location)
	}

	async function twilight() {
		if (!twilightUpdate) return
		state.twilight = await Api.SkyAtlas.twilight(state.request)
		twilightUpdate = false
	}

	function syncTo(mount?: Mount) {
		if (!mount) return undefined
		const position = state[state.tab].position
		return Api.Mounts.syncTo(mount, { type: 'JNOW', ...position })
	}

	function goTo(mount?: Mount) {
		if (!mount) return undefined
		const position = state[state.tab].position
		return Api.Mounts.goTo(mount, { type: 'JNOW', ...position })
	}

	function frame() {
		const position = state[state.tab].position

		const request: Partial<Framing> = {
			rightAscension: formatRA(position.rightAscensionJ2000),
			declination: formatDEC(position.declinationJ2000),
		}

		bus.emit('framing:load', request)
	}

	function showLocation() {
		state.location.show = true
	}

	function hideLocation() {
		state.location.show = false
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, updateTime, updateLocation, syncTo, goTo, frame, showLocation, hideLocation, show, hide }
})

function isLocationChanged(a: GeographicCoordinate, b: GeographicCoordinate) {
	return a.latitude !== b.latitude || a.longitude !== b.longitude || a.elevation !== b.elevation
}

function isTimeChanged(a: UTCTime, b: UTCTime) {
	return Math.abs(a.utc - b.utc) >= 60000 || a.offset !== b.offset
}
