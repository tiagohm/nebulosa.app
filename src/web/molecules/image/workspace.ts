import { molecule } from 'bunshi'
import bus from 'src/shared/bus'
import type { Atom, Camera } from 'src/shared/types'
import { proxy } from 'valtio'
import { simpleLocalStorage } from '@/shared/storage'
import type { Image } from '@/shared/types'
import type { ImageViewerMolecule } from './viewer'

export interface ImageWorkspaceState {
	readonly images: Image[]
	lastPath: string
	showModal: boolean
	selected?: Image
}

const KEY_INVALID_CHAR_REGEX = /[\W]+/g

// Molecule that manages all the images
export const ImageWorkspaceMolecule = molecule((m) => {
	const viewers = new Map<string, Atom<typeof ImageViewerMolecule>>()

	const state = proxy<ImageWorkspaceState>({
		images: [],
		showModal: false,
		lastPath: simpleLocalStorage.get('image.path', ''),
	})

	function link(image: Image, viewer: Atom<typeof ImageViewerMolecule>) {
		viewers.set(image.key, viewer)
	}

	// Add an image to the workspace from a given path
	// It generates a unique key for the image and adds it to the state
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
			console.info('image updated', image, index)
		} else {
			image = { path, key, position, source, camera }
			state.images.push(image)
			console.info('image added', image)
			bus.emit('image:add', image)
		}

		if (source === 'file') {
			state.lastPath = path
			simpleLocalStorage.set('image.path', path)
		}

		return image
	}

	// Removes an image from the workspace
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
