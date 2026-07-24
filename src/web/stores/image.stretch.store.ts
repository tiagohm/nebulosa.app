import { imageBus } from '@shared/bus'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { SliderRangeValue } from '@ui/components/Slider'
import type { SigmaClipCenterMethod, SigmaClipDispersionMethod } from 'nebulosa/src/imaging/processing/computation'
import { unsubscribe } from 'src/shared/util'
import { DEFAULT_IMAGE_STRETCH } from 'src/types/image.stretch'
import type { ImageStretch } from 'src/types/image.stretch'
import { proxy } from 'valtio'

export type ImageStretchStore = ReturnType<typeof imageStretchStore>

export interface ImageStretchState {
	readonly stretch: ImageStretch
}

export function imageStretchStore(viewer: ImageViewerStore) {
	const state = proxy<ImageStretchState>({
		stretch: viewer.state.transformation.stretch,
	})

	console.info('image stretch created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return unmount

		console.info('image stretch mounted:', viewer.state.path)

		mounted = true

		u[0] = imageBus.subscribe('load', ({ image, info }) => {
			if (image === viewer.image) {
				state.stretch.auto = info.transformation.stretch.auto
				state.stretch.shadow = info.transformation.stretch.shadow
				state.stretch.highlight = info.transformation.stretch.highlight
				state.stretch.midtone = info.transformation.stretch.midtone
			}
		})

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image stretch unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function setMidtone(value: number) {
		state.stretch.midtone = value
	}

	function setBits(value: number) {
		state.stretch.bits = value
	}

	function setMeanBackground(value: number) {
		state.stretch.meanBackground = value
	}

	function setClippingPoint(value: number) {
		state.stretch.clippingPoint = value
	}

	function setSigmaClip(value: boolean) {
		state.stretch.sigmaClip = value
	}

	function setSigmaLower(value: number) {
		state.stretch.sigmaLower = value
	}

	function setSigmaUpper(value: number) {
		state.stretch.sigmaUpper = value
	}

	function setCenterMethod(value: SigmaClipCenterMethod) {
		state.stretch.centerMethod = value
	}

	function setDispersionMethod(value: SigmaClipDispersionMethod) {
		state.stretch.dispersionMethod = value
	}

	function setShadow(value: number) {
		state.stretch.shadow = value
	}

	function setHighlight(value: number) {
		state.stretch.highlight = value
	}

	function handleShadowChange(value: number) {
		setShadow(value)
		if (value > state.stretch.highlight) setHighlight(value)
	}

	function handleHighlightChange(value: number) {
		setHighlight(value)
		if (value < state.stretch.shadow) setShadow(value)
	}

	function handleShadowHighlightChange(value: SliderRangeValue) {
		setShadow(value[0])
		setHighlight(value[1])
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

	return {
		state,
		viewer,
		mount,
		unmount,
		setMidtone,
		setBits,
		setMeanBackground,
		setClippingPoint,
		setSigmaClip,
		setSigmaLower,
		setSigmaUpper,
		setCenterMethod,
		setDispersionMethod,
		setShadow,
		setHighlight,
		handleShadowChange,
		handleHighlightChange,
		handleShadowHighlightChange,
		auto,
		reset,
		toggle,
		apply,
	} as const
}
