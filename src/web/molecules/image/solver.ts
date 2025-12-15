import { molecule, use } from 'bunshi'
import { arcsec, formatDEC, formatRA, toDeg } from 'nebulosa/src/angle'
import type { Mount } from 'nebulosa/src/indi.device'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import bus from 'src/shared/bus'
import type { Framing, PlateSolveStart } from 'src/shared/types'
import { Api } from '@/shared/api'
import { SettingsMolecule } from '../settings'
import { ImageViewerMolecule } from './viewer'

export const ImageSolverMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const settings = use(SettingsMolecule)
	const state = viewer.state.solver

	function update<K extends keyof PlateSolveStart>(key: K, value: PlateSolveStart[K]) {
		state.request[key] = value
	}

	async function start() {
		try {
			state.loading = true

			const request: PlateSolveStart = { ...state.request, ...settings.state.solver[state.request.type], path: viewer.realPath(), id: viewer.scope.image.key }
			request.fov = arcsec(angularSizeOfPixel(request.focalLength, request.pixelSize) * viewer.state.info!.height)

			state.solution = await Api.PlateSolver.start(request)
		} finally {
			state.loading = false
		}
	}

	function stop() {
		return Api.PlateSolver.stop({ id: viewer.scope.image.key })
	}

	async function goTo(mount?: Mount) {
		if (!mount || !state.solution) return
		const { rightAscension, declination } = state.solution
		await Api.Mounts.goTo(mount, { type: 'J2000', rightAscension, declination })
	}

	async function syncTo(mount?: Mount) {
		if (!mount || !state.solution) return
		const { rightAscension, declination } = state.solution
		await Api.Mounts.syncTo(mount, { type: 'J2000', rightAscension, declination })
	}

	function frame() {
		if (!state.solution) return

		const request: Partial<Framing> = {
			rightAscension: formatRA(state.solution.rightAscension),
			declination: formatDEC(state.solution.declination),
			focalLength: state.request.focalLength,
			pixelSize: state.request.pixelSize,
			width: state.solution.widthInPixels,
			height: state.solution.heightInPixels,
			rotation: toDeg(state.solution.orientation),
		}

		bus.emit('framing:load', request)
	}

	function show() {
		viewer.show('solver')
	}

	function hide() {
		viewer.hide('solver')
	}

	return { state, viewer, scope: viewer.scope, update, start, stop, goTo, syncTo, frame, show, hide } as const
})
