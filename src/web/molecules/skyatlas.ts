import { molecule, onMount } from 'bunshi'
import { deg, formatDEC, formatRA } from 'nebulosa/src/angle'
import bus from 'src/shared/bus'
// biome-ignore format: too long!
import { type BodyPosition, DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY, DEFAULT_SKY_OBJECT_SEARCH, type Framing, type LocationAndTime, type LunarPhaseTime, type Mount, type PositionOfBody, type SkyObjectSearch, type SkyObjectSearchItem, type SolarImageSource, type SolarSeasons, type Twilight } from 'src/shared/types'
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
}

export interface SunState {
	readonly request: PositionOfBody
	source: SolarImageSource
	readonly position: BodyPosition
	chart: number[]
	readonly seasons: SolarSeasons
}

export interface MoonState {
	readonly request: PositionOfBody
	readonly position: BodyPosition
	chart: number[]
	phases: readonly LunarPhaseTime[]
}

export interface PlanetState {
	readonly position: BodyPosition
	chart: number[]
}

export interface AsteroidState {
	readonly position: BodyPosition
	chart: number[]
}

export interface GalaxyState {
	loading: boolean
	readonly request: SkyObjectSearch
	result: SkyObjectSearchItem[]
	selected?: SkyObjectSearchItem
	readonly position: BodyPosition
	chart: number[]
}

export interface SatelliteState {
	readonly position: BodyPosition
	chart: number[]
}

let skyAtlasState: SkyAtlasState | undefined
let sunState: SunState | undefined
let moonState: MoonState | undefined
let galaxyState: GalaxyState | undefined

export const SunMolecule = molecule(() => {
	const request = structuredClone(DEFAULT_POSITION_OF_BODY)

	const state =
		sunState ??
		proxy<SunState>({
			request,
			position: structuredClone(DEFAULT_BODY_POSITION),
			chart: [],
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

		const timer = setInterval(tick, 60000)

		return () => {
			clearInterval(timer)
		}
	})

	let chartUpdated = true
	let seasonsUpdated = true

	void tick()

	async function tick() {
		// TODO: Somente se a aba estiver visivel.
		// O SkyAtlasMolecule poderia emitir um evento quando a aba for alterada
		// quando isso acontecer, atualizar somente se passou de 1 minuto desde a última atualização
		// ou se a data mudou (meio-dia, meio-mês, meio-ano)
		updateTime()

		void updateSeasons()
		await updatePosition()
		await updateChart()
	}

	function updateTime(time: number = Date.now()) {
		request.time.utc = time
		// TODO: verificar se a data passou ou não do meio-dia/mes/ano e atualizar chart/positions/seasons
	}

	async function updatePosition() {
		const position = await Api.SkyAtlas.positionOfSun(state.request)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart() {
		if (chartUpdated) {
			const chart = await Api.SkyAtlas.chartOfSun(state.request)
			if (chart) state.chart = chart
			chartUpdated = false
		}
	}

	async function updateSeasons() {
		if (seasonsUpdated) {
			const seasons = await Api.SkyAtlas.seasons(state.request)
			if (seasons) Object.assign(state.seasons, seasons)
			seasonsUpdated = false
		}
	}

	return { state }
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
		})

	moonState = state

	onMount(() => {
		const timer = setInterval(tick, 60000)

		return () => {
			clearInterval(timer)
		}
	})

	let chartUpdated = true
	let phasesUpdated = true

	void tick()

	async function tick() {
		updateTime()
		void updatePhases()

		await updatePosition()
		await updateChart()
	}

	function updateTime(time: number = Date.now()) {
		request.time.utc = time
		// TODO: verificar se a data passou ou não do meio-dia/mes/ano e atualizar chart/positions/seasons
	}

	async function updatePosition() {
		const position = await Api.SkyAtlas.positionOfMoon(state.request)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart() {
		if (chartUpdated) {
			const chart = await Api.SkyAtlas.chartOfMoon(state.request)
			if (chart) state.chart = chart
			chartUpdated = false
		}
	}

	async function updatePhases() {
		if (phasesUpdated) {
			const phases = await Api.SkyAtlas.moonPhases(state.request)
			if (phases) state.phases = phases
			phasesUpdated = false
		}
	}

	return { state }
})

