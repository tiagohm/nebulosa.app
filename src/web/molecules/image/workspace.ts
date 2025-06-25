import { molecule } from 'bunshi'
import { proxy } from 'valtio'
import { simpleLocalStorage } from '@/shared/storage'
import type { Image } from '@/shared/types'

export interface ImageWorkspaceState {
	readonly images: Image[]
	lastPath: string
	showModal: boolean
	selected?: Image
}

// Molecule that manages all the images
export const ImageWorkspaceMolecule = molecule(() => {
	const state = proxy<ImageWorkspaceState>({
		images: [],
		showModal: false,
		lastPath: simpleLocalStorage.get('image.path', ''),
	})

	// Add an image to the workspace from a given path
	// It generates a unique key for the image and adds it to the state
	function add(path: string, key: string | undefined | null, type: 'file' | 'framing') {
		const position = state.images.length === 0 ? 0 : Math.max(...state.images.map((e) => e.position)) + 1
		key ||= `image-${Date.now()}-${position}`

		const index = state.images.findIndex((e) => e.key === key)

		if (index >= 0) {
			state.images[index].path = path
		} else {
			state.images.push({ path, key, position })
		}

		if (type === 'file') {
			state.lastPath = path
			simpleLocalStorage.set('image.path', path)
		}
	}

	// Removes an image from the workspace
	function remove(image: Image) {
		const index = state.images.findIndex((e) => e.key === image.key)
		index >= 0 && state.images.splice(index, 1)
	}

	return { state, add, remove }
})
