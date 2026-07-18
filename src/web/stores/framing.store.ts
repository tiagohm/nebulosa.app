import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { homeStore } from '@stores/home.store'
import { nanoid } from 'nanoid'
import { DEFAULT_FRAMING, type Framing } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type FramingStore = typeof framingStore

export interface FramingState {
	readonly request: Framing
	loading: boolean
	openNewImage: boolean
	// images: Image[]
	count: number
}

const state = proxy<FramingState>({
	request: structuredClone(DEFAULT_FRAMING),
	loading: false,
	openNewImage: false,
	// images: [],
	count: 0,
})

const ID = nanoid()

let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return

	console.info('framing mounted')

	mounted = true

	u[0] = initProxy(state, 'framing', [])

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('framing unmounted')
	unsubscribe(u)
	mounted = false
}

function update<K extends keyof FramingState['request']>(key: K, value: FramingState['request'][K]) {
	state.request[key] = value
}

async function load(request: Partial<Framing> = state.request) {
	Object.assign(state.request, request)

	try {
		state.loading = true

		request.id = `${ID}.${state.openNewImage ? state.count++ : DEFAULT_FRAMING.id}`
		const frame = await Api.Framing.frame(state.request)

		if (frame) {
			const image = homeStore.addImage(frame.path, 'framing', request.id)
			// const index = state.images.findIndex((e) => e.id === image.id)
			// index >= 0 ? (state.images[index] = image) : state.images.push(image)
		}
	} finally {
		state.loading = false
	}
}

export const framingStore = {
	state,
	update,
	load,
	mount,
	unmount,
} as const
