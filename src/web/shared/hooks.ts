import { type MoveMoveEvent, useMove } from '@react-aria/interactions'
import { useMolecule } from 'bunshi/react'
import { useCallback } from 'react'
import { ModalMolecule } from './molecules'

export interface UseDraggableProps {
	name: string
	canOverflow?: boolean
}

export interface DraggableState {
	boundary: {
		minLeft: number
		minTop: number
		maxLeft: number
		maxTop: number
	}
	transform: {
		offsetX: number
		offsetY: number
	}
}

const draggableStateMap = new Map<string, DraggableState>()

// A hook for managing draggable functionality for a modal or any other element.
export function useDraggable({ name, canOverflow }: UseDraggableProps) {
	let targetRef: HTMLElement | undefined

	const state = draggableStateMap.get(name) ?? {
		boundary: {
			minLeft: 0,
			minTop: 0,
			maxLeft: 0,
			maxTop: 0,
		},
		transform: {
			offsetX: 0,
			offsetY: 0,
		},
	}

	// https://github.com/heroui-inc/heroui/blob/canary/packages/hooks/use-draggable/src/index.ts

	// Handles the start of a move event, calculating boundaries based
	// on the current position and size of the target element.
	function onMoveStart() {
		if (!targetRef) return

		const { offsetX, offsetY } = state.transform
		const { left, top, width, height } = targetRef.getBoundingClientRect()
		const { clientWidth, clientHeight } = document.documentElement

		// Calculate the boundaries for the modal based on its position and size
		const paddingWidth = targetRef.clientWidth - 64
		const paddingHeight = targetRef.clientHeight - 64
		state.boundary.minLeft = -left + offsetX - paddingWidth
		state.boundary.minTop = -top + offsetY - paddingHeight
		state.boundary.maxLeft = clientWidth - left - width + offsetX + paddingWidth
		state.boundary.maxTop = clientHeight - top - height + offsetY + paddingHeight
	}

	// Handles the move event, updating the position of the target element
	// based on the delta values from the move event.
	// It also ensures that the element does not overflow its boundaries.
	function onMove(e: MoveMoveEvent) {
		if (!targetRef) return

		let offsetX = state.transform.offsetX + e.deltaX
		let offsetY = state.transform.offsetY + e.deltaY

		if (!canOverflow) {
			const { minLeft, minTop, maxLeft, maxTop } = state.boundary
			offsetX = Math.min(Math.max(offsetX, minLeft), maxLeft)
			offsetY = Math.min(Math.max(offsetY, minTop), maxTop)
		}

		state.transform.offsetX = offsetX
		state.transform.offsetY = offsetY
		targetRef.style.transform = `translate(${offsetX}px, ${offsetY}px)`
	}

	// Handles the end of a move event, saving the current state of the draggable
	// element so that it can be restored later if needed.
	function onMoveEnd() {
		if (!targetRef) return

		draggableStateMap.set(name, state)
	}

	// Sets the reference to the target element and applies the initial transform.
	// It also sets the z-index of the parent element to ensure it is on top.
	function ref(node: HTMLElement | null) {
		if (node && node !== targetRef) {
			targetRef = node
			targetRef.style.transform = `translate(${state.transform.offsetX}px, ${state.transform.offsetY}px)`
		}
	}

	return { onMoveStart, onMove, onMoveEnd, ref }
}

// A hook for managing a modal with draggable functionality.
export function useModal(onClose?: () => void) {
	const modal = useMolecule(ModalMolecule)
	const draggable = useDraggable(modal.scope)

	const onMoveStart = useCallback(() => {
		modal.onMoveStart()
		draggable.onMoveStart()
	}, [modal, draggable])

	const move = useMove({ onMoveStart, onMove: draggable.onMove, onMoveEnd: draggable.onMoveEnd })

	const ref = useCallback(
		(node: HTMLElement | null) => {
			modal.props.ref(node)
			draggable.ref(node)
		},
		[modal, draggable],
	)

	const onOpenChange = useCallback(
		(isOpen: boolean) => {
			modal.props.onOpenChange(isOpen)
			if (!isOpen && onClose) onClose()
		},
		[modal, onClose],
	)

	const moveProps = { ...move.moveProps, style: { cursor: 'move' } }

	return { props: { ...modal.props, ref, onOpenChange }, moveProps }
}
