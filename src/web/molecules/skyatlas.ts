import { molecule, onMount } from 'bunshi'
import { deg, formatDEC, formatRA } from 'nebulosa/src/angle'
import { meter } from 'nebulosa/src/distance'
import type { Temporal } from 'nebulosa/src/temporal'
import type React from 'react'
import bus, { unsubscribe } from 'src/shared/bus'
// biome-ignore format: too long!
import { type BodyPosition, type CloseApproach, DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY, DEFAULT_SATELLITE, DEFAULT_SEARCH_SATELLITE, DEFAULT_SKY_OBJECT_SEARCH, type FindCloseApproaches, type Framing, type GeographicCoordinate, type LocationAndTime, type LunarPhaseTime, type MinorPlanet, type Mount, type NextLunarEclipse, type NextSolarEclipse, type PositionOfBody, type Satellite, type SearchSatellite, type SearchSkyObject, type SkyObjectSearchItem, type SolarImageSource, type SolarSeasons, type Twilight, type UTCTime } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { storage } from '@/shared/storage'

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
	readonly request: {
		readonly search: SearchSatellite
		readonly position: PositionOfBody & Satellite
	}
	page: number
	result: Satellite[]
	readonly position: BodyPosition
	chart: number[]
}

let skyAtlasState: SkyAtlasState | undefined
let sunState: SunState | undefined
let moonState: MoonState | undefined
let asteroidState: AsteroidState | undefined
let galaxyState: GalaxyState | undefined
let satelliteState: SatelliteState | undefined

