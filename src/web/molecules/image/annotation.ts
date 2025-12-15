import { molecule, use } from 'bunshi'
import { Api } from '@/shared/api'
import { ImageViewerMolecule } from './viewer'

export const ImageAnnotationMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const state = viewer.state.annotation

	function toggle(enabled?: boolean) {
		state.visible = enabled ?? !state.visible
	}

	async function annotate() {
		const { solution } = viewer.state.solver

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
		viewer.show('annotation')
	}

	function hide() {
		viewer.hide('annotation')
	}

	return { state, scope: viewer.scope, viewer, toggle, annotate, show, hide } as const
})
