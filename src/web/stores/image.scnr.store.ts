import { DEFAULT_IMAGE_SCNR, type ImageScnr } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageScnrStore = ReturnType<typeof imageScnrStore>

export interface ImageScnrState {
	readonly scnr: ImageScnr
}

export function imageScnrStore(viewer: ImageViewerStore) {
	const state = proxy<ImageScnrState>({
		scnr: viewer.state.transformation.scnr,
	})

	console.info('image scnr created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image scnr mounted:', viewer.state.path)

		mounted = true

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image scnr unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof ImageScnr>(key: K, value: ImageScnr[K]) {
		state.scnr[key] = value
	}

	function reset() {
		Object.assign(state.scnr, DEFAULT_IMAGE_SCNR)
		return apply()
	}

	function apply() {
		return viewer.reload()
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		reset,
		apply,
	} as const
}
