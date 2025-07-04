import { addToast } from '@heroui/react'
import { molecule, onMount } from 'bunshi'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import { subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

// Molecule that manages star detection
export const StarDetectionMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const key = scope.image.key
	const starDetection = viewer.state.starDetection

	onMount(() => {
		const unsubscribe = subscribe(starDetection.request, () => simpleLocalStorage.set('image.starDetection', starDetection.request))

		return () => unsubscribe()
	})

	// Toggles the visibility of detected stars
	function toggle(enabled?: boolean) {
		starDetection.show = enabled ?? !starDetection.show
	}

	// Detects stars in the image
	async function detect() {
		try {
			starDetection.loading = true

			const stars = await Api.StarDetection.detect(starDetection.request)

			if (!stars) return

			if (stars.length === 0) {
				addToast({ description: 'No stars detected', color: 'warning', title: 'WARN' })
			} else {
				starDetection.stars = stars
				starDetection.show = stars.length > 0
			}

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
		} catch (e) {
			addToast({ description: (e as Error).message, color: 'danger', title: 'ERROR' })
		} finally {
			starDetection.loading = false
		}
	}

	// Selects a detected star and draws it on a canvas
	function select(star: DetectedStar) {
		starDetection.selected = star

		const canvas = document.getElementById(`${key}-selected-star`) as HTMLCanvasElement | null
		if (!canvas) return
		const ctx = canvas.getContext('2d')
		const image = document.getElementById(key) as HTMLImageElement
		ctx?.drawImage(image, star.x - 8.5, star.y - 8.5, 16, 16, 0, 0, canvas.width, canvas.height)
	}

	return { state: starDetection, viewer, scope, toggle, detect, select }
})
