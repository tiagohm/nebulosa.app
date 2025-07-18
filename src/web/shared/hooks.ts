import { createUseGesture, dragAction } from '@use-gesture/react'
import { useMolecule } from 'bunshi/react'
import { useCallback, useEffect, useRef } from 'react'
import { ZIndexMolecule } from '@/molecules/zindex'
import { simpleLocalStorage } from './storage'

// Better tree shaking with createUseGesture
const useGesture = createUseGesture([dragAction])

const modalTransformMap = new Map<string, { x: number; y: number }>()

// A hook for managing a modal with draggable functionality.
export function useModal(name: string, onClose?: VoidFunction) {
	const zIndex = useMolecule(ZIndexMolecule)
	const modalRef = useRef<HTMLElement>(null)
	const xy = useRef(modalTransformMap.get(name) ?? simpleLocalStorage.get(`modal-${name}`, () => ({ x: 0, y: 0 })))
	const boundary = useRef({ minLeft: 0, minTop: 0, maxLeft: 0, maxTop: 0 })

	// Initialize the position of the modal if it doesn't exist in the map
	modalTransformMap.set(name, xy.current)

	const bind = useGesture(
		{
			onDragStart: () => {
				if (!modalRef.current) return

				zIndex.increment(name, true)

				const { x, y } = xy.current
				const { left, top, width, height } = modalRef.current.getBoundingClientRect()
				const { clientWidth, clientHeight } = document.documentElement

				// Calculate the boundaries for the modal based on its position and size
				const remainingWidth = modalRef.current.clientWidth - 64
				const remainingHeight = modalRef.current.clientHeight - 64
				boundary.current.minLeft = -left + x - remainingWidth
				boundary.current.minTop = -top + y - remainingHeight
				boundary.current.maxLeft = clientWidth - left - width + x + remainingWidth
				boundary.current.maxTop = clientHeight - top - height + y + remainingHeight

				// Disable text selection while dragging
				document.body.style.userSelect = 'none'
			},
			onDrag: ({ offset, cancel }) => {
				if (!modalRef.current) return cancel()

				xy.current.x = Math.min(Math.max(offset[0], boundary.current.minLeft), boundary.current.maxLeft)
				xy.current.y = Math.min(Math.max(offset[1], boundary.current.minTop), boundary.current.maxTop)

				modalRef.current.style.transform = `translate(${xy.current.x}px, ${xy.current.y}px)`
			},
			onDragEnd: () => {
				// Re-enable text selection after dragging
				document.body.style.userSelect = ''

				// Save the modal position to local storage
				simpleLocalStorage.set(`modal-${name}`, xy.current)
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
			zIndex.apply(modalRef.current, name)
		}
	}, [])

	const close = useCallback(() => {
		zIndex.remove(name)
		onClose?.()
	}, [])

	useEffect(() => {
		zIndex.increment(name, true)
	}, [])

	const moveProps = { ...bind(), style: { cursor: 'move' } }

	return { ref, close, moveProps }
}
