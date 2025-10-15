import { addToast } from '@heroui/react'
import { molecule } from 'bunshi'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import { Api } from '@/shared/api'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const StarDetectionMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const key = scope.image.key
	const { starDetection } = viewer.state

	function toggle(enabled?: boolean) {
		starDetection.visible = enabled ?? !starDetection.visible
	}

	async function detect() {
		try {
			starDetection.loading = true

			const stars = await Api.StarDetection.detect(starDetection.request)

			if (!stars) return

			if (stars.length === 0) {
				addToast({ description: 'No stars detected', color: 'warning', title: 'WARN' })
			}

			starDetection.stars = stars
			starDetection.visible = stars.length > 0

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

			starDetection.computed = { hfd, snr, fluxMin, fluxMax }
		} finally {
			starDetection.loading = false
		}
	}

	function select(star: DetectedStar) {
		starDetection.selected = star

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

	return { state: starDetection, viewer, scope, toggle, detect, select, show, hide } as const
})
