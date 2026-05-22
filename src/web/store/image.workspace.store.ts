import type { Camera } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { CameraCaptureEvent } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '../shared/proxy'
import type { Image } from '../shared/types'
import { equipmentStore } from './equipment.store'

export type ImageWorkspaceStore = typeof imageWorkspaceStore

export type ImageWorkspaceEventType = 'add' | 'remove' | 'update'

export interface ImageWorkspaceState {
	readonly images: Image[]
	selected?: Image
	readonly picker: {
		show: boolean
		path: string
	}
}

const state = proxy<ImageWorkspaceState>({
	images: [],
	picker: {
		show: false,
		path: '',
	},
})

initProxy(state.picker, 'workspace.picker', ['p:show', 'p:path'])

bus.subscribe<CameraCaptureEvent>('camera:capture', (event) => {
	if (event.savedPath) {
		const camera = equipmentStore.get('camera', event.camera)
		add(event.savedPath, event.camera, camera!)
	}
})

const viewers = new Map<string, unknown>()

function link(image: Image, viewer: unknown) {
	viewers.set(image.key, viewer)
}

function unlink(image: Image) {
	viewers.delete(image.key)
}

function add(path: string, key: string | undefined | null, source: Image['source'] | Camera) {
	source = typeof source === 'string' ? source : 'camera'

	const position = state.images.length === 0 ? 0 : Math.max(...state.images.map((e) => e.position)) + 1
	key ||= `${Date.now()}-${position}`
	key = `${source}-${key}`

	const index = state.images.findIndex((e) => e.key === key)
	let image: Image

	if (index >= 0) {
		image = state.images[index]
		// @ts-expect-error TODO: implement imageViewerStore
		// oxlint-disable-next-line typescript/no-unsafe-call
		void viewers.get(image.key)?.load(true, path)
		bus.emit('update', image)
	} else {
		const camera = typeof source === 'object' ? source : undefined
		image = { path, key, position, source, camera }
		state.images.push(image)
		bus.emit('add', image)
	}

	if (source === 'file') {
		state.picker.path = path
	}

	return image
}

function remove(image: Image) {
	const index = state.images.findIndex((e) => e.key === image.key)

	if (index >= 0) {
		state.images.splice(index, 1)
		viewers.delete(image.key)
		bus.emit('remove', image)
	}
}

function choose(paths: string[] = []) {
	if (paths.length > 0) {
		for (const path of paths) {
			add(path, undefined, 'file')
		}
	}

	hidePicker()
}

function showPicker() {
	state.picker.show = true
}

function hidePicker() {
	state.picker.show = false
}

export const imageWorkspaceStore = {
	state,
	link,
	unlink,
	add,
	remove,
	choose,
	showPicker,
	hidePicker,
} as const
