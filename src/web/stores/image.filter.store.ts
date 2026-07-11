import type { Writable } from 'nebulosa/src/core/types'
import type { FFTFilterType } from 'nebulosa/src/imaging/processing/fft'
import { DEFAULT_IMAGE_FFT, DEFAULT_IMAGE_FILTER, type ImageFFT, type ImageFilter, type ImageKernelFilterType } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import type { ImageViewerStore } from './image.viewer.store'

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
		if (mounted) return

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

	function updateFFTType(type: FFTFilterType) {
		state.fft.type = type
	}

	function updateFFT<K extends keyof ImageFFT>(key: K, value: ImageFFT[K]) {
		state.fft[key] = value
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
		updateFFTType,
		updateKernel,
		updateFFT,
		reset,
		apply,
	} as const
}
