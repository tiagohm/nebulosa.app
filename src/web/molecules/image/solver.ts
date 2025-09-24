import { molecule, onMount } from 'bunshi'
import { arcsec, formatDEC, formatRA, toDeg } from 'nebulosa/src/angle'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import bus, { unsubscribe } from 'src/shared/bus'
import type { Framing, Mount, PlateSolveStart } from 'src/shared/types'
import { subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { storage } from '@/shared/storage'
import { SettingsMolecule } from '../settings'
import { ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageSolverMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const settings = m(SettingsMolecule)
	const { solver } = viewer.state

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(1)

		unsubscribers[0] = subscribe(solver.request, () => {
			storage.set(`image.solver.${viewer.scope.image.camera?.name || 'default'}`, solver.request)
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof PlateSolveStart>(key: K, value: PlateSolveStart[K]) {
		solver.request[key] = value
	}

	async function start() {
		try {
			solver.loading = true

			const request = { ...solver.request, ...settings.state.solver[solver.request.type] } // Merge solver-specific settings
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
			focalLength: solver.request.focalLength,
			pixelSize: solver.request.pixelSize,
			width: solver.solution.widthInPixels,
			height: solver.solution.heightInPixels,
			rotation: toDeg(solver.solution.orientation),
		}

		bus.emit('framing:load', request)
	}

	function show() {
		viewer.show('solver')
	}

	function hide() {
		viewer.hide('solver')
	}

	return { state: solver, viewer, scope, update, start, stop, goTo, syncTo, frame, show, hide } as const
})
