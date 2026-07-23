import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { ImageChannel } from 'nebulosa/src/imaging/model/types'
import type { SCNRProtectionMethod } from 'nebulosa/src/imaging/processing/scnr'
import { DEFAULT_IMAGE_SCNR, type ImageScnr } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

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
		if (mounted) return unmount

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

	function setChannel(value: ImageChannel | undefined) {
		state.scnr.channel = value
	}

	function setMethod(value: SCNRProtectionMethod) {
		state.scnr.method = value
	}

	function setAmount(value: number) {
		state.scnr.amount = value
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
		setChannel,
		setMethod,
		setAmount,
		reset,
		apply,
	} as const
}
