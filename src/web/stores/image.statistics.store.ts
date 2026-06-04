import bus from 'src/shared/bus'
import type { ImageHistogram, StatisticImage } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { ImageLoaded } from '../shared/types'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageStatisticsStore = ReturnType<typeof imageStatisticsStore>

export interface ImageStatisticsState {
	show: boolean
	selected: number
	roi: boolean
	readonly request: Pick<StatisticImage, 'bits' | 'area' | 'transformed'>
	histogram: readonly ImageHistogram[]
}

export function imageStatisticsStore(viewer: ImageViewerStore) {
	const state = proxy<ImageStatisticsState>({
		show: false,
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
		if (mounted) return

		console.info('image statistics mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.statistics`, ['p:show', 'o:request', 'p:roi'])
		u[1] = bus.subscribe<ImageLoaded>('image:load', compute)
		u[2] = subscribe(state.request, compute)
		u[3] = subscribeKey(state, 'roi', compute)
		u[4] = subscribeKey(viewer.roi.state, 'visible', compute)
		u[5] = subscribe(viewer.roi.state.roi, () => state.roi && computeDebounced())
		u[6] = subscribeKey(state, 'show', compute)

		if (state.histogram.length === 0) {
			void compute()
		}
	}

	function unmount() {
		if (!mounted) return
		console.info('image statistics unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function isRoiEnabled() {
		return state.roi && viewer.roi.state.visible
	}

	function update<K extends keyof ImageStatisticsState['request']>(key: K, value: ImageStatisticsState['request'][K]) {
		state.request[key] = value
	}

	async function compute() {
		if (!state.show) return

		const area = isRoiEnabled() ? viewer.roi.state.roi : undefined
		const histogram = await Api.Image.statistics({ path: viewer.state.path, transformation: viewer.state.transformation, camera: viewer.image.camera?.id, ...state.request, area })
		if (histogram) state.histogram = ref(histogram)
	}

	function computeDebounced() {
		if (!state.show) return

		if (computeTimer) {
			clearTimeout(computeTimer)
		}

		computeTimer = window.setTimeout(() => {
			void compute()
			computeTimer = undefined
		}, 500)
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
		compute,
		show,
		hide,
	} as const
}
