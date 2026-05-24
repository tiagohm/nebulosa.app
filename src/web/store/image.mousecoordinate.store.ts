import type { Angle } from 'nebulosa/src/angle'
import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import type { Point } from 'nebulosa/src/geometry'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import bus from 'src/shared/bus'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '../shared/api'
import { CoordinateInterpolator } from '../shared/coordinate-interpolation'
import type { ImageLoaded } from '../shared/types'
import { isMousePresent } from '../shared/util'
import type { InteractableProps, InteractTransform } from '../ui/Interactable'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageMouseCoordinateStore = ReturnType<typeof imageMouseCoordinateStore>

export interface ImageMouseCoordinateState {
	visible: boolean
	interpolator?: CoordinateInterpolator
	readonly coordinate: {
		hover: EquatorialCoordinate & Point
		selected: EquatorialCoordinate & Point & { show: boolean; distance: Angle }
	}
}

export function imageMouseCoordinateStore(viewer: ImageViewerStore) {
	const state = proxy<ImageMouseCoordinateState>({
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

	console.info('image mouse coordinate created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('image mouse coordinate mounted:', viewer.state.path)

		mounted = true

		u[0] = bus.subscribe<ImageLoaded>('image:load', ({ image, info, refreshed }) => {
			if (refreshed && image.id === viewer.image.id) {
				if (info.solution && state.visible) void compute(info.solution, true)
				else state.interpolator = undefined
			}
		})

		u[1] = subscribeKey(viewer.solver.state, 'solution', (solution) => {
			if (state.visible) void compute(solution, true)
			else state.interpolator = undefined
		})
	}

	function unmount() {
		if (!mounted) return
		console.info('image mouse coordinate unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	async function compute(solution: PlateSolution | undefined = viewer.solver.state.solution, force: boolean = false) {
		if ((!state.interpolator || force) && solution?.scale) {
			const coordinateInterpolation = await Api.Image.coordinateInterpolation(solution)

			if (coordinateInterpolation) {
				const { ma, md, x0, y0, x1, y1, delta } = coordinateInterpolation
				state.interpolator = ref(new CoordinateInterpolator(new Float32Array(ma), new Float32Array(md), x0, y0, x1, y1, delta))
			}
		}
	}

	function toggle() {
		state.visible = !state.visible
	}

	function handleInterpolatedCoordinate(x: number, y: number, clicked: boolean = false) {
		const { interpolator, coordinate } = state

		if (interpolator) {
			const [rightAscension, declination] = interpolator.interpolate(x, y)

			if (clicked) {
				coordinate.selected.rightAscension = rightAscension
				coordinate.selected.declination = declination
				coordinate.selected.x = x
				coordinate.selected.y = y
				coordinate.selected.show = true
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

	function handleGesture({ scale, angle }: InteractTransform) {
		if (viewer.state.scale !== scale) viewer.state.scale = scale
		if (viewer.state.angle !== angle) viewer.state.angle = angle
	}

	function handleClick({ event, dragging, pinching }: Parameters<NonNullable<InteractableProps['onClick']>>[0]) {
		if (!state.visible || dragging || pinching) return
		handleInterpolatedCoordinate(event.offsetX, event.offsetY, true)
	}

	function handleMouseMove({ event, dragging, pinching }: Parameters<NonNullable<InteractableProps['onMouseMove']>>[0]) {
		if (!state.visible || dragging || pinching) return
		handleInterpolatedCoordinate(event.offsetX, event.offsetY, false)
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
		toggle,
		handleInterpolatedCoordinate,
		handleGesture,
		handleClick,
		handleMouseMove,
		show,
		hide,
	} as const
}
