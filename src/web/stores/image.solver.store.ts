import { nanoid } from 'nanoid'
import { formatRA, formatDEC, toDeg, arcsec } from 'nebulosa/src/angle'
import { numericKeyword } from 'nebulosa/src/fits.util'
import type { Mount } from 'nebulosa/src/indi.device'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import bus from 'src/shared/bus'
import { DEFAULT_PLATE_SOLVE_START, type Framing, type PlateSolveStart } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { ImageLoaded } from '../shared/types'
import { framingStore } from './framing.store'
import type { ImageViewerStore } from './image.viewer.store'
import { settingsStore } from './settings.store'

export type ImageSolverStore = ReturnType<typeof imageSolverStore>

export interface ImageSolverState {
	show: boolean
	loading: boolean
	readonly request: PlateSolveStart
	solution?: PlateSolution
}

export function imageSolverStore(viewer: ImageViewerStore) {
	const state = proxy<ImageSolverState>({
		show: false,
		loading: false,
		request: structuredClone(DEFAULT_PLATE_SOLVE_START),
	})

	console.info('image solver created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image solver mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.solver`, ['p:show', 'o:request'])

		u[1] = bus.subscribe<ImageLoaded>('image:load', ({ image, info, refreshed }) => {
			if (refreshed && image === viewer.image) {
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

		state.solution = viewer.state.info?.solution && ref(viewer.state.info.solution)
		state.request.id ||= nanoid()
	}

	function unmount() {
		if (!mounted) return
		console.info('image solver unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof PlateSolveStart>(key: K, value: PlateSolveStart[K]) {
		state.request[key] = value
	}

	async function start() {
		try {
			state.loading = true

			const request: PlateSolveStart = { ...settingsStore.state.solver[state.request.type], ...state.request, path: viewer.state.path, id: viewer.image.id }
			request.fov = arcsec(angularSizeOfPixel(request.focalLength, request.pixelSize) * viewer.state.info!.height)

			const solution = await Api.PlateSolver.start(request)
			state.solution = solution && ref(solution)
		} finally {
			state.loading = false
		}
	}

	function stop() {
		return Api.PlateSolver.stop(state.request.id)
	}

	async function goTo(mount?: Mount) {
		if (!mount || !state.solution) return
		await Api.Mounts.goTo(mount, { type: 'J2000', J2000: { x: state.solution.rightAscension, y: state.solution.declination } })
	}

	async function sync(mount?: Mount) {
		if (!mount || !state.solution) return
		await Api.Mounts.sync(mount, { type: 'J2000', J2000: { x: state.solution.rightAscension, y: state.solution.declination } })
	}

	async function frame() {
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

		await framingStore.load(request)
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		start,
		stop,
		goTo,
		sync,
		frame,
		show,
		hide,
	} as const
}

export function hasScaledSolution(solution: PlateSolution | undefined): solution is PlateSolution {
	return solution?.scale !== undefined && Number.isFinite(solution.scale) && solution.scale > 0
}
