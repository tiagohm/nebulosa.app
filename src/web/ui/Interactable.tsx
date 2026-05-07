import { createUseGesture, dragAction, type GestureHandlers, pinchAction, wheelAction } from '@use-gesture/react'
import { memo, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { clamp, preventDefault } from '@/shared/util'

export type InteractType = 'drag' | 'pinch' | 'wheel' | 'none'

const MIN_SCALE = 0.1
const MAX_SCALE = 500
const ZOOM_STEPS_PER_DOUBLE = 8
const WHEEL_DELTA_PER_ZOOM_STEP = 100
const WHEEL_LINE_DELTA = 40
const ZOOM_STEP_EPSILON = 1e-10
const MIN_ZOOM_STEP = Math.floor(Math.log2(MIN_SCALE) * ZOOM_STEPS_PER_DOUBLE)
const MAX_ZOOM_STEP = Math.ceil(Math.log2(MAX_SCALE) * ZOOM_STEPS_PER_DOUBLE)

export interface InteractTransform {
	x: number
	y: number
	scale: number
	angle: number
}

export interface InteractableMethods {
	readonly angle: number
	readonly scale: number
	readonly zoomTo: (scale: number) => void
	readonly center: () => void
	readonly rotateTo: (angle: number) => void
	readonly startRotation: () => void
	readonly stopRotation: () => void
}

export interface InteractableProps extends Omit<GestureHandlers, 'onDragStart' | 'onDrag' | 'onDragEnd' | 'onPinch' | 'onWheel'> {
	readonly zIndex: number
	readonly onGesture?: (transform: Readonly<InteractTransform>, type: InteractType, event?: Event) => void
	readonly onTap?: (tx: number, ty: number, x: number, y: number, event: React.PointerEvent<HTMLDivElement>) => void
	readonly ref?: React.Ref<InteractableMethods>
	readonly children: React.ReactNode
}

// Better tree shaking with createUseGesture
const useGesture = createUseGesture([dragAction, pinchAction, wheelAction])

let documentGestureListeners = 0

function normalizeAngle(angle: number) {
	return angle === 0 ? 0 : ((angle % 360) + 360) % 360
}

function normalizeScale(scale: number, fallback: number) {
	return Number.isFinite(scale) ? clamp(scale, MIN_SCALE, MAX_SCALE) : fallback
}

function zoomStepFromScale(scale: number, direction: number) {
	const currentScale = normalizeScale(scale, 1)
	const currentStep = Math.log2(currentScale) * ZOOM_STEPS_PER_DOUBLE

	if (direction > 0) return Math.floor(currentStep + ZOOM_STEP_EPSILON)
	if (direction < 0) return Math.ceil(currentStep - ZOOM_STEP_EPSILON)
	return Math.round(currentStep)
}

function zoomScaleBySteps(scale: number, steps: number, currentStep?: number) {
	if (steps === 0) return { scale, step: currentStep }

	const step = Math.trunc(clamp((currentStep ?? zoomStepFromScale(scale, steps)) + steps, MIN_ZOOM_STEP, MAX_ZOOM_STEP))

	return { scale: normalizeScale(2 ** (step / ZOOM_STEPS_PER_DOUBLE), normalizeScale(scale, 1)), step }
}

function normalizeWheelDeltaY(deltaY: number, deltaMode: number) {
	if (deltaMode === 1) return deltaY * WHEEL_LINE_DELTA
	if (deltaMode === 2) return deltaY * WHEEL_DELTA_PER_ZOOM_STEP
	return deltaY
}

function addDocumentGestureListeners() {
	if (documentGestureListeners++ === 0) {
		document.addEventListener('gesturestart', preventDefault)
		document.addEventListener('gesturechange', preventDefault)
		document.addEventListener('gestureend', preventDefault)
	}
}

function removeDocumentGestureListeners() {
	documentGestureListeners = Math.max(documentGestureListeners - 1, 0)

	if (documentGestureListeners === 0) {
		document.removeEventListener('gesturestart', preventDefault)
		document.removeEventListener('gesturechange', preventDefault)
		document.removeEventListener('gestureend', preventDefault)
	}
}

export const Interactable = memo(({ ref, zIndex, children, onGesture, onTap, ...handlers }: InteractableProps) => {
	const wrapperRef = useRef<HTMLDivElement>(null)
	const transformation = useRef<InteractTransform>({ x: 0, y: 0, scale: 1, angle: 0 })
	const rotation = useRef(false)
	const bodyUserSelect = useRef<string | undefined>(undefined)
	const wheelZoomDelta = useRef(0)
	const wheelZoomStep = useRef<number | undefined>(undefined)

	const transform = useEffectEvent((type: InteractType, event?: Event) => {
		if (wrapperRef.current) {
			const { x, y, scale, angle } = transformation.current
			wrapperRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale}) rotate(${angle}deg)`
			onGesture?.(transformation.current, type, event)
		}
	})

	useImperativeHandle(
		ref,
		() => ({
			get angle() {
				return transformation.current.angle
			},
			get scale() {
				return transformation.current.scale
			},
			zoomTo: (scale: number) => {
				const nextScale = normalizeScale(scale, transformation.current.scale)

				if (nextScale !== transformation.current.scale) {
					transformation.current.scale = nextScale
					wheelZoomStep.current = undefined
					transform('none')
				}
			},
			rotateTo: (angle) => {
				if (!Number.isFinite(angle)) return

				angle = normalizeAngle(angle)

				if (angle !== transformation.current.angle) {
					transformation.current.angle = angle
					transform('none')
				}
			},
			startRotation: () => {
				rotation.current = true
			},
			stopRotation: () => {
				rotation.current = false
			},
			center: () => {
				const parent = wrapperRef.current?.parentElement

				if (parent) {
					const { clientWidth: ix, clientHeight: iy } = wrapperRef.current!

					if (ix > 0 && iy > 0) {
						const { clientWidth: px, clientHeight: py } = parent

						transformation.current.x = (px - ix) / 2
						transformation.current.y = (py - iy) / 2
						transform('none')
					}
				}
			},
		}),
		[],
	)

	// Prevent default gesture events to avoid zooming on iOS devices
	// This is necessary to ensure that pinch and drag gestures work as expected
	// without triggering the browser's default zoom behavior.
	useLayoutEffect(() => {
		addDocumentGestureListeners()

		return () => {
			removeDocumentGestureListeners()
			restoreBodyUserSelect()
		}
	}, [])

	function disableBodyUserSelect() {
		bodyUserSelect.current ??= document.body.style.userSelect
		document.body.style.userSelect = 'none'
	}

	function restoreBodyUserSelect() {
		if (bodyUserSelect.current !== undefined) {
			document.body.style.userSelect = bodyUserSelect.current
			bodyUserSelect.current = undefined
		}
	}

	function handleTap(event: React.PointerEvent<HTMLDivElement>) {
		if (onTap) {
			const target = event.target as HTMLElement
			const rect = target.getBoundingClientRect()
			const tx = Math.trunc((event.clientX - rect.x) / transformation.current.scale)
			const ty = Math.trunc((event.clientY - rect.y) / transformation.current.scale)

			onTap(tx, ty, event.clientX, event.clientY, event)
		}
	}

	function consumeWheelZoomSteps(deltaY: number) {
		if (deltaY === 0) return 0

		const direction = Math.sign(deltaY)

		if (Math.sign(wheelZoomDelta.current) !== direction) {
			wheelZoomDelta.current = 0
		}

		// Small trackpad deltas use the same fixed zoom ladder as mouse-wheel notches.
		wheelZoomDelta.current += deltaY

		if (Math.abs(wheelZoomDelta.current) < WHEEL_DELTA_PER_ZOOM_STEP) return 0

		wheelZoomDelta.current = 0

		return -direction
	}

	useGesture(
		{
			...handlers,
			onDragStart: () => {
				// Disable text selection during drag event
				disableBodyUserSelect()
			},
			onDrag: ({ event, pinching, cancel, delta, movement, offset, tap, memo }) => {
				if (pinching || tap) return cancel()

				const { scale } = transformation.current

				if (memo === undefined) {
					if (!wrapperRef.current) return memo

					const { offsetX, offsetY } = event as PointerEvent

					if (rotation.current) {
						memo = [offsetX, offsetY, true, transformation.current.angle]
					}
				}

				if (memo !== undefined && memo[2] === true) {
					const [x, y] = memo
					const wrapper = wrapperRef.current

					if (!wrapper) return memo

					const { clientWidth, clientHeight } = wrapper
					const cx = clientWidth / 2
					const cy = clientHeight / 2
					const v0x = x - cx
					const v0y = y - cy
					const v1x = x + movement[0] / scale - cx
					const v1y = y + movement[1] / scale - cy
					const cross = v0x * v1y - v0y * v1x
					const dot = v0x * v1x + v0y * v1y
					const angle = Math.atan2(cross, dot)
					transformation.current.angle = normalizeAngle(Math.trunc((memo[3] + angle * (180 / Math.PI)) * 10) / 10) // multiple of 0.1x
				} else {
					transformation.current.x = offset[0]
					transformation.current.y = offset[1]
				}

				transform('drag', event)

				return memo
			},
			onDragEnd: () => {
				// Re-enable text selection after dragging
				restoreBodyUserSelect()

				rotation.current = false
			},
			onPinch: ({ event, origin: [ox, oy], first, offset: [s], memo }) => {
				const nextScale = normalizeScale(s, transformation.current.scale)

				if (first) {
					const wrapper = wrapperRef.current

					if (!wrapper) return memo

					const rect = wrapper.getBoundingClientRect()
					const tx = ox - (rect.x + rect.width / 2)
					const ty = oy - (rect.y + rect.height / 2)
					memo = [transformation.current.x, transformation.current.y, tx, ty, nextScale] // Store initial position and scale
				}

				// Calculate the position offset based on
				// the distance from pinch origin to element center (memo[2] and memo[3])
				// and the relative scale change (1 - nextScale/memo[4])
				const dx = memo[2] * (1 - nextScale / memo[4])
				const dy = memo[3] * (1 - nextScale / memo[4])

				transformation.current.scale = nextScale
				wheelZoomStep.current = undefined
				transformation.current.x = memo[0] + dx
				transformation.current.y = memo[1] + dy

				transform('pinch', event)

				return memo
			},
			onWheel: ({ event, delta }) => {
				if (event.ctrlKey) return

				const deltaY = normalizeWheelDeltaY(delta[1], event.deltaMode)

				if (event.shiftKey && deltaY) {
					wheelZoomDelta.current = 0
					wheelZoomStep.current = undefined

					const { angle } = transformation.current
					const increment = event.altKey ? 0.1 : 1
					transformation.current.angle = deltaY < 0 ? (angle + increment) % 360 : (angle + 360 - increment) % 360
					transform('wheel', event)
					return
				}

				const zoomSteps = consumeWheelZoomSteps(deltaY)

				if (zoomSteps === 0) return

				const wrapper = wrapperRef.current

				if (!wrapper) return

				const rect = wrapper.getBoundingClientRect()
				const ox = event.clientX
				const oy = event.clientY

				// Calculate distance from cursor to element center
				const tx = ox - (rect.x + rect.width / 2)
				const ty = oy - (rect.y + rect.height / 2)

				// Calculate new scale (zoom in/out based on wheel direction)
				const currentScale = transformation.current.scale
				const { scale: newScale, step: nextZoomStep } = zoomScaleBySteps(currentScale, zoomSteps, wheelZoomStep.current)

				if (newScale === currentScale) return

				wheelZoomStep.current = nextZoomStep

				// Calculate position offset to maintain zoom point
				const f = 1 - newScale / currentScale
				const dx = tx * f
				const dy = ty * f

				transformation.current.scale = newScale
				transformation.current.x += dx
				transformation.current.y += dy

				transform('wheel', event)
			},
		},
		{
			target: wrapperRef,
			drag: {
				from: () => [transformation.current.x, transformation.current.y],
				pointer: { mouse: true }, // Enable mouse dragging
				button: 0, // Left mouse button
				filterTaps: true, // Ignore taps
			},
			pinch: {
				from: () => [transformation.current.scale, transformation.current.angle],
				scaleBounds: { min: MIN_SCALE, max: MAX_SCALE },
				rubberband: true,
			},
		},
	)

	return (
		<div className="wrapper absolute inline-block cursor-crosshair active:cursor-grabbing" onPointerUp={handleTap} ref={wrapperRef} style={{ zIndex }}>
			{children}
		</div>
	)
})
