import { molecule, onMount, use } from 'bunshi'
import type { Angle } from 'nebulosa/src/angle'
import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import type { Point } from 'nebulosa/src/geometry'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import bus from 'src/shared/bus'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { CoordinateInterpolator } from '@/shared/coordinate-interpolation'
import type { ImageLoaded, ImageSolved } from '@/shared/types'
import { isMouseDeviceSupported } from '@/shared/util'
import { ImageSolverMolecule } from './solver'
import { ImageViewerMolecule } from './viewer'

export interface ImageMouseCoordinateState {
	visible: boolean
	interpolator?: CoordinateInterpolator
	readonly coordinate: {
		hover: EquatorialCoordinate & Point
		selected: EquatorialCoordinate & Point & { show: boolean; distance: Angle }
	}
}

const isMousePresent = isMouseDeviceSupported()

const stateMap = new Map<string, ImageMouseCoordinateState>()

export const ImageMouseCoordinateMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const solver = use(ImageSolverMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<ImageMouseCoordinateState>({
			visible: false,
			coordinate: {
				hover: {
					rightAscension: 0,
					declination: 0,
					x: 0,
					y: 0,
				},
				selected: {
					show: false,
					rightAscension: 0,
					declination: 0,
					x: 0,
					y: 0,
					distance: 0,
				},
			},
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = subscribeKey(state, 'visible', (visible) => {
			if (visible) void compute()
		})

		unsubscribers[1] = bus.subscribe<ImageLoaded>('image:load', ({ image, info, newImage }) => {
			if (newImage && image.key === key) {
				if (info.solution && state.visible) void compute(info.solution, true)
				else state.interpolator = undefined
			}
		})

		unsubscribers[2] = bus.subscribe<ImageSolved>('image:solved', ({ image, solution }) => {
			if (image.key === key) {
				if (state.visible) void compute(solution, true)
				else state.interpolator = undefined
			}
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	async function compute(solution: PlateSolution | undefined = solver.state.solution, force: boolean = false) {
		if ((!state.interpolator || force) && solution?.scale) {
			const coordinateInterpolation = await Api.Image.coordinateInterpolation(solution)

			if (coordinateInterpolation) {
				const { ma, md, x0, y0, x1, y1, delta } = coordinateInterpolation
				state.interpolator = ref(new CoordinateInterpolator(ma, md, x0, y0, x1, y1, delta))
			} else {
				return
			}
		}
	}

	function toggle() {
		state.visible = !state.visible
	}

	function handleInterpolatedCoordinate(x: number, y: number, clicked: boolean = false) {
		const { interpolator, coordinate } = state

		if (interpolator) {
			// Is pointer up event?
			if (clicked) {
				if (coordinate.selected.show) {
					const d = Math.hypot(x - coordinate.selected.x, y - coordinate.selected.y)

					// Unselect if inside selected coordinate radius
					if (d <= 8) {
						coordinate.selected.show = false
						return
					}
				} else if (isMousePresent) {
					coordinate.selected.show = true
				}
			}

			const [rightAscension, declination] = interpolator.interpolate(x, y)

			if (clicked && isMousePresent) {
				coordinate.selected.rightAscension = rightAscension
				coordinate.selected.declination = declination
				coordinate.selected.x = x
				coordinate.selected.y = y
			}

			coordinate.hover.rightAscension = rightAscension
			coordinate.hover.declination = declination
			coordinate.hover.x = x
			coordinate.hover.y = y

			if (isMousePresent && coordinate.selected.show) {
				const { rightAscension: a1, declination: d1 } = coordinate.hover
				const { rightAscension: a2, declination: d2 } = coordinate.selected
				coordinate.selected.distance = Math.acos(Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2))
			}
		}
	}

	function show() {
		state.visible = true
	}

	function hide() {
		state.visible = false
	}

	return { state, viewer, scope: viewer.scope, toggle, handleInterpolatedCoordinate, show, hide } as const
})
