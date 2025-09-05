import { molecule, onMount } from 'bunshi'
import { arcsec, formatDEC, formatRA } from 'nebulosa/src/angle'
import { numericKeyword } from 'nebulosa/src/fits'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import bus, { unsubscribe } from 'src/shared/bus'
import type { Framing, ImageInfo, Mount, PlateSolveStart } from 'src/shared/types'
import { subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageSolverMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const solver = viewer.state.plateSolver

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = subscribe(solver.request, () => {
			simpleLocalStorage.set('image.plateSolver', solver.request)
		})

		unsubscribers[1] = subscribeKey(solver, 'show', (show) => {
			if (show) {
				updateRequestFromImageInfo(viewer.state.info)
			}
		})

		updateRequestFromImageInfo(viewer.state.info)

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function updateRequestFromImageInfo(info: ImageInfo) {
		// Update plate solver request with FITS header information
		if (info.rightAscension) solver.request.rightAscension = formatRA(info.rightAscension)
		if (info.declination) solver.request.declination = formatDEC(info.declination)
		solver.request.blind = info.rightAscension === undefined || info.declination === undefined

		if (info.headers) {
			solver.request.focalLength = numericKeyword(info.headers, 'FOCALLEN', solver.request.focalLength)
			solver.request.pixelSize = numericKeyword(info.headers, 'XPIXSZ', solver.request.pixelSize)
		}
	}

	function update<K extends keyof PlateSolveStart>(key: K, value: PlateSolveStart[K]) {
		solver.request[key] = value
	}

	async function start() {
		try {
			solver.loading = true

			const request = solver.request
			request.fov = arcsec(angularSizeOfPixel(request.focalLength, request.pixelSize) * viewer.state.info.height)

			solver.solution = await Api.PlateSolver.start(request)
		} finally {
			solver.loading = false
		}
	}

	function stop() {
		return Api.PlateSolver.stop({ id: scope.image.key })
	}

	async function goTo(mount?: Mount) {
		if (!mount || !solver.solution) return
		const { rightAscension, declination } = solver.solution
		await Api.Mounts.goTo(mount, { type: 'J2000', rightAscension, declination })
	}

	async function slewTo(mount?: Mount) {
		if (!mount || !solver.solution) return
		const { rightAscension, declination } = solver.solution
		await Api.Mounts.slewTo(mount, { type: 'J2000', rightAscension, declination })
	}

	async function syncTo(mount?: Mount) {
		if (!mount || !solver.solution) return
		const { rightAscension, declination } = solver.solution
		await Api.Mounts.syncTo(mount, { type: 'J2000', rightAscension, declination })
	}

	function frame() {
		if (!solver.solution) return

		const request: Partial<Framing> = {
			rightAscension: formatRA(solver.solution.rightAscension),
			declination: formatDEC(solver.solution.declination),
		}

		bus.emit('framing:load', request)
	}

	function hide() {
		viewer.hide('plateSolver')
	}

	return { state: solver, viewer, scope, update, start, stop, goTo, slewTo, syncTo, frame, hide } as const
})
