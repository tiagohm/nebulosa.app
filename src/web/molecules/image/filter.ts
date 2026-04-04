import { molecule, onMount, use } from 'bunshi'
import type { FFTFilterType } from 'nebulosa/src/image.types'
import type { Writable } from 'nebulosa/src/types'
import { DEFAULT_IMAGE_FFT, DEFAULT_IMAGE_FILTER, type ImageFFT, type ImageFilter, type ImageKernelFilterType } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'
import { ImageViewerMolecule } from './viewer'

export interface ImageFilterState {
	show: boolean
	kernel: ImageFilter
	fft: Writable<ImageFFT>
}

const stateMap = new Map<string, ImageFilterState>()

export const ImageFilterMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageFilterState>({
			show: false,
			kernel: viewer.state.transformation.filter,
			fft: viewer.state.transformation.fft,
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `image.${viewer.storageKey}.filter`, ['p:show'])

		state.kernel = viewer.state.transformation.filter
		state.fft = viewer.state.transformation.fft

		return () => {
			unsubscriber()
		}
	})

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
		return viewer.load(true)
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return {
		state,
		scope: viewer.scope,
		viewer,
		updateKernelType,
		updateFFTType,
		updateKernel,
		updateFFT,
		reset,
		apply,
		show,
		hide,
	} as const
})
