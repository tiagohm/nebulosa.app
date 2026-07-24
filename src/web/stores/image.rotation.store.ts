import { initProxy } from '@shared/proxy'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type ImageRotationStore = ReturnType<typeof imageRotationStore>

export interface ImageRotationState {
	angle: number // deg
}

export function imageRotationStore(viewer: ImageViewerStore) {
	const state = proxy<ImageRotationState>({
		angle: 0,
	})

	console.info('image rotation created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return unmount

		console.info('image rotation mounted:', viewer.state.path)

		u[0] = initProxy(state, `image.${viewer.key}.rotation`, ['p:angle'])

		apply()

		mounted = true

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image rotation unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function setAngle(value: number) {
		state.angle = value
		apply()
	}

	function rotateClockwise() {
		setAngle((state.angle + 90) % 360)
	}

	function rotateCounterclockwise() {
		setAngle((state.angle + 270) % 360)
	}

	function reset() {
		setAngle(0)
	}

	function apply() {
		viewer.rotateTo(state.angle)
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		setAngle,
		rotateClockwise,
		rotateCounterclockwise,
		reset,
	} as const
}
