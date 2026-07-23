import { Api } from '@shared/api'
import { imageBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { Writable } from 'nebulosa/src/core/types'
import type { AnnotatedSkyObject, AnnotateImage } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type ImageAnnotationStore = ReturnType<typeof imageAnnotationStore>

export interface ImageAnnotationState {
	visible: boolean
	loading: boolean
	readonly request: Writable<Omit<AnnotateImage, 'solution'>>
	stars: readonly AnnotatedSkyObject[]
}

export function imageAnnotationStore(viewer: ImageViewerStore) {
	const state = proxy<ImageAnnotationState>({
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
		if (mounted) return unmount

		console.info('image annotation mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.annotation`, ['o:request'])

		u[1] = imageBus.subscribe('load', ({ image, refreshed }) => {
			if (refreshed && image === viewer.image) {
				reset()
			}
		})

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image annotation unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function setStars(value: boolean) {
		state.request.stars = value
	}

	function setDsos(value: boolean) {
		state.request.dsos = value
	}

	function setUseSimbad(value: boolean) {
		state.request.useSimbad = value
	}

	function setMinorPlanets(value: boolean) {
		state.request.minorPlanets = value
	}

	function setMinorPlanetsMagnitudeLimit(value: number) {
		state.request.minorPlanetsMagnitudeLimit = value
	}

	function setIncludeMinorPlanetsWithoutMagnitude(value: boolean) {
		state.request.includeMinorPlanetsWithoutMagnitude = value
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

	return {
		state,
		viewer,
		mount,
		unmount,
		setStars,
		setDsos,
		setUseSimbad,
		setMinorPlanets,
		setMinorPlanetsMagnitudeLimit,
		setIncludeMinorPlanetsWithoutMagnitude,
		toggle,
		annotate,
		reset,
	} as const
}
