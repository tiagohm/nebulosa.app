import { addToast } from '@heroui/react'
import { molecule, use } from 'bunshi'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import { Api } from '@/shared/api'
import { ImageViewerMolecule } from './viewer'

export const StarDetectionMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key } = viewer.scope.image
	const state = viewer.state.starDetection

	function toggle(enabled?: boolean) {
		state.visible = enabled ?? !state.visible
	}

	async function detect() {
		try {
			state.loading = true

			const request = { ...state.request, path: viewer.realPath() }
			const stars = await Api.StarDetection.detect(request)

			if (!stars) return

			if (stars.length === 0) {
				addToast({ description: 'No stars detected', color: 'warning', title: 'WARN' })
			}

			state.stars = stars
			state.visible = stars.length > 0

			let hfd = 0
			let snr = 0
			let fluxMin = Number.MAX_VALUE
			let fluxMax = Number.MIN_VALUE

			for (const star of stars) {
				hfd += star.hfd
				snr += star.snr
				fluxMin = Math.min(fluxMin, star.flux)
				fluxMax = Math.max(fluxMax, star.flux)
			}

			if (stars.length) {
				hfd /= stars.length
				snr /= stars.length
			} else {
				fluxMin = 0
				fluxMax = 0
			}

			state.computed = { hfd, snr, fluxMin, fluxMax }
		} finally {
			state.loading = false
		}
	}

	function select(star: DetectedStar) {
		state.selected = star

		const canvas = document.getElementById(`${key}-selected-star`) as HTMLCanvasElement | null

		if (!canvas) return

		const ctx = canvas.getContext('2d')
		const image = document.getElementById(key) as HTMLImageElement
		ctx?.drawImage(image, star.x - 8.5, star.y - 8.5, 16, 16, 0, 0, canvas.width, canvas.height)
	}

	function show() {
		viewer.show('starDetection')
	}

	function hide() {
		viewer.hide('starDetection')
	}

	return { state, viewer, scope: viewer.scope, toggle, detect, select, show, hide } as const
})
