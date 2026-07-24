import { initProxy } from '@shared/proxy'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { CfaPattern } from 'nebulosa/src/imaging/model/types'
import { unsubscribe } from 'src/shared/util'
import type { ImageTransformation } from 'src/types/image'
import { proxy } from 'valtio'

export type ImageDebayerStore = ReturnType<typeof imageDebayerStore>

export interface ImageDebayerState {
	enabled: boolean
	transformation: ImageTransformation
}

export function imageDebayerStore(viewer: ImageViewerStore) {
	const state = proxy<ImageDebayerState>({
		enabled: false,
		transformation: viewer.state.transformation,
	})

	console.info('image debayer created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return unmount

		console.info('image debayer mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.debayer`, ['p:enabled'])

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image debayer unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function setEnabled(value: boolean) {
		state.enabled = value
	}

	function setCfaPattern(value: CfaPattern | 'AUTO') {
		state.transformation.cfaPattern = value
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		setEnabled,
		setCfaPattern,
	} as const
}
