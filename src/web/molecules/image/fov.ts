import { molecule, onMount, use } from 'bunshi'
import { toArcsec } from 'nebulosa/src/angle'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import bus, { unsubscribe } from 'src/shared/bus'
import { type ComputedFov, DEFAULT_FOV_ITEM, type FovItem } from 'src/shared/types'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { initProxy } from '@/shared/proxy'
import type { ImageSolved } from '@/shared/types'
import { ImageSolverMolecule } from './solver'
import { ImageViewerMolecule } from './viewer'

export interface ImageFovState {
	show: boolean
	selected: number
	readonly items: FovItem[]
	readonly computed: ComputedFov[]
}

const stateMap = new Map<string, ImageFovState>()

export const ImageFovMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const solver = use(ImageSolverMolecule)
	const { key, camera } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageFovState>({
			show: false,
			selected: 0,
			items: [],
			computed: [],
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		const storageKey = camera?.name || 'default'
		unsubscribers[0] = initProxy(state, `image.${storageKey}.fov`, ['p:show', 'o:items'])

		unsubscribers[1] = subscribeKey(state, 'show', (show) => {
			show && compute()
		})

		unsubscribers[2] = bus.subscribe<ImageSolved>('image:solved', ({ image }) => {
			if (image.key === key && state.show) {
				compute()
			}
		})

		if (!state.items.length) {
			add()
		} else {
			compute()
		}

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof FovItem>(key: K, value: FovItem[K], id?: number) {
		const index = id !== undefined ? state.items.findIndex((e) => e.id === id) : state.selected
		if (index >= 0) state.items[index][key] = value
		if (key !== 'visible') compute(id)
	}

	function select(id: number) {
		state.selected = state.items.findIndex((e) => e.id === id)
	}

	function add() {
		const item = structuredClone(DEFAULT_FOV_ITEM)
		item.id = Date.now()
		state.items.push(item)
		state.selected = state.items.length - 1
		compute(item.id)
	}

	function remove() {
		if (state.items.length <= 1) return

		state.items.splice(state.selected, 1)
		state.computed.splice(state.selected, 1)

		if (state.selected >= state.items.length) {
			state.selected = state.items.length - 1
		}
	}

	function compute(id?: number) {
		const { info } = viewer.state
		const { solution } = solver.state

		if (!info || !solution?.scale) return

		const scale = toArcsec(solution.scale)
		const index = id !== undefined ? state.items.findIndex((e) => e.id === id) : undefined
		const a = index !== undefined ? index : 0
		const n = index !== undefined ? index + 1 : state.items.length

		for (let i = a; i < n; i++) {
			const item = state.items[i]

			const focalLength = item.focalLength * (item.barlowReducer || 1)
			const width = angularSizeOfPixel(focalLength, item.pixelWidth)
			const height = angularSizeOfPixel(focalLength, item.pixelHeight)

			state.computed[i] = {
				focalRatio: item.aperture <= 0 ? 0 : focalLength / item.aperture,
				resolution: {
					width: width * item.bin,
					height: height * item.bin,
				},
				field: {
					width: (width * item.cameraWidth) / 60,
					height: (height * item.cameraHeight) / 60,
				},
				svg: {
					width: ((item.cameraWidth * (width / scale)) / info.width) * 100,
					height: ((item.cameraHeight * (height / scale)) / info.height) * 100,
				},
			}
		}
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, scope: viewer.scope, viewer, update, select, add, remove, show, hide } as const
})
