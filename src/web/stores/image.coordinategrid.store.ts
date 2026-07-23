import { Api } from '@shared/api'
import { imageBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { hasScaledSolution } from '@stores/image.solver.store'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { ImageCoordinateGrid } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'
import { subscribeKey } from 'valtio/utils'

export type ImageCoordinateGridStore = ReturnType<typeof imageCoordinateGridStore>

export interface ImageCoordinateGridState {
	enabled: boolean
	loading: boolean
	grid?: ImageCoordinateGrid
}

export function imageCoordinateGridStore(viewer: ImageViewerStore) {
	const state = proxy<ImageCoordinateGridState>({
		enabled: false,
		loading: false,
		grid: undefined,
	})

	console.info('image coordinate grid created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return unmount

		console.info('image coordinate grid mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.coordinategrid`, ['p:enabled'])

		u[1] = imageBus.subscribe('load', ({ image, info, refreshed }) => {
			if (refreshed && image === viewer.image) {
				if (state.enabled && hasScaledSolution(info.solution)) void compute(info.solution, true)
				else reset()
			}
		})

		u[2] = subscribeKey(viewer.solver.state, 'solution', (solution) => {
			if (state.enabled) void compute(solution, true)
			else reset()
		})

		u[3] = subscribeKey(state, 'enabled', (enabled) => {
			if (enabled) void compute()
		})

		if (state.enabled) void compute()

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image coordinate grid unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function setEnabled(value: boolean) {
		state.enabled = value
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
		state.enabled = !state.enabled
	}

	function show() {
		state.enabled = true
	}

	function hide() {
		state.enabled = false
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		setEnabled,
		compute,
		reset,
		toggle,
		show,
		hide,
	} as const
}
