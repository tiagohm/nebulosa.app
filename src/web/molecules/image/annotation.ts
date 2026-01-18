import { molecule, onMount, use } from 'bunshi'
import type { AnnotatedSkyObject, AnnotateImage } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { ImageSolverMolecule } from './solver'
import { ImageViewerMolecule } from './viewer'

export interface ImageAnnotationState {
	show: boolean
	visible: boolean
	loading: boolean
	readonly request: Omit<AnnotateImage, 'solution'>
	stars: readonly AnnotatedSkyObject[]
}

const stateMap = new Map<string, ImageAnnotationState>()

export const ImageAnnotationMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const solver = use(ImageSolverMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageAnnotationState>({
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

	stateMap.set(key, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `image.${viewer.storageKey}.annotation`, ['p:show', 'o:request'])

		return () => {
			unsubscriber()
		}
	})

	function toggle(enabled?: boolean) {
		state.visible = enabled ?? !state.visible
	}

	function update<K extends keyof ImageAnnotationState['request']>(key: K, value: ImageAnnotationState['request'][K]) {
		state.request[key] = value
	}

	async function annotate() {
		const { solution } = solver.state

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

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, toggle, update, annotate, show, hide } as const
})
