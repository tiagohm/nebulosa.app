import { Api } from '@shared/api'
import { imageBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { Writable } from 'nebulosa/src/core/types'
import { unsubscribe } from 'src/shared/util'
import type { ImageHistogram, StatisticImage } from 'src/types/image.statistics'
import { proxy, ref, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'

export type ImageStatisticsStore = ReturnType<typeof imageStatisticsStore>

export interface ImageStatisticsState {
	selected: number
	roi: boolean
	readonly request: Writable<Pick<StatisticImage, 'bits' | 'area' | 'transformed'>>
	histogram: readonly ImageHistogram[]
}

export function imageStatisticsStore(viewer: ImageViewerStore) {
	const state = proxy<ImageStatisticsState>({
		selected: 0,
		roi: false,
		request: {
			bits: 16,
			transformed: true,
		},
		histogram: [],
	})

	console.info('image statistics created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false
	let computeTimer: number | undefined

	function mount() {
		if (mounted) return unmount

		console.info('image statistics mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.statistics`, ['o:request', 'p:roi'])
		u[1] = imageBus.subscribe('load', compute)
		u[2] = subscribe(state.request, compute)
		u[3] = subscribeKey(state, 'roi', compute)
		u[4] = subscribeKey(viewer.roi.state, 'enabled', compute)
		u[5] = subscribe(viewer.roi.state.roi, () => state.roi && computeDebounced())

		if (state.histogram.length === 0) {
			void compute()
		}

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image statistics unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function isRoiEnabled() {
		return state.roi && viewer.roi.state.enabled
	}

	function setTransformed(value: boolean) {
		state.request.transformed = value
	}

	function setRoi(value: boolean) {
		state.roi = value
	}

	async function compute() {
		const area = isRoiEnabled() ? viewer.roi.state.roi : undefined
		const histogram = await Api.Image.statistics({ path: viewer.state.path, transformation: viewer.state.transformation, camera: viewer.image.camera?.id, ...state.request, area })
		if (histogram) state.histogram = ref(histogram)
	}

	function computeDebounced() {
		if (computeTimer) {
			clearTimeout(computeTimer)
		}

		computeTimer = window.setTimeout(() => {
			void compute()
			computeTimer = undefined
		}, 500)
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		setTransformed,
		setRoi,
		compute,
	} as const
}
