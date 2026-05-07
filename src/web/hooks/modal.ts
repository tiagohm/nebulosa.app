import { createUseGesture, dragAction } from '@use-gesture/react'
import { useMolecule } from 'bunshi/react'
import type { Point } from 'nebulosa/src/geometry'
import { useCallback, useEffect, useRef } from 'react'
import { ZIndexMolecule } from '@/molecules/zindex'
import { storageGet, storageSet } from '@/shared/storage'

// Better tree shaking with createUseGesture
const useGesture = createUseGesture([dragAction])

const MIN_VISIBLE_SIZE = 128
const GRID_SIZE = 8

const BLOCKED_DRAG_SELECTOR = 'button,a,input,select,textarea,[contenteditable="true"]'

const modalTransformMap = new Map<string, Point>()

function canDrag(target: EventTarget | null) {
	return target instanceof Element && target.closest('.modal') !== null && target.closest(BLOCKED_DRAG_SELECTOR) === null
}

function snapToGrid(pos: number) {
	return Math.round(pos / GRID_SIZE) * GRID_SIZE
}

function positionStorageKey(id: string) {
	return `modal-${id}`
}

function defaultPosition(): Point {
	return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

function isPoint(value: unknown): value is Point {
	if (typeof value !== 'object' || value === null) return false

	const point = value as Partial<Point>
	return typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)
}

function loadPosition(id: string) {
	const cached = modalTransformMap.get(id)
	if (cached !== undefined) return cached

	const fallback = defaultPosition()

	try {
		const stored = storageGet<unknown>(positionStorageKey(id), fallback)
		const position = isPoint(stored) ? stored : fallback
		modalTransformMap.set(id, position)
		return position
	} catch {
		modalTransformMap.set(id, fallback)
		return fallback
	}
}

function clampToBoundary(value: number, min: number, max: number) {
	return Math.min(Math.max(snapToGrid(value), min), max)
}

export function useModal(id: string, onHide?: VoidFunction) {
	const zIndex = useMolecule(ZIndexMolecule)
	const modalRef = useRef<HTMLElement>(null)
	const currentId = useRef(id)
	const xy = useRef(loadPosition(id))
	const boundary = useRef({ minLeft: 0, minTop: 0, maxLeft: 0, maxTop: 0 })
	const isDragging = useRef(false)
	const previousUserSelect = useRef<string>(undefined)

	if (currentId.current !== id) {
		currentId.current = id
		xy.current = loadPosition(id)
	}

	const applyTransform = useCallback(() => {
		if (!modalRef.current) return
		modalRef.current.style.transform = `translate(calc(${xy.current.x}px - 50%), calc(${xy.current.y}px - 50%))`
	}, [])

	const restoreBodySelection = useCallback(() => {
		if (previousUserSelect.current === undefined) return
		document.body.style.userSelect = previousUserSelect.current
		previousUserSelect.current = undefined
	}, [])

	const savePosition = useCallback(() => {
		try {
			storageSet(positionStorageKey(id), xy.current)
		} catch {
			// Modal position persistence should never block closing or dragging.
		}
	}, [id])

	const computeBoundary = useCallback(() => {
		if (!modalRef.current) return

		const { width, height } = modalRef.current.getBoundingClientRect()
		const { clientWidth, clientHeight } = document.documentElement
		const visibleWidth = Math.min(MIN_VISIBLE_SIZE, width, clientWidth)
		const visibleHeight = Math.min(MIN_VISIBLE_SIZE, height, clientHeight)

		// Keep a usable portion of the modal visible even when restoring old positions.
		boundary.current.minLeft = visibleWidth - width / 2
		boundary.current.minTop = visibleHeight - height / 2
		boundary.current.maxLeft = clientWidth - visibleWidth + width / 2
		boundary.current.maxTop = clientHeight - visibleHeight + height / 2
	}, [])

	const moveTo = useCallback(
		(x: number, y: number) => {
			xy.current.x = clampToBoundary(x, boundary.current.minLeft, boundary.current.maxLeft)
			xy.current.y = clampToBoundary(y, boundary.current.minTop, boundary.current.maxTop)
			applyTransform()
		},
		[applyTransform],
	)

	const fitToBoundary = useCallback(() => {
		computeBoundary()
		moveTo(xy.current.x, xy.current.y)
	}, [computeBoundary, moveTo])

	const bind = useGesture(
		{
			onDragStart: (event) => {
				if (!modalRef.current || !canDrag(event.target)) return

				isDragging.current = true
				zIndex.increment(id, true)
				computeBoundary()

				previousUserSelect.current ??= document.body.style.userSelect
				document.body.style.userSelect = 'none'
			},
			onDrag: ({ offset, cancel }) => {
				if (!isDragging.current || !modalRef.current) {
					cancel()
					restoreBodySelection()
					isDragging.current = false
					return
				}

				moveTo(offset[0], offset[1])
			},
			onDragEnd: () => {
				if (!isDragging.current) return
				isDragging.current = false
				restoreBodySelection()
				savePosition()
			},
		},
		{
			drag: {
				from: () => [xy.current.x, xy.current.y],
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
			zIndex.apply(node, id)
		},
		[applyTransform, fitToBoundary, id, zIndex],
	)

	const hide = useCallback(() => {
		isDragging.current = false
		restoreBodySelection()
		zIndex.remove(id)
		onHide?.()
	}, [id, onHide, restoreBodySelection, zIndex])

	useEffect(() => {
		zIndex.increment(id, true)
		return () => {
			isDragging.current = false
			restoreBodySelection()
			zIndex.remove(id)
		}
	}, [id, restoreBodySelection, zIndex])

	useEffect(() => {
		window.addEventListener('resize', fitToBoundary)
		return () => {
			window.removeEventListener('resize', fitToBoundary)
		}
	}, [fitToBoundary])

	const moveProps = { ...bind(), style: { cursor: 'move', touchAction: 'none' } as const }

	return { ref, hide, moveProps, computeBoundary, fitToBoundary }
}
