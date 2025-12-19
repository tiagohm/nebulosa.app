import { molecule, onMount, use } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import type { ImageHistogram, StatisticImage } from 'src/shared/types'
import { proxy, ref, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { type ImageLoaded, imageStorageKey } from '@/shared/types'
import { ImageViewerMolecule } from './viewer'

export interface ImageStatisticsState {
	show: boolean
	selected: number
	readonly request: Pick<StatisticImage, 'bits' | 'area' | 'transformed'>
	histogram: readonly ImageHistogram[]
}

const stateMap = new Map<string, ImageStatisticsState>()

export const ImageStatisticsMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageStatisticsState>({
			show: false,
			selected: 0,
			request: {
				bits: 16,
				transformed: true,
			},
			histogram: [],
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(4)

		unsubscribers[0] = initProxy(state, `image.${imageStorageKey(viewer.scope.image)}.statistics`, ['p:show', 'o:request'])

		unsubscribers[1] = bus.subscribe<ImageLoaded>('image:load', () => {
			if (state.show) {
				void compute()
			} else if (state.histogram.length) {
				state.histogram = []
			}
		})

		unsubscribers[2] = subscribeKey(state, 'show', (show) => {
			if (show && state.histogram.length === 0) {
				void compute()
			}
		})

		unsubscribers[3] = subscribe(state.request, () => {
			void compute()
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof ImageStatisticsState['request']>(key: K, value: ImageStatisticsState['request'][K]) {
		state.request[key] = value
	}

	async function compute() {
		const histogram = await Api.Image.statistics({ path: viewer.path, transformation: viewer.state.transformation, camera: viewer.scope.image.camera?.name, ...state.request })
		if (histogram) state.histogram = ref(histogram)
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, update, compute, show, hide } as const
})
