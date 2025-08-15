import { addToast } from '@heroui/react'
import { molecule, onMount } from 'bunshi'
import { arcsec, formatDEC, formatRA } from 'nebulosa/src/angle'
import { numericKeyword } from 'nebulosa/src/fits'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import type { PlateSolveStart } from 'src/shared/types'
import { subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

// Molecule that manages the plate solver
export const ImageSolverMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const plateSolver = viewer.state.plateSolver

	onMount(() => {
		const { info } = viewer.state

		// Update plate solver request with FITS header information
		plateSolver.request.rightAscension = formatRA(info.rightAscension ?? 0)
		plateSolver.request.declination = formatDEC(info.declination ?? 0)
		plateSolver.request.blind = info.rightAscension !== undefined && info.declination !== undefined

		if (info.headers) {
			plateSolver.request.focalLength = numericKeyword(info.headers, 'FOCALLEN', plateSolver.request.focalLength)
			plateSolver.request.pixelSize = numericKeyword(info.headers, 'XPIXSZ', plateSolver.request.pixelSize)
		}

		const unsubscribe = subscribe(plateSolver.request, () => simpleLocalStorage.set('image.plateSolver', plateSolver.request))

		return () => unsubscribe()
	})

	// Updates a specific property of the plate solver request
	function update<K extends keyof PlateSolveStart>(key: K, value: PlateSolveStart[K]) {
		viewer.state.plateSolver.request[key] = value
	}

	// Solves the plate using the current request
	async function start() {
		try {
			plateSolver.loading = true

			const request = viewer.state.plateSolver.request
			request.fov = arcsec(angularSizeOfPixel(request.focalLength, request.pixelSize) * viewer.state.info.height)

			viewer.state.plateSolver.solution = await Api.PlateSolver.start(request)
		} catch (e) {
			addToast({ description: (e as Error).message, color: 'danger', title: 'ERROR' })
		} finally {
			plateSolver.loading = false
		}
	}

	// Stops the plate solving process
	function stop() {
		return Api.PlateSolver.stop({ id: scope.image.key })
	}

	return { state: viewer.state.plateSolver, viewer, scope, update, start, stop }
})
