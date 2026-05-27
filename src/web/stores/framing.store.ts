import { nanoid } from 'nanoid'
import { DEFAULT_FRAMING, type Framing } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { imageWorkspaceStore } from './image.workspace.store'

export type FramingStore = typeof framingStore

export interface FramingState {
	show: boolean
	readonly request: Framing
	loading: boolean
	openNewImage: boolean
	// images: Image[]
	count: number
}

const state = proxy<FramingState>({
	show: false,
	request: structuredClone(DEFAULT_FRAMING),
	loading: false,
	openNewImage: false,
	// images: [],
	count: 0,
})

const ID = nanoid()

initProxy(state, 'framing', ['p:show', 'o:request', 'p:openNewImage'])

function update<K extends keyof FramingState['request']>(key: K, value: FramingState['request'][K]) {
	state.request[key] = value
}

async function load(request: Partial<Framing> = state.request) {
	Object.assign(state.request, request)

	try {
		state.loading = true
		state.show = true

		request.id = `${ID}.${state.openNewImage ? state.count++ : DEFAULT_FRAMING.id}`
		const frame = await Api.Framing.frame(state.request)

		if (frame) {
			const image = imageWorkspaceStore.add(frame.path, 'framing', request.id)
			// const index = state.images.findIndex((e) => e.id === image.id)
			// index >= 0 ? (state.images[index] = image) : state.images.push(image)
		}
	} finally {
		state.loading = false
	}
}

function show() {
	state.show = true
}

function hide() {
	state.show = false
}

export const framingStore = {
	state,
	update,
	load,
	show,
	hide,
} as const
