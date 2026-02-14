import { molecule, onMount, use } from 'bunshi'
import { formatDEC, formatRA } from 'nebulosa/src/angle'
import type { Mount, UTCTime } from 'nebulosa/src/indi.device'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import { type Temporal, temporalAdd, temporalGet, temporalStartOfDay, temporalSubtract } from 'nebulosa/src/temporal'
import bus from 'src/shared/bus'
// biome-ignore format: too long!
import { type BodyPosition, type CloseApproach, DEFAULT_BODY_POSITION, DEFAULT_GEOGRAPHIC_COORDINATE, DEFAULT_POSITION_OF_BODY, DEFAULT_SEARCH_SATELLITE, DEFAULT_SKY_OBJECT_SEARCH, type FindCloseApproaches, type Framing, type LocationAndTime, type LunarPhaseTime, type MinorPlanet, type NextLunarApsis, type NextLunarEclipse, type NextSolarEclipse, type PlanetType, type PositionOfBody, type Satellite, type SearchSatellite, type SearchSkyObject, type SkyObjectSearchItem, type SolarImageSource, type SolarSeasons, type Twilight } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'

export type SkyAtlasTab = 'sun' | 'moon' | 'planet' | 'asteroid' | 'galaxy' | 'satellite'

export interface BookmarkItem {
	readonly name: string
	readonly type: SkyAtlasTab
	readonly code: string // planet code, asteroid spk id, galaxy id, satellite id
}

export interface SkyAtlasState {
	show: boolean
	tab: SkyAtlasTab
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
	readonly bookmark: BookmarkItem[]
}

export interface SunState {
	readonly request: PositionOfBody
	source: SolarImageSource
	readonly position: BodyPosition
	chart: readonly number[]
	readonly seasons: SolarSeasons
	eclipses: readonly NextSolarEclipse[]
}

export interface MoonState {
	readonly request: PositionOfBody
	readonly position: BodyPosition
	chart: readonly number[]
	phases: readonly LunarPhaseTime[]
	eclipses: readonly NextLunarEclipse[]
	apsis: readonly [NextLunarApsis, NextLunarApsis]
}

export interface PlanetState {
	readonly search: {
		name: string
		type: PlanetType | 'ALL'
	}
	readonly request: PositionOfBody
	code?: string
	readonly position: BodyPosition
	chart: readonly number[]
}

export interface AsteroidState {
	tab: 'search' | 'closeapproaches'
	loading: boolean
	readonly search: {
		text: string
	}
	readonly closeApproaches: {
		readonly request: FindCloseApproaches
		result: readonly CloseApproach[]
	}
	selected?: Exclude<MinorPlanet, 'list'>
	list?: MinorPlanet['list']
	readonly request: PositionOfBody
	readonly position: BodyPosition
	chart: readonly number[]
}

export interface GalaxyState {
	loading: boolean
	readonly request: SearchSkyObject
	result: readonly SkyObjectSearchItem[]
	selected?: SkyObjectSearchItem
	readonly position: BodyPosition
	chart: readonly number[]
}

export interface SatelliteState {
	loading: boolean
	readonly request: SearchSatellite & PositionOfBody
	selected?: Satellite
	page: number
	result: readonly Satellite[]
	readonly position: BodyPosition
	chart: readonly number[]
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
sunState.request.time.utc = 0

export const SunMolecule = molecule(() => {
	const state = sunState

	let chartUpdate = true
	let seasonsUpdate = true
	let seasonsYear = 0
	let eclipsesUpdate = true

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

			if ((!seasonsUpdate && dateHasChanged) || seasonsYear === 0) {
				const local = temporalAdd(time.utc, time.offset, 'm')
				const year = temporalGet(local, 'y')

				if (seasonsYear !== year) {
					seasonsUpdate = true
					seasonsYear = year
				}
			}
		}

		if (changed) {
			void updateSeasons()
			void updateEclipses()

			await updatePosition()
			await updateChart(dateHasChanged)
		}
	}

	async function updatePosition() {
		const position = await Api.SkyAtlas.positionOfSun(state.request)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!chartUpdate && !force) return
		chartUpdate = false
		const chart = await Api.SkyAtlas.chartOfSun(state.request)
		if (chart) state.chart = chart
		else chartUpdate = true
	}

	async function updateSeasons() {
		if (!seasonsUpdate) return
		seasonsUpdate = false
		const seasons = await Api.SkyAtlas.seasons(state.request)
		if (seasons) Object.assign(state.seasons, seasons)
		else seasonsUpdate = true
	}

	async function updateEclipses() {
		if (!eclipsesUpdate) return
		eclipsesUpdate = false
		const request = { ...state.request, count: 1 }
		const eclipses = await Api.SkyAtlas.solarEclipses(request)
		if (eclipses) state.eclipses = eclipses
		else eclipsesUpdate = true
	}

	return { state, tick } as const
})

