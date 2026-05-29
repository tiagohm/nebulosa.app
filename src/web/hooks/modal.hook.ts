import { createUseGesture, dragAction } from '@use-gesture/react'
import type { Point } from 'nebulosa/src/geometry'
import { useCallback, useEffect, useRef } from 'react'
import { storageGet, storageSet } from '@/shared/storage'
import { zIndexStore } from '@/stores/zindex.store'

// Better tree shaking with createUseGesture
const useGesture = createUseGesture([dragAction])

const MIN_VISIBLE_SIZE = 128
const GRID_SIZE = 8

const BLOCKED_DRAG_SELECTOR = 'button,a,input,select,textarea,[contenteditable="true"],[role="button"]'

const modalTransformMap = new Map<string, Point>()

function canDrag(target: EventTarget | null, modal: HTMLElement) {
	return target instanceof Element && target.closest('.modal') === modal && target.closest(BLOCKED_DRAG_SELECTOR) === null
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

function clonePoint(point: Point): Point {
	return { x: point.x, y: point.y }
}

function isPoint(value: unknown): value is Point {
	if (typeof value !== 'object' || value === null) return false

	const point = value as Partial<Point>
	return typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)
}

function loadPosition(id: string) {
	const cached = modalTransformMap.get(id)
	if (cached !== undefined) return clonePoint(cached)

	const fallback = defaultPosition()

	try {
		const stored = storageGet<unknown>(positionStorageKey(id), fallback)
		const position = isPoint(stored) ? stored : fallback
		modalTransformMap.set(id, clonePoint(position))
		return clonePoint(position)
	} catch {
		modalTransformMap.set(id, clonePoint(fallback))
		return clonePoint(fallback)
	}
}

function clampToBoundary(value: number, min: number, max: number) {
	return Math.min(Math.max(snapToGrid(value), min), max)
}

export function useModal(id: string, onHide?: VoidFunction) {
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
			const position = clonePoint(xy.current)
			modalTransformMap.set(id, position)
			storageSet(positionStorageKey(id), position)
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
			onDragStart: ({ cancel, target }) => {
				if (!modalRef.current || !canDrag(target, modalRef.current)) {
					cancel()
					return
				}

				isDragging.current = true
				zIndexStore.increment(id, true)
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
			zIndexStore.apply(node, id)
		},
		[applyTransform, fitToBoundary, id, zIndexStore],
	)

	const hide = useCallback(() => {
		isDragging.current = false
		restoreBodySelection()
		zIndexStore.remove(id)
		onHide?.()
	}, [id, onHide, restoreBodySelection, zIndexStore])

	useEffect(() => {
		zIndexStore.increment(id, true)
		return () => {
			isDragging.current = false
			restoreBodySelection()
			zIndexStore.remove(id)
		}
	}, [id, restoreBodySelection, zIndexStore])

	useEffect(() => {
		window.addEventListener('resize', fitToBoundary)
		return () => {
			window.removeEventListener('resize', fitToBoundary)
		}
	}, [fitToBoundary])

	const moveProps = { ...bind(), style: { cursor: 'move', touchAction: 'none' } as const }

	return { ref, hide, moveProps, computeBoundary, fitToBoundary }
}
