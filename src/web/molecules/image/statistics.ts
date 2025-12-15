import { molecule, onMount, use } from 'bunshi'
import { unsubscribe } from 'src/shared/bus'
import { ref, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { type ImageState, ImageViewerMolecule } from './viewer'

export const ImageStatisticsMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const state = viewer.state.statistics

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = subscribeKey(viewer.state, 'info', (info) => {
			if (info && state.show) {
				void compute()
			}
		})

		unsubscribers[1] = subscribeKey(state, 'show', (show) => {
			if (show && state.histogram.length === 0) {
				void compute()
			}
		})

		unsubscribers[2] = subscribe(state.request, () => {
			void compute()
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof ImageState['statistics']['request']>(key: K, value: ImageState['statistics']['request'][K]) {
		state.request[key] = value
	}

	async function compute() {
		const histogram = await Api.Image.statistics({ path: viewer.realPath(), transformation: viewer.state.transformation, camera: viewer.scope.image.camera?.name, ...state.request })
		if (histogram) state.histogram = ref(histogram)
	}

	function show() {
		viewer.show('statistics')
	}

	function hide() {
		viewer.hide('statistics')
	}

	return { state, scope: viewer.scope, viewer, update, compute, show, hide } as const
})
