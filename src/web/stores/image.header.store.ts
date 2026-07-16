import type { ImageViewerStore } from '@stores/image.viewer.store'
import { unsubscribe } from 'src/shared/util'

export type ImageHeaderStore = ReturnType<typeof imageHeaderStore>

export function imageHeaderStore(viewer: ImageViewerStore) {
	console.info('image header created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image header mounted:', viewer.state.path)

		mounted = true

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image header unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	return {
		viewer,
		mount,
		unmount,
	} as const
}
