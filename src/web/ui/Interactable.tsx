import { createUseGesture, dragAction, pinchAction, wheelAction } from '@use-gesture/react'

import { useLayoutEffect, useRef } from 'react'
import { preventDefault } from '@/shared/util'

export type InteractType = 'drag' | 'pinch' | 'wheel'

export interface InteractTransform {
	x: number
	y: number
	scale: number
	angle: number
}

export interface InteractableProps {
	readonly zIndex: number
	readonly onGesture?: (transform: Readonly<InteractTransform>, type: InteractType, event: Event) => void
	readonly onTap?: (tx: number, ty: number, x: number, y: number, event: React.PointerEvent<HTMLDivElement>) => void
	readonly children: React.ReactNode[]
}

// Better tree shaking with createUseGesture
const useGesture = createUseGesture([dragAction, pinchAction, wheelAction])

export function Interactable({ zIndex, children, onGesture, onTap }: InteractableProps) {
	const ref = useRef<HTMLDivElement>(null)
	const transformation = useRef<InteractTransform>({ x: 0, y: 0, scale: 1, angle: 0 })

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

	function transform(type: InteractType, event: Event) {
		if (ref.current) {
			const { x, y, scale, angle } = transformation.current
			ref.current.style.transform = `translate(${x}px, ${y}px) scale(${scale}) rotate(${angle}deg)`
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
			onDragStart: () => {
				// Disable text selection during drag
				document.body.style.userSelect = 'none'
			},
			onDrag: ({ event, pinching, cancel, offset, tap }) => {
				if (pinching || tap) return cancel()

				transformation.current.x = offset[0]
				transformation.current.y = offset[1]

				transform('drag', event)
			},
			onDragEnd: () => {
				// Re-enable text selection after dragging
				document.body.style.userSelect = ''
			},
			onPinch: ({ event, origin: [ox, oy], first, offset: [s, a], memo }) => {
				if (first) {
					const rect = ref.current!.getBoundingClientRect()
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
				const rect = ref.current!.getBoundingClientRect()
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
			target: ref,
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
		<div className='inline-block absolute wrapper cursor-crosshair active:cursor-grabbing' onPointerUp={handleTap} ref={ref} style={{ zIndex }}>
			{children}
		</div>
	)
}
