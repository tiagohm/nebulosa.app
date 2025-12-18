import { molecule, use } from 'bunshi'
import type { AnnotatedSkyObject } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { ImageSolverMolecule } from './solver'
import { ImageViewerMolecule } from './viewer'

export interface ImageAnnotationState {
	show: boolean
	visible: boolean
	loading: boolean
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
		})

	stateMap.set(key, state)

	function toggle(enabled?: boolean) {
		state.visible = enabled ?? !state.visible
	}

	async function annotate() {
		const { solution } = solver.state

		if (!solution) return

		try {
			state.loading = true
			const stars = await Api.Image.annotate({ solution })

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

	return { state, scope: viewer.scope, viewer, toggle, annotate, show, hide } as const
})
