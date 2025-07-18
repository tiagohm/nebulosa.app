import { molecule, onMount } from 'bunshi'
import type { HipsSurvey } from 'nebulosa/src/hips2fits'
import { BusMolecule } from 'src/shared/bus'
import { DEFAULT_FRAMING, type Framing } from 'src/shared/types'
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
	const bus = m(BusMolecule)
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
		const subscribers = new Array<VoidFunction>(3)

		subscribers[0] = subscribe(state.request, () => simpleLocalStorage.set('framing', state.request))

		subscribers[1] = bus.subscribe<Partial<Framing>>('framing:load', (request) => {
			Object.assign(state.request, request)
			state.showModal = true
			void load()
		})

		subscribers[2] = bus.subscribe<Image>('image:remove', (image) => {
			const index = state.images.findIndex((e) => e.key === image.key)
			index >= 0 && state.images.splice(index, 1)
		})

		return () => {
			subscribers.forEach((e) => e())
		}
	})

	Api.Framing.hipsSurveys().then((hipsSurveys) => (state.hipsSurveys = hipsSurveys ?? []))

	// Updates the framing state
	function update<K extends keyof FramingState['request']>(key: K, value: FramingState['request'][K]) {
		state.request[key] = value
	}

	// Loads the framing image and opens it in the workspace
	async function load() {
		try {
			state.loading = true
			state.request.id = state.openNewImage ? state.images.length : DEFAULT_FRAMING.id

			const frame = await Api.Framing.frame(state.request)

			if (frame) {
				const image = workspace.add(frame.path, state.request.id.toFixed(0), 'framing')
				const index = state.images.findIndex((e) => e.key === image.key)
				index >= 0 ? (state.images[index] = image) : state.images.push(image)
			}
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

	return { state, update, load, show, close } as const
})
