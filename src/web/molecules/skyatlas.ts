import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { type BodyPosition, DEFAULT_BODY_POSITION, DEFAULT_POSITION_OF_BODY, DEFAULT_SKY_OBJECT_SEARCH, type LocationAndTime, type PositionOfBody, type SkyObjectSearch, type SkyObjectSearchItem, type SolarImageSource, type SolarSeasons, type Twilight } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { deg } from 'nebulosa/src/angle'

export interface SkyAtlasState {
	show: boolean
	tab: 'sun' | 'moon' | 'planets' | 'asteroids' | 'galaxies' | 'satellites'
	twilight?: Twilight
	readonly request: LocationAndTime
}

export interface SunState {
	readonly request: PositionOfBody
	source: SolarImageSource
	readonly position: BodyPosition
	chart: number[]
	readonly seasons: SolarSeasons
}

export interface MoonState {
	readonly position: BodyPosition
	readonly chart: number[]
}

export interface GalaxyState {
	loading: boolean
	readonly request: SkyObjectSearch
	result: SkyObjectSearchItem[]
	selected?: SkyObjectSearchItem
	readonly position: BodyPosition
	chart: number[]
}

let skyAtlasState: SkyAtlasState | undefined
let sunState: SunState | undefined
let galaxyState: GalaxyState | undefined

export const SunMolecule = molecule(() => {
	const request = structuredClone(DEFAULT_POSITION_OF_BODY)

	const state =
		sunState ??
		proxy<SunState>({
			request,
			position: structuredClone(DEFAULT_BODY_POSITION),
			chart: [],
			source: simpleLocalStorage.get<SolarImageSource>('skyatlas.sun.source', () => 'HMI_INTENSITYGRAM_FLATTENED'),
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
			simpleLocalStorage.set('skyatlas.sun.source', state.source)
		})

		const timer = setInterval(tick, 60000)

		return () => {
			clearInterval(timer)
		}
	})

	let chartUpdateRequested = true
	let seasonsUpdateRequested = true

	void tick()

	async function tick() {
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
		if (chartUpdateRequested) {
			const chart = await Api.SkyAtlas.chartOfSun(state.request)
			if (chart) state.chart = chart
			chartUpdateRequested = false
		}
	}

	async function updateSeasons() {
		if (seasonsUpdateRequested) {
			const seasons = await Api.SkyAtlas.seasons(state.request)
			if (seasons) Object.assign(state.seasons, seasons)
			seasonsUpdateRequested = false
		}
	}

	return { state }
})

export const GalaxyMolecule = molecule(() => {
	const request = simpleLocalStorage.get<SkyObjectSearch>('skyatlas.galaxy.request', () => structuredClone(DEFAULT_SKY_OBJECT_SEARCH))

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
			simpleLocalStorage.set('skyatlas.galaxy.request', state.request)
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

export const SkyAtlasMolecule = molecule(() => {
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
		})

	skyAtlasState = state

	void twilight()

	async function twilight() {
		state.twilight = await Api.SkyAtlas.twilight(state.request)
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, show, hide }
})
