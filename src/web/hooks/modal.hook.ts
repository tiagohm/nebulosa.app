import { zIndexStore } from '@stores/zindex.store'
import { createUseGesture, dragAction } from '@use-gesture/react'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import { useCallback, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

// Better tree shaking with createUseGesture
const useGesture = createUseGesture([dragAction])

const MIN_VISIBLE_SIZE = 128
const DEFAULT_MODAL_WIDTH = 480
const GRID_SIZE = 8

const BLOCKED_DRAG_SELECTOR = 'button,a,input,select,textarea,[contenteditable="true"],[role="button"]'

export type ModalOptions = {
	readonly initialWidth?: CSSProperties['width']
}

function canDrag(target: EventTarget | null, modal: HTMLElement) {
	return target instanceof Element && target.closest('.modal') === modal && target.closest(BLOCKED_DRAG_SELECTOR) === null
}

function snapToGrid(pos: number) {
	return Math.round(pos / GRID_SIZE) * GRID_SIZE
}

function defaultPosition(): Point {
	return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

function clampToBoundary(value: number, min: number, max: number) {
	return Math.min(Math.max(snapToGrid(value), min), max)
}

export function useModal(id: string, onHide?: VoidFunction, options: ModalOptions = {}) {
	const modalRef = useRef<HTMLElement>(null)
	const currentId = useRef(id)
	const positionRef = useRef(defaultPosition())
	const boundaryRef = useRef({ minLeft: 0, minTop: 0, maxLeft: 0, maxTop: 0 })
	const draggingRef = useRef(false)
	const previousUserSelect = useRef<string>(undefined)

	if (currentId.current !== id) {
		currentId.current = id
		positionRef.current = defaultPosition()
	}

	const applyTransform = useCallback(() => {
		if (!modalRef.current) return
		modalRef.current.style.transform = `translate(calc(${positionRef.current.x}px - 50%), calc(${positionRef.current.y}px - 50%))`
	}, [])

	const disableBodySelection = useCallback(() => {
		previousUserSelect.current ??= document.body.style.userSelect
		document.body.style.userSelect = 'none'
	}, [])

	const restoreBodySelection = useCallback(() => {
		if (previousUserSelect.current === undefined) return
		document.body.style.userSelect = previousUserSelect.current
		previousUserSelect.current = undefined
	}, [])

	const computeBoundary = useCallback(() => {
		if (!modalRef.current) return

		const { width, height } = modalRef.current.getBoundingClientRect()
		const { clientWidth, clientHeight } = document.documentElement
		const visibleWidth = Math.min(MIN_VISIBLE_SIZE, width, clientWidth)
		const visibleHeight = Math.min(MIN_VISIBLE_SIZE, height, clientHeight)

		// Keep a usable portion of the modal visible even when restoring old positions.
		boundaryRef.current.minLeft = visibleWidth - width / 2
		boundaryRef.current.minTop = visibleHeight - height / 2
		boundaryRef.current.maxLeft = clientWidth - visibleWidth + width / 2
		boundaryRef.current.maxTop = clientHeight - visibleHeight + height / 2
	}, [])

	const moveTo = useCallback(
		(x: number, y: number) => {
			positionRef.current.x = clampToBoundary(x, boundaryRef.current.minLeft, boundaryRef.current.maxLeft)
			positionRef.current.y = clampToBoundary(y, boundaryRef.current.minTop, boundaryRef.current.maxTop)
			applyTransform()
		},
		[applyTransform],
	)

	const fitToBoundary = useCallback(() => {
		computeBoundary()
		moveTo(positionRef.current.x, positionRef.current.y)
	}, [computeBoundary, moveTo])

	const bind = useGesture(
		{
			onDragStart: ({ cancel, target }) => {
				if (!modalRef.current || !canDrag(target, modalRef.current)) {
					cancel()
					return
				}

				draggingRef.current = true
				zIndexStore.increment(id, true)
				computeBoundary()
				disableBodySelection()
			},
			onDrag: ({ offset, cancel }) => {
				if (!draggingRef.current || !modalRef.current) {
					cancel()
					restoreBodySelection()
					draggingRef.current = false
					return
				}

				moveTo(offset[0], offset[1])
			},
			onDragEnd: () => {
				if (!draggingRef.current) return
				draggingRef.current = false
				restoreBodySelection()
			},
		},
		{
			drag: {
				from: () => [positionRef.current.x, positionRef.current.y],
				pointer: { buttons: 1 },
			},
		},
	)

	const ref = useCallback(
		(node: HTMLElement | null) => {
			modalRef.current = node
			if (!node) return

			applyTransform()
			fitToBoundary()
			zIndexStore.apply(node, id)
		},
		[applyTransform, fitToBoundary, id, zIndexStore],
	)

	const hide = useCallback(() => {
		draggingRef.current = false
		restoreBodySelection()
		zIndexStore.remove(id)
		onHide?.()
	}, [id, onHide, restoreBodySelection, zIndexStore])

	useEffect(() => {
		zIndexStore.increment(id, true)
		return () => {
			draggingRef.current = false
			restoreBodySelection()
			zIndexStore.remove(id)
		}
	}, [id, restoreBodySelection, zIndexStore])

	const moveProps = { ...bind(), style: { cursor: 'move', touchAction: 'none' } as const }
	const style = { width: options.initialWidth ?? DEFAULT_MODAL_WIDTH } satisfies CSSProperties

	return { ref, hide, moveProps, style, computeBoundary, fitToBoundary }
}
