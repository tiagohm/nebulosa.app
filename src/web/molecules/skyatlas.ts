import { molecule, onMount } from 'bunshi'
import { type BodyPosition, DEFAULT_BODY_POSITION, DEFAULT_SKY_OBJECT_SEARCH, type SkyObjectSearch, type SkyObjectSearchResult } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { HomeMolecule } from './home'

export interface SkyAtlasState {
	showModal: boolean
	tab: 'sun' | 'moon' | 'planets' | 'minor-planets' | 'dsos' | 'satellites'
}

export interface DsoState {
	loading: boolean
	readonly request: SkyObjectSearch
	result: SkyObjectSearchResult[]
	selected?: SkyObjectSearchResult
	readonly position: BodyPosition
}

let skyAtlasDeepSkyObjectState: DsoState | undefined

// Molecule that manages the Sky Atlas DSOs
export const SkyAtlasDeepSkyObjectMolecule = molecule(() => {
	const request = simpleLocalStorage.get<SkyObjectSearch>('skyAtlas.dsos.request', () => structuredClone(DEFAULT_SKY_OBJECT_SEARCH))

	request.page = 1

	const state =
		skyAtlasDeepSkyObjectState ??
		proxy<DsoState>({
			loading: false,
			request,
			result: [],
			position: structuredClone(DEFAULT_BODY_POSITION),
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

	// Updates the request state and triggers a search if necessary
	function update<K extends keyof SkyObjectSearch>(key: K, value: SkyObjectSearch[K]) {
		state.request[key] = value
		if (key === 'page' || key === 'sort') void search(false)
	}

	// Searches for DSOs based on the current request
	async function search(resetPage: boolean = true) {
		try {
			state.loading = true
			request.utcTime = Date.now()
			request.longitude = -45
			request.latitude = -22
			if (resetPage) state.request.page = 1
			const result = await Api.SkyAtlas.skyObjectSearch(state.request)
			state.result = result ?? []
		} finally {
			state.loading = false
		}
	}

	// Selects a DSO by its id and updates the position
	async function select(id: number, force: boolean = false) {
		const selected = state.result.find((dso) => dso.id === id)

		if (selected && (force || state.selected?.id !== selected.id)) {
			state.selected = selected

			request.utcTime = Date.now()
			request.longitude = -45
			request.latitude = -22
			const position = await Api.SkyAtlas.skyObjectPosition(state.request, id)

			if (position) {
				Object.assign(state.position, position)
			}
		}
	}

	// Handles the periodic updates
	function tick() {
		if (state.request.visible) {
			void search(false)
		}

		if (state.selected) {
			void select(state.selected.id, true)
		}
	}

	return { state, update, search, select }
})

let skyAtlasState: SkyAtlasState | undefined

// Molecule that manages the Sky Atlas
export const SkyAtlasMolecule = molecule((m) => {
	const home = m(HomeMolecule)
	const dsos = m(SkyAtlasDeepSkyObjectMolecule)

	const state =
		skyAtlasState ??
		proxy<SkyAtlasState>({
			showModal: false,
			tab: 'sun',
		})

	skyAtlasState = state

	// Shows the modal
	function show() {
		home.toggleMenu(false)
		state.showModal = true
	}

	// Closes the modal
	function close() {
		state.showModal = false
	}

	return { state, dsos, show, close }
})
