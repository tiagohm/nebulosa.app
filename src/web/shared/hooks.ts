import { type UseDisclosureProps, useDisclosure } from '@heroui/react'
import type { MoveMoveEvent } from '@react-aria/interactions'
import { useMove } from '@react-aria/interactions'
import { useMolecule } from 'bunshi/react'
import { useCallback, useEffect, useRef } from 'react'
import { ZIndexMolecule } from './molecules'

export interface UseDraggableModalProps extends UseDisclosureProps {
	readonly name: string
	readonly canOverflow?: boolean
}

export interface UseDraggableModalResult {
	readonly name?: string
	readonly isOpen: boolean
	readonly show: () => void
	readonly close: () => void
	readonly onOpenChange: (isOpen: boolean) => void
	readonly targetRef: (node: HTMLElement) => void
	readonly moveProps: React.DOMAttributes<HTMLElement>
	readonly onPointerUp: () => void
}

const transformMap = new Map<string, { offsetX: number; offsetY: number }>()

// A hook for managing a draggable modal
export function useDraggableModal({ name, canOverflow, ...props }: UseDraggableModalProps): UseDraggableModalResult {
	// https://github.com/heroui-inc/heroui/blob/canary/packages/hooks/use-draggable/src/index.ts
	// Modied to use a Map for storing transforms by key
	// This allows to restore their positions correctly when re-mounted.
	const boundary = useRef({ minLeft: 0, minTop: 0, maxLeft: 0, maxTop: 0 })
	let transform = transformMap.get(name) ?? { offsetX: 0, offsetY: 0 }

	const { isOpen, onOpen: show, onOpenChange, onClose: close } = useDisclosure(props)
	const ref = useRef<HTMLElement>(null)
	const zIndex = useMolecule(ZIndexMolecule)

	// Handles the start of a move event, calculating boundaries based
	// on the current position and size of the target element.
	const onMoveStart = useCallback(() => {
		const { offsetX, offsetY } = transform

		const targetRect = ref.current?.getBoundingClientRect()
		const targetLeft = targetRect?.left ?? 0
		const targetTop = targetRect?.top ?? 0
		const targetWidth = targetRect?.width ?? 0
		const targetHeight = targetRect?.height ?? 0

		const { clientWidth, clientHeight } = document.documentElement

		const minLeft = -targetLeft + offsetX
		const minTop = -targetTop + offsetY
		const maxLeft = clientWidth - targetLeft - targetWidth + offsetX
		const maxTop = clientHeight - targetTop - targetHeight + offsetY

		boundary.current = { minLeft, minTop, maxLeft, maxTop }
	}, [transform, ref.current])

	// Handles the move event, updating the position of the target element
	// based on the delta values from the move event.
	// It also ensures that the element does not overflow its boundaries.
	const onMove = useCallback(
		(e: MoveMoveEvent) => {
			if (!isOpen) return

			let offsetX = transform.offsetX + e.deltaX
			let offsetY = transform.offsetY + e.deltaY

			if (!canOverflow) {
				const { minLeft, minTop, maxLeft, maxTop } = boundary.current
				offsetX = Math.min(Math.max(offsetX, minLeft), maxLeft)
				offsetY = Math.min(Math.max(offsetY, minTop), maxTop)
			}

			transform = { offsetX, offsetY }
			transformMap.set(name, transform)

			if (ref.current) {
				ref.current.style.transform = `translate(${offsetX}px, ${offsetY}px)`
			}
		},
		[isOpen, transform, boundary.current, canOverflow, ref.current],
	)

	// Handles the pointer up event, which increments the z-index of the modal
	// to ensure it is on top of other elements.
	// This is useful for ensuring that the modal remains interactive after being dragged.
	const onPointerUp = useCallback(() => {
		zIndex.increment(name)
	}, [name])

	// Effect to manage the z-index of the modal when it opens or closes.
	// When the modal opens, it increments the z-index.
	// When it closes, it removes the transform from the map to reset its position.
	// This ensures that the modal can be re-opened with the same position.
	useEffect(() => {
		if (isOpen) {
			zIndex.increment(name)
		} else {
			transformMap.delete(name)
		}
	}, [isOpen, name])

	// Effect to prevent body scroll when the modal is open on mobile devices.
	useEffect(() => {
		const preventDefault = (e: TouchEvent) => e.preventDefault()

		if (isOpen) {
			// Prevent body scroll when dragging at mobile.
			document.body.addEventListener('touchmove', preventDefault, { passive: false })
		}

		return () => {
			document.body.removeEventListener('touchmove', preventDefault)
		}
	}, [isOpen])

	// A ref to the target element that will be draggable.
	// It is used to apply styles and manage the position of the modal.
	// The targetRef is set to the parent element of the modal to ensure
	// that the z-index is applied correctly.
	const targetRef = useCallback((node: HTMLElement) => {
		if (node && ref.current !== node) {
			ref.current = node

			if (node.parentElement) {
				node.parentElement.style.zIndex = `var(--z-index-${name}) !important`
			}
		}
	}, [])

	//  The moveProps are used to bind the move interaction to the target element.
	const move = useMove({ onMoveStart, onMove })

	const moveProps = {
		...move.moveProps,
		style: { cursor: isOpen ? 'move' : undefined },
	}

	return { name, isOpen, show, close, onOpenChange, targetRef, moveProps, onPointerUp }
}
