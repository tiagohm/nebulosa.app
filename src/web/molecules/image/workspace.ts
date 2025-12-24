import { molecule, onMount, use } from 'bunshi'
import type { Camera } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { Atom, CameraCaptureEvent } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import type { Image } from '@/shared/types'
import { EquipmentMolecule } from '../indi/equipment'
import type { ImageViewerMolecule } from './viewer'

export interface ImageWorkspaceState {
	readonly images: Image[]
	selected?: Image
	readonly picker: {
		show: boolean
		path: string
	}
}

const KEY_INVALID_CHAR_REGEX = /[\W]+/g

const state = proxy<ImageWorkspaceState>({
	images: [],
	picker: {
		show: false,
		path: '',
	},
})

initProxy(state.picker, 'workspace.picker', ['p:show', 'p:path'])

const viewers = new Map<string, Atom<typeof ImageViewerMolecule>>()

export const ImageWorkspaceMolecule = molecule(() => {
	const equipment = use(EquipmentMolecule)

	onMount(() => {
		const unsubscriber = bus.subscribe<CameraCaptureEvent>('camera:capture', (event) => {
			if (event.savedPath) {
				const camera = equipment.get('CAMERA', event.device)
				add(event.savedPath, event.device, camera!)
			}
		})

		const beforeUnload = async () => {
			for (const image of state.images) {
				await Api.Image.close({ path: image.path })
			}
		}

		window.addEventListener('beforeunload', beforeUnload)

		return () => {
			window.removeEventListener('beforeunload', beforeUnload)
			unsubscriber()
		}
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
			image = state.images[index]
			viewers.get(image.key)?.load(true, path)
			bus.emit('image:update', image)
		} else {
			image = { path, key, position, source, camera }
			state.images.push(image)
			bus.emit('image:add', image)
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
			bus.emit('image:remove', image)

			void Api.Image.close({ path: image.path })
		}
	}

	function showPicker() {
		state.picker.show = true
	}

	function hidePicker() {
		state.picker.show = false
	}

	return { state, link, add, remove, showPicker, hidePicker } as const
})
