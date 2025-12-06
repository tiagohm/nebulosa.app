import { molecule, onMount, use } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import { DEFAULT_FRAMING, type Framing } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import type { Image } from '@/shared/types'
import { ImageWorkspaceMolecule } from './image/workspace'

export interface FramingState {
	show: boolean
	readonly request: Framing
	loading: boolean
	openNewImage: boolean
	images: Image[]
}

const state = proxy<FramingState>({
	show: false,
	request: structuredClone(DEFAULT_FRAMING),
	loading: false,
	openNewImage: false,
	images: [],
})

initProxy(state, 'framing', ['p:show', 'o:request', 'p:openNewImage'])

export const FramingMolecule = molecule(() => {
	const workspace = use(ImageWorkspaceMolecule)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<Partial<Framing>>('framing:load', (request) => {
			Object.assign(state.request, request)
			state.show = true
			void load()
		})

		unsubscribers[1] = bus.subscribe<Image>('image:remove', (image) => {
			const index = state.images.findIndex((e) => e.key === image.key)
			index >= 0 && state.images.splice(index, 1)
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

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
