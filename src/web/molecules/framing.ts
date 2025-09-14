import { molecule, onMount } from 'bunshi'
import type { HipsSurvey } from 'nebulosa/src/hips2fits'
import bus from 'src/shared/bus'
import { DEFAULT_FRAMING, type Framing } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import type { Image } from '@/shared/types'
import { ImageWorkspaceMolecule } from './image/workspace'

export interface FramingState {
	show: boolean
	readonly request: Framing
	hipsSurveys: HipsSurvey[]
	loading: boolean
	openNewImage: boolean
	readonly images: Image[]
}

export const FramingMolecule = molecule((m) => {
	const workspace = m(ImageWorkspaceMolecule)

	const request = simpleLocalStorage.get('framing', () => structuredClone(DEFAULT_FRAMING))

	const state = proxy<FramingState>({
		show: false,
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
			state.show = true
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

	function update<K extends keyof FramingState['request']>(key: K, value: FramingState['request'][K]) {
		state.request[key] = value
	}

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

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, update, load, show, hide } as const
})