export const GalaxyMolecule = molecule(() => {
	const request = storage.get<SkyObjectSearch>('skyatlas.galaxy.request', () => structuredClone(DEFAULT_SKY_OBJECT_SEARCH))

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

	let chartShouldBeUpdated = true

	onMount(() => {
		const unsubscriber = subscribe(state.request, () => {
			storage.set('skyatlas.galaxy.request', state.request)
		})

		const timer = setInterval(tick, 60000)

		return () => {
			unsubscriber()
			clearInterval(timer)
		}
	})

	if (state.request.visible) tick()
	else void search()

	function update<K extends keyof SkyObjectSearch>(key: K, value: SkyObjectSearch[K]) {
		state.request[key] = value

		// Search again if page or sort has been changed
		if (key === 'page' || key === 'sort') void search(false)
	}

	async function search(reset: boolean = true) {
		try {
			state.loading = true

			// TODO: Call update time and location on SkyAtlasMolecule
			updateTime()
			request.location.longitude = deg(-45)
			request.location.latitude = deg(-22)

			if (reset) state.request.page = 1

			const result = await Api.SkyAtlas.searchSkyObject(state.request)
			state.result = result ?? []
		} finally {
			state.loading = false
		}
	}

	async function select(id: number, force: boolean = false) {
		const selected = state.result.find((dso) => dso.id === id)

		// Fetches object's position and chart if a new one was selected
		if (selected && (force || state.selected?.id !== selected.id)) {
			state.selected = selected

			// TODO: Call update time and location on SkyAtlasMolecule
			updateTime()
			request.location.longitude = deg(-45)
			request.location.latitude = deg(-22)

			await updatePosition()
			await updateChart(true)
		}
	}

	function updateTime(time: number = Date.now()) {
		request.time.utc = time
	}

	async function updatePosition() {
		const id = state.selected!.id
		const position = await Api.SkyAtlas.positionOfSkyObject(state.request, id)
		if (position) Object.assign(state.position, position)
	}

	async function updateChart(force: boolean = false) {
		if (force || chartShouldBeUpdated) {
			const id = state.selected!.id
			const chart = await Api.SkyAtlas.chartOfSkyObject(state.request, id)
			if (chart) state.chart = chart
			chartShouldBeUpdated = false
		}
	}

	function tick() {
		// Refresh visible objects above horizon
		if (state.request.visible) {
			void search(false)
		}

		// Refresh selected object
		if (state.selected) {
			void select(state.selected.id, true)
		}
	}

	return { state, update, search, select, tick }
})

export const SkyAtlasMolecule = molecule((m) => {
	const sun = m(SunMolecule)
	const moon = m(MoonMolecule)
	const galaxy = m(GalaxyMolecule)

	const state =
		skyAtlasState ??
		proxy<SkyAtlasState>({
			show: false,
			tab: 'sun',
			twilight: undefined,
			request: {
				location: {
					longitude: 0,
					latitude: 0,
					elevation: 0,
				},
				time: {
					utc: Date.now(),
					offset: 0,
				},
			},
			sun: sun.state,
			moon: moon.state,
			planet: moon.state,
			asteroid: moon.state,
			galaxy: galaxy.state,
			satellite: galaxy.state,
		})

	skyAtlasState = state

	void twilight()

	async function twilight() {
		state.twilight = await Api.SkyAtlas.twilight(state.request)
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

	function slewTo(mount?: Mount) {
		if (!mount) return undefined
		const position = state[state.tab].position
		return Api.Mounts.slewTo(mount, { type: 'JNOW', ...position })
	}

	function frame() {
		const position = state[state.tab].position

		const request: Partial<Framing> = {
			rightAscension: formatRA(position.rightAscension),
			declination: formatDEC(position.declination),
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

	return { state, syncTo, goTo, slewTo, frame, show, hide }
})
