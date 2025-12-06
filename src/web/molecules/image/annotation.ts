import { molecule, use } from 'bunshi'
import { Api } from '@/shared/api'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageAnnotationMolecule = molecule(() => {
	const scope = use(ImageViewerScope)
	const viewer = use(ImageViewerMolecule)
	const { annotation } = viewer.state

	function toggle(enabled?: boolean) {
		annotation.visible = enabled ?? !annotation.visible
	}

	async function annotate() {
		const { solution } = viewer.state.solver

		if (!solution) return

		try {
			annotation.loading = true
			const stars = await Api.Image.annotate({ solution })

			if (!stars) return

			annotation.stars = stars
			annotation.visible = stars.length > 0
		} finally {
			annotation.loading = false
		}
	}

	function show() {
		viewer.show('annotation')
	}

	function hide() {
		viewer.hide('annotation')
	}

	return { state: annotation, scope, viewer, toggle, annotate, show, hide } as const
})
