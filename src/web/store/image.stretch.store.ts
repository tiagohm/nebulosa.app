import bus from 'src/shared/bus'
import { DEFAULT_IMAGE_STRETCH, type ImageStretch } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { initProxy } from '../shared/proxy'
import type { ImageLoaded } from '../shared/types'
import type { SliderRangeValue } from '../ui/components/Slider'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageStretchStore = ReturnType<typeof imageStretchStore>

export interface ImageStretchState {
	show: boolean
	readonly stretch: ImageStretch
}

export function imageStretchStore(viewer: ImageViewerStore) {
	const state = proxy<ImageStretchState>({
		show: false,
		stretch: viewer.state.transformation.stretch,
	})

	console.info('image stretch created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image stretch mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.stretch`, ['p:show'])

		u[1] = bus.subscribe<ImageLoaded>('image:load', ({ image, info }) => {
			if (image === viewer.image) {
				state.stretch.auto = info.transformation.stretch.auto
				state.stretch.shadow = info.transformation.stretch.shadow
				state.stretch.highlight = info.transformation.stretch.highlight
				state.stretch.midtone = info.transformation.stretch.midtone
			}
		})
	}

	function unmount() {
		if (!mounted) return
		console.info('image stretch unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof ImageStretch>(key: K, value: ImageStretch[K]) {
		state.stretch[key] = value
	}

	function handleShadowChange(value: number) {
		update('shadow', value)
		if (value > state.stretch.highlight) update('highlight', value)
	}

	function handleHighlightChange(value: number) {
		update('highlight', value)
		if (value < state.stretch.shadow) update('shadow', value)
	}

	function handleShadowHighlightChange(value: SliderRangeValue) {
		update('shadow', value[0])
		update('highlight', value[1])
	}

	function auto() {
		state.stretch.auto = true
		return load()
	}

	function reset() {
		Object.assign(state.stretch, DEFAULT_IMAGE_STRETCH)
		return apply()
	}

	function toggle() {
		if (state.stretch.auto) {
			return reset()
		} else {
			return auto()
		}
	}

	function apply() {
		state.stretch.auto = false
		return load()
	}

	function load() {
		return viewer.reload()
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		handleShadowChange,
		handleHighlightChange,
		handleShadowHighlightChange,
		auto,
		reset,
		toggle,
		apply,
		show,
		hide,
	} as const
}
