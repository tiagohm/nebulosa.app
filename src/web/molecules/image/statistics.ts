import { molecule, onMount, use } from 'bunshi'
import { unsubscribe } from 'src/shared/bus'
import { ref, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { type ImageState, ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageStatisticsMolecule = molecule(() => {
	const scope = use(ImageViewerScope)
	const viewer = use(ImageViewerMolecule)
	const { statistics, transformation } = viewer.state

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = subscribeKey(viewer.state, 'info', (info) => {
			if (info && statistics.show) {
				void compute()
			}
		})

		unsubscribers[1] = subscribeKey(statistics, 'show', (show) => {
			if (show && statistics.histogram.length === 0) {
				void compute()
			}
		})

		unsubscribers[2] = subscribe(statistics.request, () => {
			void compute()
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof ImageState['statistics']['request']>(key: K, value: ImageState['statistics']['request'][K]) {
		statistics.request[key] = value
	}

	async function compute() {
		const { request } = statistics
		const histogram = await Api.Image.statistics({ path: viewer.realPath(), transformation, camera: scope.image.camera?.name, ...request })
		if (histogram) statistics.histogram = ref(histogram)
	}

	function show() {
		viewer.show('statistics')
	}

	function hide() {
		viewer.hide('statistics')
	}

	return { state: statistics, scope, viewer, update, compute, show, hide } as const
})
