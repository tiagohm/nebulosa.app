import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { type BodyPosition, DEFAULT_BODY_POSITION, DEFAULT_SKY_OBJECT_SEARCH, type LocationAndTime, type SkyObjectSearch, type SkyObjectSearchItem, type Twilight } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'

export interface SkyAtlasState {
	show: boolean
	tab: 'sun' | 'moon' | 'planets' | 'asteroids' | 'dsos' | 'satellites'
	twilight?: Twilight
	readonly request: LocationAndTime
}

export interface DeepSkyObjectState {
	loading: boolean
	readonly request: SkyObjectSearch
	result: SkyObjectSearchItem[]
	selected?: SkyObjectSearchItem
	readonly position: BodyPosition
	chart: number[]
}

let skyAtlasDeepSkyObjectState: DeepSkyObjectState | undefined

export const DeepSkyObjectMolecule = molecule(() => {
	const request = simpleLocalStorage.get<SkyObjectSearch>('skyAtlas.dsos.request', () => structuredClone(DEFAULT_SKY_OBJECT_SEARCH))

	request.page = 1

	const state =
		skyAtlasDeepSkyObjectState ??
		proxy<DeepSkyObjectState>({
			loading: false,
			request,
			result: [],
			position: structuredClone(DEFAULT_BODY_POSITION),
			chart: [],
		})

	skyAtlasDeepSkyObjectState = state

	onMount(() => {
		const unsubscriber = subscribe(state.request, () => simpleLocalStorage.set('skyAtlas.dsos.request', state.request))

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
		if (key === 'page' || key === 'sort') void search(false)
	}

	async function search(reset: boolean = true) {
		try {
			state.loading = true
			request.time.utc = Date.now()
			request.location.longitude = -45
			request.location.latitude = -22

			if (reset) state.request.page = 1

			const result = await Api.SkyAtlas.skyObjectSearch(state.request)
			state.result = result ?? []
		} finally {
			state.loading = false
		}
	}

	async function select(id: number, force: boolean = false) {
		const selected = state.result.find((dso) => dso.id === id)

		if (selected && (force || state.selected?.id !== selected.id)) {
			state.selected = selected

			request.time.utc = Date.now()
			request.location.longitude = -45
			request.location.latitude = -22

			const position = await Api.SkyAtlas.skyObjectPosition(state.request, id)
			if (position) Object.assign(state.position, position)

			const chart = await Api.SkyAtlas.skyObjectChart(state.request, id)
			if (chart) state.chart = chart
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

	return { state, update, search, select }
})

let skyAtlasState: SkyAtlasState | undefined

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

	function close() {
		state.show = false
	}

	return { state, show, close }
})