export const SunMolecule = molecule(() => {
	const request = structuredClone(DEFAULT_POSITION_OF_BODY)

	const state =
		sunState ??
		proxy<SunState>({
			request,
			position: structuredClone(DEFAULT_BODY_POSITION),
			chart: [],
			eclipses: [],
			source: storage.get<SolarImageSource>('skyatlas.sun.source', () => 'HMI_INTENSITYGRAM_FLATTENED'),
			seasons: {
				spring: 0,
				summer: 0,
				autumn: 0,
				winter: 0,
			},
		})

	sunState = state

	onMount(() => {
		const unsubscribers = new Array<() => void>(1)

		unsubscribers[0] = subscribeKey(state, 'source', () => {
			storage.set('skyatlas.sun.source', state.source)
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	let chartUpdate = true
	let seasonsUpdate = true
	let eclipsesUpdate = true

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, request.location)) {
			Object.assign(request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (Math.abs(time.utc - request.time.utc) >= 60000 || time.offset !== request.time.offset) {
			Object.assign(request.time, time)
			changed = true
		}

		if (changed) {
			void updateSeasons()
			void updateEclipses()

			await updatePosition()
			await updateChart()
		}
	}

	async function updatePosition() {
		const position = await Api.SkyAtlas.positionOfSun(state.request)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart() {
		if (!chartUpdate) return
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

export const MoonMolecule = molecule(() => {
	const request = structuredClone(DEFAULT_POSITION_OF_BODY)

	const state =
		moonState ??
		proxy<MoonState>({
			request,
			position: structuredClone(DEFAULT_BODY_POSITION),
			chart: [],
			phases: [],
			eclipses: [],
		})

	moonState = state

	let chartUpdate = true
	let phasesUpdate = true
	let eclipsesUpdate = true

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, request.location)) {
			Object.assign(request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (time.utc - request.time.utc >= 60000 || time.offset !== request.time.offset) {
			Object.assign(request.time, time)
			changed = true
		}

		if (changed) {
			void updatePhases()
			void updateEclipses()

			await updatePosition()
			await updateChart()
		}
	}

	async function updatePosition() {
		const position = await Api.SkyAtlas.positionOfMoon(state.request)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart() {
		if (!chartUpdate) return
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

export const PlanetMolecule = molecule(() => {
	const request = structuredClone(DEFAULT_POSITION_OF_BODY)

	const state = proxy<PlanetState>({
		request,
		position: structuredClone(DEFAULT_BODY_POSITION),
		chart: [],
	})

	let chartUpdate = true

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, request.location)) {
			Object.assign(request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (time.utc - request.time.utc >= 60000 || time.offset !== request.time.offset) {
			Object.assign(request.time, time)
			changed = true
		}

		if (changed) {
			await updatePosition()
			await updateChart()
		}
	}

	async function updatePosition() {
		if (!state.code) return
		const position = await Api.SkyAtlas.positionOfPlanet(state.request, state.code)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if ((!chartUpdate && !force) || !state.code) return
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

	return { state, tick, select } as const
})

export const AsteroidMolecule = molecule(() => {
	const request = structuredClone(DEFAULT_POSITION_OF_BODY)

	const state =
		asteroidState ??
		proxy<AsteroidState>({
			tab: 'search',
			loading: false,
			search: {
				text: '',
			},
			closeApproaches: {
				request: storage.get<FindCloseApproaches>('skyatlas.asteroid.closeapproaches.request', () => ({ days: 7, distance: 10 })),
				result: [],
			},
			request,
			position: structuredClone(DEFAULT_BODY_POSITION),
			chart: [],
		})

	asteroidState = state

	let chartUpdate = true

	onMount(() => {
		const unsubscriber = subscribe(state.closeApproaches.request, () => {
			storage.set('skyatlas.asteroid.closeapproaches.request', state.closeApproaches.request)
		})

		return () => {
			unsubscriber()
		}
	})

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

			if (!result) return

			state.closeApproaches.result = result
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
		if (!force && !chartUpdate) return
		const code = `DES=${state.selected!.id};`
		const chart = await Api.SkyAtlas.chartOfPlanet(state.request, code)
		if (chart) state.chart = chart
		chartUpdate = false
	}

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, request.location)) {
			Object.assign(request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (time.utc - request.time.utc >= 60000 || time.offset !== request.time.offset) {
			Object.assign(request.time, time)
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

export const GalaxyMolecule = molecule(() => {
	const request = storage.get<SearchSkyObject>('skyatlas.galaxy.request', () => structuredClone(DEFAULT_SKY_OBJECT_SEARCH))

	request.page = 1

	const state =
		galaxyState ??
		proxy<GalaxyState>({
			loading: false,
			request,
			result: [],
			position: structuredClone(DEFAULT_BODY_POSITION),
			chart: [],
		})

	galaxyState = state

	let chartUpdate = true

	onMount(() => {
		const unsubscriber = subscribe(state.request, () => {
			storage.set('skyatlas.galaxy.request', state.request)
		})

		void search()

		return () => {
			unsubscriber()
		}
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
		if (!force && !chartUpdate) return
		const id = state.selected!.id
		const chart = await Api.SkyAtlas.chartOfSkyObject(state.request, id)
		if (chart) state.chart = chart
		chartUpdate = false
	}

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, request.location)) {
			Object.assign(request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (time.utc - request.time.utc >= 60000 || time.offset !== request.time.offset) {
			Object.assign(request.time, time)
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

const DEFAULT_SATELLITE_STATE_REQUEST: SatelliteState['request'] = {
	search: { ...DEFAULT_SEARCH_SATELLITE },
	position: {
		...DEFAULT_POSITION_OF_BODY,
		...DEFAULT_SATELLITE,
	},
}

export const SatelliteMolecule = molecule(() => {
	const searchRequest = storage.get('skyatlas.satellite.search', () => structuredClone(DEFAULT_SATELLITE_STATE_REQUEST.search))
	const request = structuredClone(DEFAULT_SATELLITE_STATE_REQUEST.position)

	searchRequest.lastId = 0

	const state =
		satelliteState ??
		proxy<SatelliteState>({
			loading: false,
			request: { search: searchRequest, position: request },
			result: [],
			position: structuredClone(DEFAULT_BODY_POSITION),
			chart: [],
			page: 1,
		})

	satelliteState = state

	let chartUpdate = true
	const pages: number[] = [0]

	onMount(() => {
		const unsubscriber = subscribe(state.request.search, () => {
			storage.set('skyatlas.satellite.search', state.request.search)
		})

		void search()

		return () => {
			unsubscriber()
		}
	})

	function update<K extends keyof SearchSatellite>(key: K, value: SearchSatellite[K]) {
		state.request.search[key] = value
	}

	async function search() {
		try {
			state.loading = true
			const result = await Api.SkyAtlas.searchSatellite(state.request.search)
			state.result = result ?? []
		} finally {
			state.loading = false
		}
	}

	function reset() {
		state.request.search.groups = [...DEFAULT_SEARCH_SATELLITE.groups]
	}

	async function select(id: number, force: boolean = true) {
		const selected = state.result.find((dso) => dso.id === id)

		// Fetches object's position and chart if a new one was selected
		if (selected && (force || state.request.position.id !== selected.id)) {
			Object.assign(state.request.position, selected)

			await updatePosition()
			await updateChart(true)
		}
	}

	function next() {
		if (state.result.length === 0) return
		pages[state.page++] = state.result[0].id - 1
		update('lastId', state.result[state.result.length - 1].id)
	}

	function prev() {
		if (state.page <= 1) return
		update('lastId', pages[--state.page])
	}

	async function updatePosition() {
		const position = await Api.SkyAtlas.positionOfSatellite(state.request.position)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!force && !chartUpdate) return
		const chart = await Api.SkyAtlas.chartOfSatellite(state.request.position)
		if (chart) state.chart = chart
		chartUpdate = false
	}

	async function tick(time: UTCTime, location: GeographicCoordinate) {
		let changed = false

		if (isLocationChanged(location, request.location)) {
			Object.assign(request.location, location)
			changed = true
		}

		// Updates only if passed more than 1 minute since last update
		if (time.utc - request.time.utc >= 60000 || time.offset !== request.time.offset) {
			Object.assign(request.time, time)
			changed = true
		}

		// Refresh selected object
		if (changed && request.id) {
			await updatePosition()
			await updateChart(false)
		}
	}

	return { state, update, search, reset, next, prev, select, tick } as const
})

export const SkyAtlasMolecule = molecule((m) => {
	const sun = m(SunMolecule)
	const moon = m(MoonMolecule)
	const planet = m(PlanetMolecule)
	const asteroid = m(AsteroidMolecule)
	const galaxy = m(GalaxyMolecule)
	const satellite = m(SatelliteMolecule)

	const state =
		skyAtlasState ??
		proxy<SkyAtlasState>({
			show: false,
			tab: 'sun',
			twilight: undefined,
			request: {
				location: {
					longitude: deg(-45),
					latitude: deg(-22),
					elevation: meter(890),
				},
				time: {
					utc: Date.now(),
					offset: -180,
				},
			},
			sun: sun.state,
			moon: moon.state,
			planet: planet.state,
			asteroid: asteroid.state,
			galaxy: galaxy.state,
			satellite: satellite.state,
			calendar: {
				show: false,
				manual: false,
			},
		})

	skyAtlasState = state

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

		void twilight()

		const timer = setInterval(tick, 60000)

		return () => {
			unsubscribe(unsubscribers)
			clearInterval(timer)
		}
	})

	function updateTime(utc: number, manual: boolean = true) {
		state.calendar.manual = manual
		void tick(utc)
	}

	async function tick(utc?: Temporal) {
		if (!state.show) return

		const { time, location } = state.request

		if (utc === undefined) utc = state.calendar.manual ? time.utc : Date.now()

		time.utc = utc
		time.offset = -180 // TODO

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

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, updateTime, syncTo, goTo, frame, show, hide }
})

function isLocationChanged(a: GeographicCoordinate, b: GeographicCoordinate) {
	return a.latitude !== b.latitude || a.longitude !== b.longitude || a.elevation !== b.elevation
}
