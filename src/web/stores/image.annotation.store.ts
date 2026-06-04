import bus from 'src/shared/bus'
import type { AnnotatedSkyObject, AnnotateImage } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { ImageLoaded } from '../shared/types'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageAnnotationStore = ReturnType<typeof imageAnnotationStore>

export interface ImageAnnotationState {
	show: boolean
	visible: boolean
	loading: boolean
	readonly request: Omit<AnnotateImage, 'solution'>
	stars: readonly AnnotatedSkyObject[]
}

export function imageAnnotationStore(viewer: ImageViewerStore) {
	const state = proxy<ImageAnnotationState>({
		show: false,
		visible: false,
		loading: false,
		stars: [],
		request: {
			stars: true,
			dsos: true,
			useSimbad: false,
			minorPlanets: false,
			minorPlanetsMagnitudeLimit: 12,
			includeMinorPlanetsWithoutMagnitude: false,
		},
	})

	console.info('image annotation created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image annotation mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.annotation`, ['p:show', 'o:request'])

		u[1] = bus.subscribe<ImageLoaded>('image:load', ({ image, refreshed }) => {
			if (refreshed && image === viewer.image) {
				reset()
			}
		})
	}

	function unmount() {
		if (!mounted) return
		console.info('image annotation unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof ImageAnnotationState['request']>(key: K, value: ImageAnnotationState['request'][K]) {
		state.request[key] = value
	}

	function toggle(enabled?: boolean) {
		state.visible = enabled ?? !state.visible
	}

	async function annotate() {
		const { solution } = viewer.solver.state

		if (!solution) return

		try {
			state.loading = true
			const stars = await Api.Image.annotate({ solution, ...state.request })

			if (!stars) return

			state.stars = stars
			state.visible = stars.length > 0
		} finally {
			state.loading = false
		}
	}

	function reset() {
		state.stars = []
		state.visible = false
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
		toggle,
		annotate,
		reset,
		show,
		hide,
	} as const
}
