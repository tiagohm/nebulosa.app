import { addToast } from '@heroui/react'
import { molecule, onMount } from 'bunshi'
import type { HipsSurvey } from 'nebulosa/src/hips2fits'
import { DEFAULT_FRAMING, type Framing } from 'src/api/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import type { Image } from '@/shared/types'
import { HomeMolecule } from './home'
import { ImageWorkspaceMolecule } from './image/workspace'

export interface FramingState {
	showModal: boolean
	readonly request: Framing
	hipsSurveys: HipsSurvey[]
	loading: boolean
	openNewImage: boolean
	readonly images: Image[]
}

// Molecule that manages the Framing modal
export const FramingMolecule = molecule((m) => {
	const home = m(HomeMolecule)
	const workspace = m(ImageWorkspaceMolecule)

	const request = simpleLocalStorage.get('framing', () => structuredClone(DEFAULT_FRAMING))

	const state = proxy<FramingState>({
		showModal: false,
		request,
		hipsSurveys: [],
		loading: false,
		openNewImage: request.id !== DEFAULT_FRAMING.id,
		images: [],
	})

	onMount(() => {
		const unsubscribe = subscribe(state.request, () => simpleLocalStorage.set('framing', state.request))

		return () => unsubscribe()
	})

	Api.Framing.hipsSurveys().then((hipsSurveys) => (state.hipsSurveys = hipsSurveys))

	// Updates the framing state
	function update<K extends keyof FramingState['request']>(key: K, value: FramingState['request'][K]) {
		state.request[key] = value
	}

	// Loads the framing image and opens it in the workspace
	async function load() {
		try {
			state.loading = true

			if (state.openNewImage) state.request.id = Date.now().toFixed(0)
			else state.request.id = DEFAULT_FRAMING.id

			const { path } = await Api.Framing.frame(state.request)
			const image = workspace.add(path, state.request.id, 'framing')

			const index = state.images.findIndex((e) => e.key === image.key)
			index >= 0 ? (state.images[index] = image) : state.images.push(image)
		} catch {
			addToast({ title: 'ERROR', description: 'Failed to load framing', color: 'danger' })
		} finally {
			state.loading = false
		}
	}

	// Shows the modal
	function show() {
		home.toggleMenu(false)
		state.showModal = true
	}

	// Closes the modal
	function close() {
		state.showModal = false
	}

	return { state, update, load, show, close }
})
