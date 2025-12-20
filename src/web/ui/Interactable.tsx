import { createUseGesture, dragAction, type GestureHandlers, pinchAction, wheelAction } from '@use-gesture/react'
import { memo, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { preventDefault } from '@/shared/util'

export type InteractType = 'drag' | 'pinch' | 'wheel' | 'none'

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

function normalizeAngle(angle: number) {
	return angle === 0 ? 0 : ((angle % 360) + 360) % 360
}

export const Interactable = memo(({ ref, zIndex, children, onGesture, onTap, ...handlers }: InteractableProps) => {
	const wrapperRef = useRef<HTMLDivElement>(null)
	const transformation = useRef<InteractTransform>({ x: 0, y: 0, scale: 1, angle: 0 })
	const rotation = useRef(false)

	useImperativeHandle(ref, () => {
		return {
			get angle() {
				return transformation.current.angle
			},
			get scale() {
				return transformation.current.scale
			},
			zoomTo: (scale: number) => {
				transformation.current.scale = scale
				transform('none')
			},
			rotateTo: (angle) => {
				transformation.current.angle = normalizeAngle(angle)
				transform('none')
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
						const { scale } = transformation.current

						transformation.current.x = ((px - ix) / 2) * scale
						transformation.current.y = ((py - iy) / 2) * scale
						transform('none')
					}
				}
			},
		}
	}, [])

	// Prevent default gesture events to avoid zooming on iOS devices
	// This is necessary to ensure that pinch and drag gestures work as expected
	// without triggering the browser's default zoom behavior.
	useLayoutEffect(() => {
		document.addEventListener('gesturestart', preventDefault)
		document.addEventListener('gesturechange', preventDefault)
		document.addEventListener('gestureend', preventDefault)

		return () => {
			document.removeEventListener('gesturestart', preventDefault)
			document.removeEventListener('gesturechange', preventDefault)
			document.removeEventListener('gestureend', preventDefault)
		}
	}, [])

	function transform(type: InteractType, event?: Event) {
		if (wrapperRef.current) {
			const { x, y, scale, angle } = transformation.current
			wrapperRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale}) rotate(${angle}deg)`
			onGesture?.(transformation.current, type, event)
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

	useGesture(
		{
			...handlers,
			onDragStart: () => {
				// Disable text selection during drag event
				document.body.style.userSelect = 'none'
			},
			onDrag: ({ event, pinching, cancel, delta, movement, offset, tap, memo }) => {
				if (pinching || tap) return cancel()

				const { scale } = transformation.current

				if (memo === undefined) {
					const { offsetX, offsetY } = event as PointerEvent

					if (rotation.current) {
						memo = [offsetX, offsetY, true, transformation.current.angle]
					}
				}

				if (memo !== undefined && memo[2] === true) {
					const [x, y] = memo
					const { clientWidth, clientHeight } = wrapperRef.current!
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
				document.body.style.userSelect = ''

				rotation.current = false
			},
			onPinch: ({ event, origin: [ox, oy], first, offset: [s, a], memo }) => {
				if (first) {
					const rect = wrapperRef.current!.getBoundingClientRect()
					const tx = ox - (rect.x + rect.width / 2)
					const ty = oy - (rect.y + rect.height / 2)
					memo = [transformation.current.x, transformation.current.y, tx, ty, s] // Store initial position and scale
				}

				// Calculate the position offset based on
				// the distance from pinch origin to element center (memo[2] and memo[3])
				// and the relative scale change (1 - s/memo[4])
				const dx = memo[2] * (1 - s / memo[4])
				const dy = memo[3] * (1 - s / memo[4])

				transformation.current.scale = s
				// transform.current.angle = a
				transformation.current.x = memo[0] + dx
				transformation.current.y = memo[1] + dy

				transform('pinch', event)

				return memo
			},
			onWheel: ({ event, delta }) => {
				if (event.ctrlKey) return

				if (event.shiftKey && delta[1]) {
					const { angle } = transformation.current
					const increment = event.altKey ? 0.1 : 1
					transformation.current.angle = delta[1] < 0 ? (angle + increment) % 360 : (angle + 360 - increment) % 360
					transform('wheel', event)
					return
				}

				const rect = wrapperRef.current!.getBoundingClientRect()
				const ox = event.clientX
				const oy = event.clientY

				// Calculate distance from cursor to element center
				const tx = ox - (rect.x + rect.width / 2)
				const ty = oy - (rect.y + rect.height / 2)

				// Calculate new scale (zoom in/out based on wheel direction)
				const newScale = Math.min(Math.max(transformation.current.scale * 0.95 ** (delta[1] / 100), 0.1), 500)

				// Calculate position offset to maintain zoom point
				const f = 1 - newScale / transformation.current.scale
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
			pinch: { scaleBounds: { min: 0.1, max: 500 }, rubberband: true },
		},
	)

	return (
		<div className='inline-block absolute wrapper cursor-crosshair active:cursor-grabbing' onPointerUp={handleTap} ref={wrapperRef} style={{ zIndex }}>
			{children}
		</div>
	)
})
