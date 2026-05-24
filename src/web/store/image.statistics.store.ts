import bus from 'src/shared/bus'
import type { ImageHistogram, StatisticImage } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref, subscribe } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { ImageLoaded } from '../shared/types'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageStatisticsStore = ReturnType<typeof imageStatisticsStore>

export interface ImageStatisticsState {
	show: boolean
	selected: number
	readonly request: Pick<StatisticImage, 'bits' | 'area' | 'transformed'>
	histogram: readonly ImageHistogram[]
}

export function imageStatisticsStore(viewer: ImageViewerStore) {
	const state = proxy<ImageStatisticsState>({
		show: false,
		selected: 0,
		request: {
			bits: 16,
			transformed: true,
		},
		histogram: [],
	})

	console.info('image statistics created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image statistics mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.statistics`, ['p:show', 'o:request'])
		u[1] = bus.subscribe<ImageLoaded>('image:load', compute)
		u[2] = subscribe(state.request, compute)

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

	function update<K extends keyof ImageStatisticsState['request']>(key: K, value: ImageStatisticsState['request'][K]) {
		state.request[key] = value
	}

	async function compute() {
		const histogram = await Api.Image.statistics({ path: viewer.state.path, transformation: viewer.state.transformation, camera: viewer.image.camera?.id, ...state.request })
		if (histogram) state.histogram = ref(histogram)
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
