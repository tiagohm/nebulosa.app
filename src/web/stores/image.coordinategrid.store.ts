import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import bus from 'src/shared/bus'
import type { ImageCoordinateGrid } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { ImageLoaded } from '../shared/types'
import { hasScaledSolution } from './image.solver.store'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageCoordinateGridStore = ReturnType<typeof imageCoordinateGridStore>

export interface ImageCoordinateGridState {
	visible: boolean
	loading: boolean
	grid?: ImageCoordinateGrid
}

export function imageCoordinateGridStore(viewer: ImageViewerStore) {
	const state = proxy<ImageCoordinateGridState>({
		visible: false,
		loading: false,
		grid: undefined,
	})

	console.info('image coordinate grid created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image coordinate grid mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.coordinategrid`, ['p:visible'])

		u[1] = bus.subscribe<ImageLoaded>('image:load', ({ image, info, refreshed }) => {
			if (refreshed && image === viewer.image) {
				if (state.visible && hasScaledSolution(info.solution)) void compute(info.solution, true)
				else reset()
			}
		})

		u[2] = subscribeKey(viewer.solver.state, 'solution', (solution) => {
			if (state.visible) void compute(solution, true)
			else reset()
		})

		u[3] = subscribeKey(state, 'visible', (visible) => {
			if (visible) void compute()
		})

		if (state.visible) void compute()
	}

	function unmount() {
		if (!mounted) return
		console.info('image coordinate grid unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	async function compute(solution: PlateSolution | undefined = viewer.solver.state.solution, force: boolean = false) {
		if (state.loading) return

		if (!hasScaledSolution(solution)) {
			reset()
			return
		}

		if (state.grid && !force) return

		try {
			state.loading = true
			const grid = await Api.Image.coordinateGrid(solution)
			if (grid) state.grid = ref(grid)
		} finally {
			state.loading = false
		}
	}

	function reset() {
		state.grid = undefined
	}

	function toggle() {
		state.visible = !state.visible
	}

	function show() {
		state.visible = true
	}

	function hide() {
		state.visible = false
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		compute,
		reset,
		toggle,
		show,
		hide,
	} as const
}