const moonState = proxy<MoonState>({
	request: structuredClone(DEFAULT_POSITION_OF_BODY),
	position: structuredClone(DEFAULT_BODY_POSITION),
	chart: [],
	phases: [],
	eclipses: [],
	apsis: [
		{ time: 0, distance: 0, diameter: 0 },
		{ time: 0, distance: 0, diameter: 0 },
	],
})

initProxy(moonState, 'skyatlas.moon', ['o:request'])
moonState.request.time.utc = 0

export const MoonMolecule = molecule(() => {
	const state = moonState

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
		const position = await Api.SkyAtlas.positionOfMoon(state.request)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!chartUpdate && !force) return
		chartUpdate = false
		const chart = await Api.SkyAtlas.chartOfMoon(state.request)
		if (chart) state.chart = chart
		else chartUpdate = true
	}

	async function updatePhases() {
		if (!phasesUpdate) return
		phasesUpdate = false
		const phases = await Api.SkyAtlas.moonPhases(state.request)
		if (phases) state.phases = phases
		else phasesUpdate = true
	}

	async function updateEclipses() {
		if (!eclipsesUpdate) return
		eclipsesUpdate = false
		const request = { ...state.request, count: 1 }
		const eclipses = await Api.SkyAtlas.moonEclipses(request)
		if (eclipses) state.eclipses = eclipses
		else eclipsesUpdate = true
	}

	async function updateApsis() {
		if (!apsisUpdate) return
		apsisUpdate = false
		const request = { ...state.request, count: 1 }
		const apsis = await Api.SkyAtlas.moonApsis(request)
		if (apsis) state.apsis = apsis
		else apsisUpdate = true
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
planetState.request.time.utc = 0

export const PlanetMolecule = molecule(() => {
	const state = planetState

	let chartUpdate = true

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
		}

		if (changed) {
			await updatePosition()
			await updateChart(dateHasChanged)
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
		chartUpdate = false
		const chart = await Api.SkyAtlas.chartOfPlanet(state.request, state.code)
		if (chart) state.chart = chart
		else chartUpdate = true
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
asteroidState.request.time.utc = 0

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
		chartUpdate = false
		const code = `DES=${state.selected!.id};`
		const chart = await Api.SkyAtlas.chartOfPlanet(state.request, code)
		if (chart) state.chart = chart
		else chartUpdate = true
	}

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
		}

		// Refresh selected object
		if (changed && state.selected) {
			await updatePosition()
			await updateChart(dateHasChanged)
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
galaxyState.request.time.utc = 0

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
		const { id } = state.selected!
		const position = await Api.SkyAtlas.positionOfSkyObject(state.request, id)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!chartUpdate && !force) return
		chartUpdate = false
		const { id } = state.selected!
		const chart = await Api.SkyAtlas.chartOfSkyObject(state.request, id)
		if (chart) state.chart = chart
		else chartUpdate = true
	}

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
		}

		if (!changed) return

		// Refresh visible objects above horizon
		if (state.request.visible) {
			void search(false)
		}

		// Refresh selected object
		if (state.selected) {
			await updatePosition()
			await updateChart(dateHasChanged)
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
satelliteState.request.time.utc = 0

export const SatelliteMolecule = molecule(() => {
	const state = satelliteState

	let chartUpdate = true

	onMount(() => {
		void search()
	})

	function update<K extends keyof SatelliteState['request']>(key: K, value: SatelliteState['request'][K]) {
		state.request[key] = value

		// Search again if page or sort has been changed
		if (key === 'page' || key === 'sort') void search(false)
	}

	async function search(reset: boolean = true) {
		try {
			state.loading = true

			if (reset) state.request.page = 1

			const result = await Api.SkyAtlas.searchSatellite(state.request)
			state.result = result ?? []
		} finally {
			state.loading = false
		}
	}

	function resetFilter() {
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
		update('page', state.request.page + 1)
	}

	function prev() {
		if (state.request.page <= 1) return
		update('page', state.request.page - 1)
	}

	async function updatePosition() {
		if (!state.selected) return
		const position = await Api.SkyAtlas.positionOfSatellite(state.request, state.selected.id)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (!state.selected) return
		if (!chartUpdate && !force) return
		chartUpdate = false
		const chart = await Api.SkyAtlas.chartOfSatellite(state.request, state.selected.id)
		if (chart) state.chart = chart
		else chartUpdate = true
	}

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
		}

		// Refresh selected object
		if (changed && state.selected?.id) {
			await updatePosition()
			await updateChart(dateHasChanged)
		}
	}

	return { state, update, search, resetFilter, next, prev, select, tick } as const
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
	bookmark: [],
})

