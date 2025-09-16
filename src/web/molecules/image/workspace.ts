import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import type { Atom, Camera, CameraCaptureEvent } from 'src/shared/types'
import { proxy } from 'valtio'
import { simpleLocalStorage } from '@/shared/storage'
import type { Image } from '@/shared/types'
import { EquipmentMolecule } from '../indi/equipment'
import type { ImageViewerMolecule } from './viewer'

export interface ImageWorkspaceState {
	readonly images: Image[]
	initialPath: string
	showModal: boolean
	selected?: Image
}

const KEY_INVALID_CHAR_REGEX = /[\W]+/g

export const ImageWorkspaceMolecule = molecule((m) => {
	const equipment = m(EquipmentMolecule)

	const viewers = new Map<string, Atom<typeof ImageViewerMolecule>>()

	const state = proxy<ImageWorkspaceState>({
		images: [],
		showModal: false,
		initialPath: simpleLocalStorage.get('image.path', ''),
	})

	onMount(() => {
		const unsubscriber = bus.subscribe<CameraCaptureEvent>('camera:capture', (event) => {
			if (event.savedPath) {
				const camera = equipment.get('CAMERA', event.device) as Camera
				const image = add(event.savedPath, event.device, camera)
			}
		})
	})

	function link(image: Image, viewer: Atom<typeof ImageViewerMolecule>) {
		viewers.set(image.key, viewer)
	}

	function add(path: string, key: string | undefined | null, source: Image['source'] | Camera) {
		const camera = typeof source === 'object' ? source : undefined
		source = typeof source === 'string' ? source : 'camera'

		const position = state.images.length === 0 ? 0 : Math.max(...state.images.map((e) => e.position)) + 1
		key = key?.replace(KEY_INVALID_CHAR_REGEX, '-') || `${Date.now()}-${position}`
		key = `${source}-${key}`

		const index = state.images.findIndex((e) => e.key === key)
		let image: Image

		if (index >= 0) {
			state.images[index].path = path
			image = state.images[index]
			viewers.get(image.key)?.load(true, path)
			bus.emit('image:update', image)
		} else {
			image = { path, key, position, source, camera }
			state.images.push(image)
			bus.emit('image:add', image)
		}

		if (source === 'file') {
			state.initialPath = path
			simpleLocalStorage.set('image.path', path)
		}

		return image
	}

	function remove(image: Image) {
		const index = state.images.findIndex((e) => e.key === image.key)

		if (index >= 0) {
			state.images.splice(index, 1)
			viewers.delete(image.key)
			bus.emit('image:remove', image)
		}
	}

	return { state, link, add, remove }
})
