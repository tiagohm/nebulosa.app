import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { DEFAULT_FRAMING, type Framing } from 'src/shared/types'
import { Api } from '@/shared/api'
import { persistProxy } from '@/shared/persist'
import type { Image } from '@/shared/types'
import { ImageWorkspaceMolecule } from './image/workspace'

export interface FramingState {
	show: boolean
	readonly request: Framing
	loading: boolean
	openNewImage: boolean
}

const images: Image[] = []

const { state } = persistProxy<FramingState>('framing', () => ({
	show: false,
	request: structuredClone(DEFAULT_FRAMING),
	loading: false,
	openNewImage: false,
	images: [],
}))

export const FramingMolecule = molecule((m) => {
	const workspace = m(ImageWorkspaceMolecule)

	onMount(() => {
		const subscribers = new Array<VoidFunction>(2)

		subscribers[0] = bus.subscribe<Partial<Framing>>('framing:load', (request) => {
			Object.assign(state.request, request)
			state.show = true
			void load()
		})

		subscribers[1] = bus.subscribe<Image>('image:remove', (image) => {
			const index = images.findIndex((e) => e.key === image.key)
			index >= 0 && images.splice(index, 1)
		})

		return () => {
			subscribers.forEach((e) => e())
		}
	})

	function update<K extends keyof FramingState['request']>(key: K, value: FramingState['request'][K]) {
		state.request[key] = value
	}

	async function load() {
		try {
			state.loading = true
			state.request.id = state.openNewImage ? images.length : DEFAULT_FRAMING.id

			const frame = await Api.Framing.frame(state.request)

			if (frame) {
				const image = workspace.add(frame.path, state.request.id.toFixed(0), 'framing')
				const index = images.findIndex((e) => e.key === image.key)
				index >= 0 ? (images[index] = image) : images.push(image)
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
