import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { Writable } from 'nebulosa/src/core/types'
import type { FFTFilterType } from 'nebulosa/src/imaging/processing/fft'
import { DEFAULT_IMAGE_FFT, DEFAULT_IMAGE_FILTER } from 'src/shared/types'
import type { ImageFFT, ImageFilter, ImageKernelFilterType } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type ImageFilterStore = ReturnType<typeof imageFilterStore>

export interface ImageFilterState {
	kernel: ImageFilter
	fft: Writable<ImageFFT>
}

export function imageFilterStore(viewer: ImageViewerStore) {
	const state = proxy<ImageFilterState>({
		kernel: viewer.state.transformation.filter,
		fft: viewer.state.transformation.fft,
	})

	console.info('image filter created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return unmount

		console.info('image filter mounted:', viewer.state.path)

		mounted = true

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image filter unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function updateKernelType(type: ImageKernelFilterType) {
		state.kernel.type = type
	}

	function updateKernel<T extends Exclude<ImageFilter['type'], 'sharpen'>, K extends keyof ImageFilter[T]>(type: T, key: K, value: ImageFilter[T][K]) {
		state.kernel[type][key] = value
	}

	function setFFTType(value: FFTFilterType) {
		state.fft.type = value
	}

	function setFFTCutoff(value: number) {
		state.fft.cutoff = value
	}

	function setFFTWeight(value: number) {
		state.fft.weight = value
	}

	function reset() {
		Object.assign(state.kernel.blur, DEFAULT_IMAGE_FILTER.blur)
		Object.assign(state.kernel.mean, DEFAULT_IMAGE_FILTER.mean)
		Object.assign(state.kernel.gaussianBlur, DEFAULT_IMAGE_FILTER.gaussianBlur)
		Object.assign(state.fft, DEFAULT_IMAGE_FFT)
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
		updateKernelType,
		updateKernel,
		setFFTType,
		setFFTCutoff,
		setFFTWeight,
		reset,
		apply,
	} as const
}
