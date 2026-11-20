import { clamp } from 'nebulosa/src/math/numerical/math'
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { anchoredTransform, beginGesture, type GestureAnchor, type GesturePointer, gestureTransform } from '../../sky/celestial/gesture'
import type { ViewTransform } from '../../sky/celestial/types'
import { IconButton } from '../../ui/IconButton'

// Pan and zoom of a planetary viewer, and of the Local Views of the eclipse maps: one view that goes from the whole
// satellite system (or diagram) down to the planet's (or a disk's) close-up.
// The wheel with Ctrl or ⌘ (or a trackpad pinch, which the browser sends so) zooms around the pointer while a plain
// wheel scrolls the page, a drag pans, two fingers pinch and pan while one finger moving up or down scrolls the page,
// and the buttons zoom around the centre or return to the planet and to the whole system. The view is a pixel ViewTransform of the
// Sky's gesture math over the base layout, which shows the whole system (half-width `maxHalfWidth` planet radii) across
// the surface's width; it becomes the SVG viewBox in planet radii. The transform is transient UI state of the tab.

// Zoom factor per wheel notch (100 pixels of deltaY).
const WHEEL_ZOOM = 1.25

// Zoom factor of the zoom buttons.
const BUTTON_ZOOM = 1.6

// Pointer travel in pixels under which a press is not a drag.
const DRAG_THRESHOLD = 4

// The transform of the base layout: the whole system, centred.
const WHOLE: Readonly<ViewTransform> = { x: 0, y: 0, k: 1 }

