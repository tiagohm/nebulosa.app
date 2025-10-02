import { createUseGesture, dragAction } from '@use-gesture/react'
import { useMolecule } from 'bunshi/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ZIndexMolecule } from '@/molecules/zindex'
import { storage } from './storage'

// Better tree shaking with createUseGesture
const useGesture = createUseGesture([dragAction])

const modalTransformMap = new Map<string, { x: number; y: number }>()

function canDrag(target: EventTarget | null) {
	return target instanceof HTMLElement && (target.closest('.modal') !== null || target.closest('#root'))
}

export function useModal(id: string, onHide?: VoidFunction) {
	const zIndex = useMolecule(ZIndexMolecule)
	const modalRef = useRef<HTMLElement>(null)
	const xy = useRef(modalTransformMap.get(id) ?? storage.get(`modal-${id}`, () => ({ x: 0, y: 0 })))
	const boundary = useRef({ minLeft: 0, minTop: 0, maxLeft: 0, maxTop: 0 })

	// Initialize the position of the modal if it doesn't exist in the map
	modalTransformMap.set(id, xy.current)

	function computeBoundary() {
		if (!modalRef.current) return

		const { x, y } = xy.current
		const { left, top, width, height } = modalRef.current.getBoundingClientRect()
		const { clientWidth, clientHeight } = document.documentElement

		// Calculate the boundaries for the modal based on its position and size
		const remainingWidth = modalRef.current.clientWidth - 128
		const remainingHeight = modalRef.current.clientHeight - 128
		boundary.current.minLeft = -left + x - remainingWidth
		boundary.current.minTop = -top + y - remainingHeight
		boundary.current.maxLeft = clientWidth - left - width + x + remainingWidth
		boundary.current.maxTop = clientHeight - top - height + y + remainingHeight
	}

	function fitToBoundary() {
		xy.current.x = Math.min(Math.max(xy.current.x, boundary.current.minLeft), boundary.current.maxLeft)
		xy.current.y = Math.min(Math.max(xy.current.y, boundary.current.minTop), boundary.current.maxTop)
	}

	const bind = useGesture(
		{
			onDragStart: (event) => {
				if (!modalRef.current || !canDrag(event.target)) return

				zIndex.increment(id, true)

				computeBoundary()

				// Disable text selection while dragging
				document.body.style.userSelect = 'none'
			},
			onDrag: ({ event, offset, cancel }) => {
				if (!modalRef.current || !canDrag(event.target)) return cancel()

				xy.current.x = Math.min(Math.max(offset[0], boundary.current.minLeft), boundary.current.maxLeft)
				xy.current.y = Math.min(Math.max(offset[1], boundary.current.minTop), boundary.current.maxTop)

				modalRef.current.style.transform = `translate(${xy.current.x}px, ${xy.current.y}px)`
			},
			onDragEnd: () => {
				// Re-enable text selection after dragging
				document.body.style.userSelect = ''

				// Save the modal position to local storage
				storage.set(`modal-${id}`, xy.current)
			},
		},
		{
			drag: {
				from: () => [xy.current.x, xy.current.y],
				pointer: { mouse: true }, // Enable mouse dragging
				button: 0, // Left mouse button
			},
		},
	)

	const ref = useCallback((node: HTMLElement | null) => {
		if (node) {
			modalRef.current = node

			// Set the initial position of the modal based on the stored values
			modalRef.current.style.transform = `translate(${xy.current.x}px, ${xy.current.y}px)`

			// Set the z-index of the modal
			zIndex.apply(modalRef.current, id)
		}
	}, [])

	const hide = useCallback(() => {
		zIndex.remove(id)
		onHide?.()
	}, [])

	useEffect(() => {
		zIndex.increment(id, true)
	}, [])

	const moveProps = { ...bind(), style: { cursor: 'move' } }

	return { ref, hide, moveProps, computeBoundary, fitToBoundary }
}

// Hook to manage the Wake Lock API
export function useWakeLock() {
	const [active, setActive] = useState(false)
	const wakeLock = useRef<WakeLockSentinel | null>(null)

	const request = async () => {
		try {
			wakeLock.current = await navigator.wakeLock.request('screen')
			setActive(true)

			wakeLock.current.addEventListener('release', () => {
				setActive(false)
				wakeLock.current = null
			})
		} catch (e) {
			console.error('wake Lock request failed:', e)
			setActive(false)
		}
	}

	const release = () => {
		if (wakeLock.current) {
			wakeLock.current.release()
			wakeLock.current = null
			setActive(false)
		}
	}

	// Reacquire wake lock if the app regains visibility
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (wakeLock.current && document.visibilityState === 'visible') {
				void request()
			}
		}

		document.addEventListener('visibilitychange', handleVisibilityChange)

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange)
			release()
		}
	}, [])

	return { active, request, release }
}
