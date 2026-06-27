import { createUseGesture, dragAction } from '@use-gesture/react'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import { clamp } from 'nebulosa/src/math/numerical/math'
import { useCallback, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { storageGet, storageSet } from '@/shared/storage'
import { zIndexStore } from '@/stores/zindex.store'

// Better tree shaking with createUseGesture
const useGesture = createUseGesture([dragAction])

const MIN_VISIBLE_SIZE = 128
const MIN_MODAL_WIDTH = 192
const DEFAULT_MODAL_WIDTH = 480
const GRID_SIZE = 8

const BLOCKED_DRAG_SELECTOR = 'button,a,input,select,textarea,[contenteditable="true"],[role="button"]'

const modalTransformMap = new Map<string, Point>()
const modalWidthMap = new Map<string, number>()

export type ModalOptions = {
	readonly initialWidth?: CSSProperties['width']
	readonly maxWidth?: CSSProperties['width']
	readonly resizable?: boolean
}

type ResizeState = {
	readonly pointerId: number
	readonly startX: number
	readonly startWidth: number
	readonly left: number
	readonly top: number
}

type WidthConstraints = {
	readonly clientWidth: number
	readonly minWidth: number
	readonly maxWidth: number
}

function canDrag(target: EventTarget | null, modal: HTMLElement) {
	return target instanceof Element && target.closest('.modal') === modal && target.closest(BLOCKED_DRAG_SELECTOR) === null
}

function snapToGrid(pos: number) {
	return Math.round(pos / GRID_SIZE) * GRID_SIZE
}

function positionStorageKey(id: string) {
	return `modal.${id}.position`
}

function sizeStorageKey(id: string) {
	return `modal.${id}.size`
}

function defaultPosition(): Point {
	return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function isPoint(value: unknown): value is Point {
	if (typeof value !== 'object' || value === null) return false

	const point = value as Partial<Point>
	return isFiniteNumber(point.x) && isFiniteNumber(point.y)
}

function viewportWidth() {
	return document.documentElement.clientWidth || window.innerWidth
}

function resolveCssWidth(value: CSSProperties['width']) {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
	if (typeof value !== 'string') return undefined

	const trimmed = value.trim().toLowerCase()
	if (trimmed === '' || trimmed === 'none' || trimmed === 'auto') return undefined

	const match = /^([+-]?\d+(?:\.\d+)?)(px|vw|vh|%|rem|em)?$/.exec(trimmed)
	if (!match) return undefined

	const amount = Number.parseFloat(match[1])
	if (!Number.isFinite(amount)) return undefined

	switch (match[2]) {
		case undefined:
		case 'px':
			return amount
		case 'vw':
			return (window.innerWidth * amount) / 100
		case 'vh':
			return (window.innerHeight * amount) / 100
		case '%':
			return (viewportWidth() * amount) / 100
		case 'rem':
		case 'em':
			return amount * Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
		default:
			return undefined
	}
}

function widthConstraints(options: ModalOptions): WidthConstraints {
	const clientWidth = viewportWidth()
	const resolvedMaxWidth = Math.min(resolveCssWidth(options.maxWidth) ?? clientWidth, clientWidth)

	return {
		clientWidth,
		minWidth: Math.min(MIN_MODAL_WIDTH, resolvedMaxWidth),
		maxWidth: resolvedMaxWidth,
	}
}

function clampWidth(width: number, options: ModalOptions) {
	const constraints = widthConstraints(options)
	return clamp(width, constraints.minWidth, constraints.maxWidth)
}

function defaultWidth(options: ModalOptions) {
	return clampWidth(resolveCssWidth(options.initialWidth ?? options.maxWidth) ?? DEFAULT_MODAL_WIDTH, options)
}

function loadPosition(id: string) {
	const cached = modalTransformMap.get(id)
	if (cached !== undefined) return structuredClone(cached)

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

function loadWidth(id: string, options: ModalOptions) {
	const fallback = defaultWidth(options)

	if (options.resizable === false) return fallback

	const cached = modalWidthMap.get(id)
	if (cached !== undefined) return clampWidth(cached, options)

	try {
		const stored = storageGet(sizeStorageKey(id), fallback)
		const width = clampWidth(Number.isFinite(stored) ? stored : fallback, options)
		modalWidthMap.set(id, width)
		return width
	} catch {
		modalWidthMap.set(id, fallback)
		return fallback
	}
}

function clampToBoundary(value: number, min: number, max: number) {
	return Math.min(Math.max(snapToGrid(value), min), max)
}

export function useModal(id: string, onHide?: VoidFunction, { initialWidth, maxWidth, resizable = true }: ModalOptions = {}) {
	const options = { initialWidth, maxWidth, resizable } satisfies ModalOptions
	const modalRef = useRef<HTMLElement>(null)
	const currentId = useRef(id)
	const positionRef = useRef(loadPosition(id))
	const widthRef = useRef(loadWidth(id, options))
	const boundaryRef = useRef({ minLeft: 0, minTop: 0, maxLeft: 0, maxTop: 0 })
	const draggingRef = useRef(false)
	const resizeState = useRef<ResizeState>(undefined)
	const previousUserSelect = useRef<string>(undefined)

	if (currentId.current !== id) {
		currentId.current = id
		positionRef.current = loadPosition(id)
		widthRef.current = loadWidth(id, options)
	}

	const applyTransform = useCallback(() => {
		if (!modalRef.current) return
		modalRef.current.style.transform = `translate(calc(${positionRef.current.x}px - 50%), calc(${positionRef.current.y}px - 50%))`
	}, [])

	const applySize = useCallback(() => {
		if (!modalRef.current) return
		modalRef.current.style.width = `${widthRef.current}px`
		modalRef.current.style.height = ''
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

	const savePosition = useCallback(() => {
		try {
			const position = positionRef.current
			modalTransformMap.set(id, position)
			storageSet(positionStorageKey(id), position)
		} catch {
			// Modal position persistence should never block closing or dragging.
		}
	}, [id])

	const saveWidth = useCallback(() => {
		if (!resizable) return

		try {
			const next = clampWidth(modalRef.current?.getBoundingClientRect().width ?? widthRef.current, options)
			widthRef.current = next
			modalWidthMap.set(id, next)
			storageSet(sizeStorageKey(id), next)
		} catch {
			// Modal size persistence should never block closing or resizing.
		}
	}, [id, maxWidth, resizable])

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

	const fitSizeToBoundary = useCallback(() => {
		if (!modalRef.current) return

		widthRef.current = clampWidth(widthRef.current, options)
		applySize()
	}, [applySize, maxWidth])

	const fitToBoundary = useCallback(() => {
		computeBoundary()
		moveTo(positionRef.current.x, positionRef.current.y)
	}, [computeBoundary, moveTo])

	const fitToViewport = useCallback(() => {
		fitSizeToBoundary()
		fitToBoundary()
	}, [fitSizeToBoundary, fitToBoundary])

	const resizeTo = useCallback(
		(width: number, left: number, top: number) => {
			const constraints = widthConstraints(options)
			const nextLeft = clamp(left, 0, constraints.clientWidth - constraints.minWidth)
			const nextMaxWidth = Math.min(constraints.maxWidth, constraints.clientWidth - nextLeft)
			const nextWidth = clamp(width, constraints.minWidth, nextMaxWidth)

			widthRef.current = nextWidth
			positionRef.current.x = nextLeft + nextWidth / 2
			applySize()
			positionRef.current.y = top + (modalRef.current?.getBoundingClientRect().height ?? 0) / 2
			savePosition()
			applyTransform()
		},
		[applySize, applyTransform, maxWidth],
	)

	const finishResize = useCallback(
		(event?: ReactPointerEvent<HTMLElement>) => {
			if (resizeState.current === undefined) return

			if (event?.currentTarget.hasPointerCapture(resizeState.current.pointerId)) {
				event.currentTarget.releasePointerCapture(resizeState.current.pointerId)
			}

			resizeState.current = undefined
			restoreBodySelection()
			saveWidth()
		},
		[restoreBodySelection, saveWidth],
	)

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
				savePosition()
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

			applySize()
			applyTransform()
			fitToViewport()
			zIndexStore.apply(node, id)
		},
		[applySize, applyTransform, fitToViewport, id, zIndexStore],
	)

	const onResizePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			if (!resizable || !modalRef.current) return

			event.preventDefault()
			event.stopPropagation()

			const rect = modalRef.current.getBoundingClientRect()
			const currentWidth = clampWidth(rect.width, options)
			widthRef.current = currentWidth
			applySize()

			resizeState.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startWidth: currentWidth,
				left: rect.left,
				top: rect.top,
			}

			event.currentTarget.setPointerCapture(event.pointerId)
			zIndexStore.increment(id, true)
			disableBodySelection()
		},
		[applySize, disableBodySelection, id, maxWidth, resizable, zIndexStore],
	)

	const onResizePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			const current = resizeState.current
			if (current === undefined || current.pointerId !== event.pointerId) return

			event.preventDefault()
			event.stopPropagation()
			resizeTo(current.startWidth + event.clientX - current.startX, current.left, current.top)
		},
		[resizeTo],
	)

	const onResizePointerUp = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			const current = resizeState.current
			if (current === undefined || current.pointerId !== event.pointerId) return

			event.preventDefault()
			event.stopPropagation()
			finishResize(event)
		},
		[finishResize],
	)

	const hide = useCallback(() => {
		draggingRef.current = false
		resizeState.current = undefined
		restoreBodySelection()
		zIndexStore.remove(id)
		onHide?.()
	}, [id, onHide, restoreBodySelection, zIndexStore])

	useEffect(() => {
		zIndexStore.increment(id, true)
		return () => {
			draggingRef.current = false
			resizeState.current = undefined
			restoreBodySelection()
			zIndexStore.remove(id)
		}
	}, [id, restoreBodySelection, zIndexStore])

	useEffect(() => {
		window.addEventListener('resize', fitToViewport)
		return () => {
			window.removeEventListener('resize', fitToViewport)
		}
	}, [fitToViewport])

	const moveProps = { ...bind(), style: { cursor: 'move', touchAction: 'none' } as const }

	const resizeProps = {
		onPointerDown: onResizePointerDown,
		onPointerMove: onResizePointerMove,
		onPointerUp: onResizePointerUp,
		onPointerCancel: onResizePointerUp,
		style: { cursor: 'ew-resize', touchAction: 'none' } as const,
	}

	const style = { width: widthRef.current } satisfies CSSProperties

	return { ref, hide, moveProps, resizeProps, style, computeBoundary, fitToBoundary: fitToViewport }
}
