import { nanoid } from 'nanoid'
import type { Camera } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { CameraFrameEvent } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '../shared/proxy'
import type { Image, ImageSource } from '../shared/types'
import { equipmentStore } from './equipment.store'
import type { ImageViewerStore } from './image.viewer.store'

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

initProxy(state.picker, 'workspace.picker', ['p:path'])

bus.subscribe<CameraFrameEvent>('camera:frame', (event) => {
	if (event.path) {
		const camera = equipmentStore.get('camera', event.camera)
		camera && add(event.path, camera)
	}
})

const viewers = new Map<string, ImageViewerStore>()

function link(image: Image, viewer: ImageViewerStore) {
	viewers.set(image.id, viewer)
}

function unlink(image: Image) {
	viewers.delete(image.id)
}

function add(path: string, source: ImageSource | Camera, id?: string) {
	const camera = typeof source === 'object' ? source : undefined
	source = typeof source === 'string' ? source : 'camera'
	const position = state.images.length === 0 ? 0 : Math.max(...state.images.map((e) => e.position)) + 1
	id = `${source}-${id || camera?.id || nanoid()}`
	const index = state.images.findIndex((e) => e.id === id)

	let image: Image

	if (index >= 0) {
		image = state.images[index]
		void viewers.get(image.id)?.load(path)
		bus.emit('update', image)
	} else {
		image = { path, id, position, source, camera }
		state.images.push(image)
		bus.emit('add', image)
	}

	if (source === 'file') {
		state.picker.path = path
	}

	return image
}

function remove(image: Image) {
	const index = state.images.findIndex((e) => e.id === image.id)

	if (index >= 0) {
		state.images.splice(index, 1)
		viewers.delete(image.id)
		bus.emit('remove', image)
	}
}

function choose(paths: string[] = []) {
	if (paths.length > 0) {
		for (const path of paths) {
			add(path, 'file')
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