// A rectangle of the viewer in planet radii, x to the right and y down.
export interface ViewBox {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

// A point of the viewer in planet radii from the centre of the whole view, x to the right and y down.
export interface ViewPoint {
	readonly x: number
	readonly y: number
}

// The centre of the whole view, where the planet is.
const ORIGIN: ViewPoint = { x: 0, y: 0 }

// Limits and starting point of a viewer's zoom.
export interface PanZoomOptions {
	// Half-width of the whole system, in planet radii: the view at zoom 1.
	readonly maxHalfWidth: number
	// Smallest half-width, in planet radii: the closest view.
	readonly minHalfWidth: number
	// Half-width of the view the viewer opens with, in planet radii.
	readonly initialHalfWidth: number
	// Width over height of the viewer.
	readonly aspect: number
}

// The view box of a transform: the base layout shows [−maxHalfWidth, maxHalfWidth] across `widthPx` pixels, and a
// transform moves the base point b to centre + (x, y) + b·k (pixels), so the visible box is centred on −(x, y)/(s·k)
// planet radii, s = widthPx / (2·maxHalfWidth), with a half-width of maxHalfWidth / k.
export function panZoomViewBox(transform: Readonly<ViewTransform>, maxHalfWidth: number, aspect: number, widthPx: number): ViewBox {
	const halfWidth = maxHalfWidth / transform.k
	const halfHeight = halfWidth / aspect
	const s = widthPx > 0 ? widthPx / (2 * maxHalfWidth) : 1
	const cx = -transform.x / (s * transform.k)
	const cy = -transform.y / (s * transform.k)
	return { x: cx - halfWidth, y: cy - halfHeight, width: 2 * halfWidth, height: 2 * halfHeight }
}

// The current pan and zoom of a viewer and how to change it.
export interface PanZoom {
	// The visible rectangle, in planet radii.
	readonly box: ViewBox
	// Planet radii per CSS pixel of the surface, to size marks and labels in pixels whatever the zoom and the width;
	// undefined until the surface is measured.
	readonly radiiPerPixel?: number
	// Props of the element the gestures act on, wrapping the SVG.
	readonly surface: {
		readonly ref: (element: HTMLDivElement | null) => void
		readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
		readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
		readonly onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
		readonly onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
	}
	// Zooms by a factor around the centre of the view.
	readonly zoomBy: (factor: number) => void
	// Centres a point, the planet by default, with a half-width; both in planet radii.
	readonly show: (halfWidth: number, center?: ViewPoint) => void
	// Whether the view is at its closest or its widest.
	readonly closest: boolean
	readonly widest: boolean
}

// Pan and zoom of a viewer over a surface element.
export function usePanZoom({ maxHalfWidth, minHalfWidth, initialHalfWidth, aspect }: PanZoomOptions): PanZoom {
	const maxZoom = maxHalfWidth / minHalfWidth
	const [transform, setTransform] = useState<Readonly<ViewTransform>>({ ...WHOLE, k: clamp(maxHalfWidth / initialHalfWidth, 1, maxZoom) })
	const [element, setElement] = useState<HTMLDivElement | null>(null)
	const [widthPx, setWidthPx] = useState(0)
	const pointers = useRef(new Map<number, GesturePointer>())
	const anchor = useRef<GestureAnchor>(undefined)
	const press = useRef<{ x: number; y: number; dragged: boolean }>(undefined)

	// Follows the surface's width, which sets the pixels of the transform, and zooms around the pointer with the wheel
	// held with Ctrl or ⌘, as a trackpad pinch arrives; the listener is not passive so that wheel neither zooms the page
	// nor scrolls it, while a plain wheel is left to scroll the page.
	useEffect(() => {
		if (!element) return undefined
		const observer = new ResizeObserver(() => setWidthPx(element.getBoundingClientRect().width))
		observer.observe(element)
		setWidthPx(element.getBoundingClientRect().width)

		function wheel(event: WheelEvent) {
			if (!event.ctrlKey && !event.metaKey) return
			event.preventDefault()
			const rect = element!.getBoundingClientRect()
			const x = event.clientX - rect.left
			const y = event.clientY - rect.top
			setTransform((current) => anchoredTransform(current, x, y, x, y, clamp(current.k * WHEEL_ZOOM ** (-event.deltaY / 100), 1, maxZoom), rect.width, rect.height))
		}

		element.addEventListener('wheel', wheel, { passive: false })

		return () => {
			observer.disconnect()
			element.removeEventListener('wheel', wheel)
		}
	}, [element, maxZoom])

	// Position of a pointer event in the surface's pixels.
	function local(event: PointerEvent<HTMLDivElement>) {
		const rect = event.currentTarget.getBoundingClientRect()
		return { x: event.clientX - rect.left, y: event.clientY - rect.top }
	}

	// Anchors a pan or a pinch on the pointers down.
	function onPointerDown(event: PointerEvent<HTMLDivElement>) {
		const point = local(event)
		pointers.current.set(event.pointerId, point)
		anchor.current = beginGesture(pointers.current.values(), transform)
		press.current = { ...point, dragged: pointers.current.size > 1 }
	}

	// Pans or pinches once the press has moved far enough to be a drag.
	function onPointerMove(event: PointerEvent<HTMLDivElement>) {
		if (!pointers.current.has(event.pointerId) || !anchor.current) return
		const point = local(event)
		pointers.current.set(event.pointerId, point)

		if (press.current && !press.current.dragged && Math.hypot(point.x - press.current.x, point.y - press.current.y) > DRAG_THRESHOLD) {
			press.current.dragged = true
			event.currentTarget.setPointerCapture(event.pointerId)
		}

		if (press.current?.dragged) {
			const rect = event.currentTarget.getBoundingClientRect()
			setTransform(gestureTransform(anchor.current, pointers.current.values(), rect.width, rect.height, 1, maxZoom))
		}
	}

	// Anchors the gesture again on the pointers still down.
	function onPointerUp(event: PointerEvent<HTMLDivElement>) {
		pointers.current.delete(event.pointerId)
		anchor.current = beginGesture(pointers.current.values(), transform)
	}

	// Zooms by a factor around the centre of the surface.
	function zoomBy(factor: number) {
		const rect = element?.getBoundingClientRect()
		if (!rect) return
		setTransform((current) => anchoredTransform(current, rect.width / 2, rect.height / 2, rect.width / 2, rect.height / 2, clamp(current.k * factor, 1, maxZoom), rect.width, rect.height))
	}

	// Centres a point, the planet by default, with a half-width in planet radii: the inverse of panZoomViewBox's centre,
	// so the transform's offset is the point times the pixels per radius at that zoom.
	function show(halfWidth: number, center: ViewPoint = ORIGIN) {
		const k = clamp(maxHalfWidth / halfWidth, 1, maxZoom)
		const s = widthPx > 0 ? widthPx / (2 * maxHalfWidth) : 0
		setTransform({ x: -center.x * s * k || 0, y: -center.y * s * k || 0, k })
	}

	const box = panZoomViewBox(transform, maxHalfWidth, aspect, widthPx)

	return {
		box,
		radiiPerPixel: widthPx > 0 ? box.width / widthPx : undefined,
		surface: { ref: setElement, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
		zoomBy,
		show,
		closest: transform.k >= maxZoom,
		widest: transform.k <= 1 && transform.x === 0 && transform.y === 0,
	}
}

export interface PanZoomSurfaceProps {
	readonly zoom: PanZoom
	// Half-width of the planet's close-up, in planet radii.
	readonly planetHalfWidth: number
	// Name of the planet, for the buttons.
	readonly planet: string
	// Centre of the close-up, in planet radii; the planet by default.
	readonly focus?: ViewPoint
	// Name of the whole view, for its button; "Whole system" by default.
	readonly wholeLabel?: string
	// The viewer's SVG.
	readonly children: ReactNode
	// What reads the view, such as its compass, at the end of the button row.
	readonly legend?: ReactNode
}

// Classes of the zoom buttons: the 44 px touch target on a coarse pointer.
const BUTTON_CLASS = 'pointer-coarse:size-[44px]'

// The viewer's surface with its zoom buttons: zoom in and out around the centre, the planet (or focus) close up, the
// whole system.
export function PanZoomSurface({ zoom, planetHalfWidth, planet, focus, wholeLabel = 'Whole system', children, legend }: PanZoomSurfaceProps) {
	return (
		<div className="flex flex-col gap-1">
			<div {...zoom.surface} title="Drag to pan; pinch, or turn the wheel with Ctrl or ⌘, to zoom" className="cursor-grab touch-pan-y select-none active:cursor-grabbing">
				{children}
			</div>
			<div className="flex flex-wrap items-center gap-1">
				<IconButton icon="zoomOut" label="Zoom out" className={BUTTON_CLASS} disabled={zoom.widest} onClick={() => zoom.zoomBy(1 / BUTTON_ZOOM)} />
				<IconButton icon="zoomIn" label="Zoom in" className={BUTTON_CLASS} disabled={zoom.closest} onClick={() => zoom.zoomBy(BUTTON_ZOOM)} />
				<IconButton icon="actualSize" label={`${planet} close up`} className={BUTTON_CLASS} onClick={() => zoom.show(planetHalfWidth, focus)} />
				<IconButton icon="fit" label={wholeLabel} className={BUTTON_CLASS} disabled={zoom.widest} onClick={() => zoom.show(Number.POSITIVE_INFINITY)} />
				{legend && <span className="ml-auto flex items-center">{legend}</span>}
			</div>
		</div>
	)
}
