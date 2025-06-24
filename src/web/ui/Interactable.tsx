import { createUseGesture, dragAction, pinchAction, wheelAction } from '@use-gesture/react'

import { useEffect, useRef } from 'react'
import { preventDefault } from '@/shared/util'

export interface InteractableProps {
	readonly children: React.ReactNode[]
}

// Better tree shaking with createUseGesture
const useGesture = createUseGesture([dragAction, pinchAction, wheelAction])

export function Interactable({ children }: InteractableProps) {
	const ref = useRef<HTMLDivElement>(null)
	const x = useRef(0)
	const y = useRef(0)
	const scale = useRef(1)
	const angle = useRef(0)

	// Prevent default gesture events to avoid zooming on iOS devices
	// This is necessary to ensure that pinch and drag gestures work as expected
	// without triggering the browser's default zoom behavior.
	useEffect(() => {
		document.addEventListener('gesturestart', preventDefault)
		document.addEventListener('gesturechange', preventDefault)
		document.addEventListener('gestureend', preventDefault)

		return () => {
			document.removeEventListener('gesturestart', preventDefault)
			document.removeEventListener('gesturechange', preventDefault)
			document.removeEventListener('gestureend', preventDefault)
		}
	}, [])

	useGesture(
		{
			onDrag: ({ pinching, cancel, offset }) => {
				if (pinching) return cancel()

				x.current = offset[0]
				y.current = offset[1]

				ref.current!.style.transform = `translate(${x.current}px, ${y.current}px) scale(${scale.current}) rotate(${angle.current}deg)`
			},
			onPinch: ({ origin: [ox, oy], first, offset: [s, a], memo }) => {
				if (first) {
					const rect = ref.current!.getBoundingClientRect()
					const tx = ox - (rect.x + rect.width / 2)
					const ty = oy - (rect.y + rect.height / 2)
					memo = [x.current, y.current, tx, ty, s] // Store initial position and scale
				}

				// Calculate the position offset based on
				// the distance from pinch origin to element center (memo[2] and memo[3])
				// and the relative scale change (1 - s/memo[4])
				const dx = memo[2] * (1 - s / memo[4])
				const dy = memo[3] * (1 - s / memo[4])

				scale.current = s
				// angle.current = a
				x.current = memo[0] + dx
				y.current = memo[1] + dy

				ref.current!.style.transform = `translate(${x.current}px, ${y.current}px) scale(${scale.current}) rotate(${angle.current}deg)`

				return memo
			},
			onWheel: ({ event, delta }) => {
				event.preventDefault()

				const rect = ref.current!.getBoundingClientRect()
				const ox = event.clientX
				const oy = event.clientY

				// Calculate distance from cursor to element center
				const tx = ox - (rect.x + rect.width / 2)
				const ty = oy - (rect.y + rect.height / 2)

				// Calculate new scale (zoom in/out based on wheel direction)
				const newScale = Math.min(Math.max(scale.current * 0.95 ** (delta[1] / 100), 0.1), 500)

				// Calculate position offset to maintain zoom point
				const f = 1 - newScale / scale.current
				const dx = tx * f
				const dy = ty * f

				scale.current = newScale
				x.current += dx
				y.current += dy

				ref.current!.style.transform = `translate(${x.current}px, ${y.current}px) scale(${scale.current}) rotate(${angle.current}deg)`
			},
		},
		{
			target: ref,
			drag: {
				from: () => [x.current, y.current],
				pointer: { mouse: true }, // Enable mouse dragging
				button: 0, // Left mouse button
			},
			wheel: { preventDefault: true },
			pinch: { scaleBounds: { min: 0.1, max: 500 }, rubberband: true },
		},
	)

	return (
		<div className='inline-block absolute wrapper cursor-crosshair active:cursor-grabbing' ref={ref}>
			{children}
		</div>
	)
}