initProxy(state, 'skyatlas', ['p:show', 'p:tab', 'o:bookmark'])
initProxy(state.request, 'skyatlas', ['o:location'])
initProxy(state.request.time, 'skyatlas.time', ['p:offset'])

export const SkyAtlasMolecule = molecule(() => {
	const sun = use(SunMolecule)
	const moon = use(MoonMolecule)
	const planet = use(PlanetMolecule)
	const asteroid = use(AsteroidMolecule)
	const galaxy = use(GalaxyMolecule)
	const satellite = use(SatelliteMolecule)

	let updating = false
	let twilightUpdate = true
	let twilightStartTime = 0

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
		twilightUpdate = state.request.location.longitude !== location.longitude
		Object.assign(state.request.location, location)
		void tick()
	}

	async function tick(utc?: Temporal) {
		if (!state.show || updating) return

		updating = true

		const { time, location } = state.request

		utc ??= state.calendar.manual ? time.utc : Date.now()

		if (!twilightUpdate || twilightStartTime === 0) {
			const b = computeStartTime(utc, time.offset)

			if (twilightStartTime !== b) {
				twilightUpdate = true
				twilightStartTime = b
			}
		}

		time.utc = utc
		const dateHasChanged = twilightUpdate

		await twilight()

		if (state.tab === 'sun') sun.tick(time, location, dateHasChanged)
		else if (state.tab === 'moon') moon.tick(time, location, dateHasChanged)
		else if (state.tab === 'planet') planet.tick(time, location, dateHasChanged)
		else if (state.tab === 'asteroid') asteroid.tick(time, location, dateHasChanged)
		else if (state.tab === 'galaxy') galaxy.tick(time, location, dateHasChanged)
		else if (state.tab === 'satellite') satellite.tick(time, location, dateHasChanged)

		updating = false
	}

	async function twilight() {
		if (!twilightUpdate) return
		twilightUpdate = false
		const twilight = await Api.SkyAtlas.twilight(state.request)
		if (twilight) state.twilight = twilight
		else twilightUpdate = true
	}

	function sync(mount?: Mount) {
		if (!mount) return undefined
		const { position } = state[state.tab]
		const [rightAscension, declination] = position.equatorial
		return Api.Mounts.sync(mount, { type: 'JNOW', JNOW: { x: rightAscension, y: declination } })
	}

	function goTo(mount?: Mount) {
		if (!mount) return undefined
		const { position } = state[state.tab]
		const [rightAscension, declination] = position.equatorial
		return Api.Mounts.goTo(mount, { type: 'JNOW', JNOW: { x: rightAscension, y: declination } })
	}

	function frame() {
		const { position } = state[state.tab]
		const [rightAscension, declination] = position.equatorialJ2000
		const request: Partial<Framing> = { rightAscension: formatRA(rightAscension), declination: formatDEC(declination) }
		bus.emit('framing:load', request)
	}

	function bookmark(type: SkyAtlasTab, name: string, code: string, favorite: boolean) {
		if (favorite) {
			state.bookmark.push({ type, name, code })
		} else {
			const index = state.bookmark.findIndex((e) => e.type === type && e.code === code)
			index >= 0 && state.bookmark.splice(index, 1)
		}
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

	return { state, updateTime, updateLocation, sync, goTo, frame, bookmark, showLocation, hideLocation, show, hide }
})

function isLocationChanged(a: GeographicCoordinate, b: GeographicCoordinate) {
	return a.latitude !== b.latitude || a.longitude !== b.longitude || a.elevation !== b.elevation
}

function isTimeChanged(a: UTCTime, b: UTCTime) {
	return Math.abs(a.utc - b.utc) >= 60000 || a.offset !== b.offset
}

function computeStartTime(utc: number, offset: number) {
	const local = temporalAdd(utc, offset, 'm')
	const hour = temporalGet(local, 'h')

	let startTime = temporalStartOfDay(local)
	// if not passed noon, go to the previous day
	if (hour < 12) startTime = temporalSubtract(startTime, 1, 'd')
	// set to UTC noon + local offset (if enabled)
	return temporalAdd(startTime, 720 - offset, 'm')
}
