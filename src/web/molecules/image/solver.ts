import { molecule, onMount, use } from 'bunshi'
import { arcsec, formatDEC, formatRA, toDeg } from 'nebulosa/src/angle'
import { numericKeyword } from 'nebulosa/src/fits'
import type { Mount } from 'nebulosa/src/indi.device'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import bus from 'src/shared/bus'
import { DEFAULT_PLATE_SOLVE_START, type Framing, type PlateSolveStart } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import type { ImageLoaded, ImageSolved } from '@/shared/types'
import { SettingsMolecule } from '../settings'
import { ImageViewerMolecule } from './viewer'

export interface ImageSolverState {
	show: boolean
	loading: boolean
	request: PlateSolveStart
	solution?: PlateSolution
}

const stateMap = new Map<string, ImageSolverState>()

export const ImageSolverMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const settings = use(SettingsMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageSolverState>({
			show: false,
			loading: false,
			request: structuredClone(DEFAULT_PLATE_SOLVE_START),
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = bus.subscribe<ImageLoaded>('image:load', ({ image, info, newImage }) => {
			if (newImage && image.key === key) {
				const { request } = state

				// Update current solution
				state.solution = info.solution && ref(info.solution)

				// Update plate solver request with FITS header information
				request.rightAscension = formatRA(info.rightAscension ?? 0)
				request.declination = formatDEC(info.declination ?? 0)
				request.blind = info.rightAscension === undefined || info.declination === undefined

				if (info.headers) {
					request.focalLength = numericKeyword(info.headers, 'FOCALLEN', request.focalLength)
					request.pixelSize = numericKeyword(info.headers, 'XPIXSZ', request.pixelSize)
				}
			}
		})

		unsubscribers[1] = subscribeKey(state, 'solution', (solution) => {
			if (solution) {
				bus.emit<ImageSolved>('image:solved', { image: viewer.scope.image, solution })
			}
		})

		state.solution = viewer.state.info?.solution && ref(viewer.state.info.solution)

		unsubscribers[2] = initProxy(state, `image.${viewer.storageKey}.solver`, ['p:show', 'o:request'])

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof PlateSolveStart>(key: K, value: PlateSolveStart[K]) {
		state.request[key] = value
	}

	async function start() {
		try {
			state.loading = true

			const request: PlateSolveStart = { ...state.request, ...settings.state.solver[state.request.type], path: viewer.path, id: viewer.scope.image.key }
			request.fov = arcsec(angularSizeOfPixel(request.focalLength, request.pixelSize) * viewer.state.info!.height)

			const solution = await Api.PlateSolver.start(request)
			state.solution = solution && ref(solution)
		} finally {
			state.loading = false
		}
	}

	function stop() {
		return Api.PlateSolver.stop({ id: viewer.scope.image.key })
	}

	async function goTo(mount?: Mount) {
		if (!mount || !state.solution) return
		await Api.Mounts.goTo(mount, { type: 'J2000', J2000: { x: state.solution.rightAscension, y: state.solution.declination } })
	}

	async function syncTo(mount?: Mount) {
		if (!mount || !state.solution) return
		await Api.Mounts.syncTo(mount, { type: 'J2000', J2000: { x: state.solution.rightAscension, y: state.solution.declination } })
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
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, viewer, scope: viewer.scope, update, start, stop, goTo, syncTo, frame, show, hide } as const
})
