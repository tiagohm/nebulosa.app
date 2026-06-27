import { nanoid } from 'nanoid'
import { pixelScale } from 'nebulosa/src/astronomy/formulas'
import { toArcsec } from 'nebulosa/src/math/units/angle'
import { DEFAULT_FOV_ITEM, type ComputedFov, type FovItem } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { initProxy } from '../shared/proxy'
import type { AstroBinEquipmentPopoverItem } from '../ui/AstroBinEquipmentPopover'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageFovStore = ReturnType<typeof imageFovStore>

export interface ImageFovState {
	show: boolean
	selected: number // item index
	readonly items: FovItem[]
	readonly computed: ComputedFov[]
}

export function imageFovStore(viewer: ImageViewerStore) {
	const state = proxy<ImageFovState>({
		show: false,
		selected: 0,
		items: [],
		computed: [],
	})

	console.info('image fov created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image fov mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.fov`, ['p:show', 'o:items'])

		u[1] = subscribeKey(viewer.solver.state, 'solution', (solution) => {
			solution && compute()
		})

		if (state.items.length === 0) {
			add()
		} else {
			compute()
		}
	}

	function unmount() {
		if (!mounted) return
		console.info('image fov unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof FovItem>(key: K, value: FovItem[K], id?: string) {
		const index = id !== undefined ? state.items.findIndex((e) => e.id === id) : state.selected
		if (index >= 0) state.items[index][key] = value
		if (key !== 'visible') compute(id)
	}

	function selectTelescope(item: AstroBinEquipmentPopoverItem) {
		update('aperture', item.ap ?? 0)
		update('focalLength', item.fl ?? 0)
	}

	function selectCamera(item: AstroBinEquipmentPopoverItem) {
		update('cameraWidth', item.w ?? 0)
		update('cameraHeight', item.h ?? 0)
		update('pixelWidth', item.ps ?? 0)
		update('pixelHeight', item.ps ?? 0)
	}

	function select(item: FovItem | number) {
		state.selected = typeof item === 'number' ? item : state.items.indexOf(item)
	}

	function add() {
		const item = structuredClone(DEFAULT_FOV_ITEM)
		item.id = nanoid()
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

	function compute(id?: string) {
		const { info } = viewer.state
		const { solution } = viewer.solver.state

		if (!info || !solution?.scale) return

		const scale = toArcsec(solution.scale)
		const index = id !== undefined ? state.items.findIndex((e) => e.id === id) : undefined
		const a = index ?? 0
		const n = index !== undefined ? index + 1 : state.items.length

		for (let i = a; i < n; i++) {
			const item = state.items[i]

			const focalLength = item.focalLength * (item.barlowReducer || 1)
			const width = pixelScale(item.pixelWidth, focalLength)
			const height = pixelScale(item.pixelHeight, focalLength)

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

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		selectTelescope,
		selectCamera,
		select,
		add,
		remove,
		show,
		hide,
	} as const
}
