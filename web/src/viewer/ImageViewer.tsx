import { cn } from 'cn'
import { type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconButton } from '../ui/IconButton'
import { type GestureEvent, type GestureState, IDLE_GESTURE, isPanning, routeGesture, type ViewerInteraction } from './interaction'
import { centered, FIT_VIEW, manualView, type OverlayView, panBy, type Point, pixelAt, type Size, toImage, type ViewerView, type ViewTransform, viewTransform, visibleRegion, ZOOM_STEP, zoomAt } from './transform'

// Reusable image viewer: a toolbar, a viewport with zoom, pan, overlays, and clicks on the image, and a status line. It
// renders a bitmap it is given and knows nothing about where the image came from (a capture, an opened
// document, or a processing result); whoever creates the bitmap's URL owns and releases it. The view
// (zoom and pan) is owned by the caller, which keeps one per subject (an image document, a camera view),
// so it survives switching between subjects and unmounting the viewer. A tool may take presses through an
// interaction (interaction.ts routes each gesture to the pan, a pinch, or the tool), read the cursor in its overlays
// and in the status line, and handle the context menu of the image; Space held on the focused viewport always pans.
// The pointer over the image is a crosshair, since any point of it can be clicked, read, or drawn from, and the hand of
// the pan only while the image is being dragged or Space is held.

// Pointer over the image.
export interface ViewerCursor {
	// Image point under the pointer, in image coordinates; it may be outside the image.
	readonly image: Point
	// Integer zero-based pixel under the pointer; absent outside the image.
	readonly pixel?: Point
	// Pointer position over the viewport, in viewport pixels.
	readonly viewport: Point
}

// Bitmap shown by the viewer.
export interface ViewerImage {
	// URL of a browser-renderable bitmap (such as an object URL of a JPEG rendering).
	readonly url: string
	// Width of the image, in image pixels.
	readonly width: number
	// Height of the image, in image pixels.
	readonly height: number
}

export interface ImageViewerProps {
	// Image to show; absent when there is none yet.
	readonly image?: ViewerImage
	// Whether a new image or rendering is being prepared; the current image, if any, stays visible.
	readonly loading?: boolean
	// Why the image could not be shown.
	readonly error?: string
	// Content shown when there is no image, error, or load in progress.
	readonly empty?: ReactNode
	// Zoom and pan of the image.
	readonly view: ViewerView
	// Called with the new view when the user zooms or pans.
	readonly onViewChange: (view: ViewerView) => void
	// Draws SVG elements over the image, given its size and the current view, in image pixel coordinates; they
	// follow zoom and pan, applied as an SVG transform. Use vectorEffect="non-scaling-stroke" for strokes (and dashes)
	// that keep their width on screen, and the view's scale for other sizes that do. The cursor is the pointer over the
	// viewport, absent while it is elsewhere.
	readonly overlays?: (image: Size, view: OverlayView, cursor?: ViewerCursor) => ReactNode
	// Called with the image point under a click (a press released within CLICK_TOLERANCE of where it started,
	// never a drag or a pinch, nor a press the interaction took), in image coordinates, and the current view.
	readonly onImageClick?: (point: Point, view: OverlayView) => void
	// Tool that takes presses over the image; the viewer pans the presses it declines.
	readonly interaction?: ViewerInteraction
	// Called on a context menu request over the image (a right click, or a long press on touch devices), with its image
	// point, its client position in CSS pixels, and the current view; returns whether it was handled, which keeps the
	// browser's own menu from opening.
	readonly onImageContextMenu?: (point: Point, client: Point, view: OverlayView) => boolean
	// Extra status line content after the pixel under the pointer, given the cursor (absent off the viewport).
	readonly status?: (cursor?: ViewerCursor) => ReactNode
	// Extra toolbar controls, after the view controls.
	readonly toolbar?: ReactNode
}

// Fraction of the viewport moved by one arrow key press.
const KEY_PAN_FRACTION = 0.1

// Zoom factor per pixel of wheel movement; a typical 100 px notch zooms about 16 %.
const WHEEL_ZOOM_RATE = 0.0015

// Distance a press may move and still count as a click, in client pixels.
const CLICK_TOLERANCE = 4

// Image viewer.
export function ImageViewer({ image, loading = false, error, empty, view, onViewChange, overlays, onImageClick, interaction, onImageContextMenu, status, toolbar }: ImageViewerProps) {
	const viewportRef = useRef<HTMLDivElement>(null)
	const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
	// Pointer position over the viewport, in viewport pixels; the pixel under it follows zoom and pan.
	const [cursor, setCursor] = useState<Point>()
	// Client position of the pan at its latest step, in pixels; absent when not panning.
	const drag = useRef<Point>(undefined)
	// Pressed pointers over the viewport by pointer id, at their latest client position in pixels.
	const pointers = useRef(new Map<number, Point>())
	// Distance between the two pinching pointers at the latest pinch step, in client pixels; absent when not pinching.
	const pinch = useRef<number>(undefined)
	// Owner of the gesture in progress (interaction.ts).
	const gesture = useRef<GestureState>(IDLE_GESTURE)
	// Whether Space is held on the viewport, which pans whatever the interaction.
	const [spaceHeld, setSpaceHeld] = useState(false)
	// Whether the gesture in progress is dragging the image.
	const [panning, setPanning] = useState(false)
	const width = image?.width ?? 0
	const height = image?.height ?? 0
	const transform = viewTransform(view, { width, height }, viewport)
	// Transform and viewport of the latest change, so several pointer or wheel events arriving before the
	// owner's new view is rendered accumulate instead of each starting from the same stale transform.
	const latest = useRef({ transform, viewport, onViewChange, interaction, onImageClick, spaceHeld })
	latest.current = { transform, viewport, onViewChange, interaction, onImageClick, spaceHeld }

	useLayoutEffect(() => {
		const element = viewportRef.current
		if (!element) return
		const observer = new ResizeObserver(([entry]) => entry && setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }))
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	// The wheel listener is registered natively because React's is passive and cannot stop page scrolling.
	useEffect(() => {
		const element = viewportRef.current
		if (!element || !image) return

		function handleWheel(e: WheelEvent) {
			e.preventDefault()
			const rect = element!.getBoundingClientRect()
			zoom(Math.exp(-e.deltaY * WHEEL_ZOOM_RATE), { x: e.clientX - rect.left, y: e.clientY - rect.top })
		}

		element.addEventListener('wheel', handleWheel, { passive: false })
		return () => element.removeEventListener('wheel', handleWheel)
	}, [image])

	// Applies a new transform as a manual view.
	function change(next: ViewTransform) {
		const current = latest.current
		current.transform = next
		current.onViewChange(manualView(next, current.viewport))
	}

	// Zooms around a viewport point, the viewport center when absent.
	function zoom(factor: number, at?: Point) {
		const { transform, viewport } = latest.current
		change(zoomAt(transform, factor, at ?? { x: viewport.width / 2, y: viewport.height / 2 }))
	}

	function pan(dx: number, dy: number) {
		change(panBy(latest.current.transform, dx, dy))
	}

	function actualSize() {
		change(centered({ width, height }, viewport, 1))
	}

	function fitView() {
		onViewChange(FIT_VIEW)
	}

	// Zoom and visible region of the latest change, as overlays and tools get them.
	function overlayView(): OverlayView {
		const { transform, viewport } = latest.current
		return { scale: transform.scale, visible: visibleRegion(transform, viewport) }
	}

	// Image point under the client position of a pointer event.
	function imagePoint(e: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>): Point {
		const rect = e.currentTarget.getBoundingClientRect()
		return toImage(latest.current.transform, { x: e.clientX - rect.left, y: e.clientY - rect.top })
	}

	// Routes a pointer event to the pan, the pinch, or the tool (interaction.ts) and performs what it does. A single
	// pointer pans the image unless the tool takes it; a second one turns the gesture into a pinch that only zooms, so
	// the image does not move with the fingers, and cancels what the tool was doing.
	function route(e: PointerEvent<HTMLDivElement>, event: GestureEvent) {
		const step = routeGesture(gesture.current, event, CLICK_TOLERANCE)
		gesture.current = step.state
		setPanning(isPanning(step.state))
		const { interaction, onImageClick } = latest.current

		switch (step.effect) {
			case 'hover':
				if (!latest.current.spaceHeld) interaction?.onPointerMove(imagePoint(e), overlayView())
				break
			case 'toolMove':
				interaction?.onPointerMove(imagePoint(e), overlayView())
				break
			case 'toolUp':
				interaction?.onPointerUp(imagePoint(e), overlayView())
				break
			case 'toolCancel':
				interaction?.onCancel()
				break
			case 'click':
				onImageClick?.(imagePoint(e), overlayView())
				break
			case 'pan':
				if (drag.current) pan(e.clientX - drag.current.x, e.clientY - drag.current.y)
				drag.current = { x: e.clientX, y: e.clientY }
				break
			case 'pinch':
				if (event.type === 'move') {
					const rect = e.currentTarget.getBoundingClientRect()
					const span = pinchSpan(pointers.current)
					if (span && pinch.current && span.distance > 0) zoom(span.distance / pinch.current, { x: span.center.x - rect.left, y: span.center.y - rect.top })
					pinch.current = span?.distance
				}
				break
		}

		if (step.state.owner === 'pinch' && event.type === 'down') {
			drag.current = undefined
			pinch.current = pinchSpan(pointers.current)?.distance
		}
	}

	function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
		if (e.button !== 0 || !image) return
		e.currentTarget.setPointerCapture(e.pointerId)
		const position = { x: e.clientX, y: e.clientY }
		pointers.current.set(e.pointerId, position)
		const { interaction, spaceHeld } = latest.current
		const first = gesture.current.pressed.length === 0
		const tool = first && !spaceHeld && !!interaction && interaction.onPointerDown(imagePoint(e), overlayView())
		if (first) drag.current = tool ? undefined : position
		route(e, { type: 'down', id: e.pointerId, at: position, tool })
	}

	function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
		const rect = e.currentTarget.getBoundingClientRect()
		setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top })
		if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
		route(e, { type: 'move', id: e.pointerId, at: { x: e.clientX, y: e.clientY } })
	}

	// Ends a press, released or cancelled (also when its capture is lost). A finger left down after a pinch does not
	// drag until every pointer is lifted, so lifting one finger does not jump the image.
	function handlePointerEnd(e: PointerEvent<HTMLDivElement>, type: 'up' | 'cancel') {
		pointers.current.delete(e.pointerId)
		route(e, { type, id: e.pointerId })
		if (pointers.current.size < 2) pinch.current = undefined
		drag.current = undefined
	}

	// Opens the context menu of the image point under the pointer when the owner handles it.
	function handleContextMenu(e: MouseEvent<HTMLDivElement>) {
		if (!image || !onImageContextMenu) return
		if (onImageContextMenu(imagePoint(e), { x: e.clientX, y: e.clientY }, overlayView())) e.preventDefault()
	}

	function handleKeyUp(e: KeyboardEvent<HTMLDivElement>) {
		if (e.key === ' ') setSpaceHeld(false)
	}

	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		if (!image) return
		const step = Math.max(viewport.width, viewport.height) * KEY_PAN_FRACTION

		switch (e.key) {
			case ' ':
				setSpaceHeld(true)
				break
			case 'Escape':
				if (!interaction) return
				interaction.onCancel()
				break
			case 'Delete':
			case 'Backspace':
				if (!interaction?.onDelete) return
				interaction.onDelete()
				break
			case '+':
			case '=':
				zoom(ZOOM_STEP)
				break
			case '-':
				zoom(1 / ZOOM_STEP)
				break
			case '0':
				fitView()
				break
			case '1':
				actualSize()
				break
			case 'ArrowLeft':
				pan(step, 0)
				break
			case 'ArrowRight':
				pan(-step, 0)
				break
			case 'ArrowUp':
				pan(0, step)
				break
			case 'ArrowDown':
				pan(0, -step)
				break
			default:
				return
		}

		e.preventDefault()
	}

	const pointed = image && cursor ? toImage(transform, cursor) : undefined
	const pixel = pointed && pixelAt({ width, height }, pointed)
	const viewerCursor: ViewerCursor | undefined = pointed && cursor && { image: pointed, ...(pixel && { pixel }), viewport: cursor }
	const fitted = view.kind === 'fit'

	return (
		<div className="flex h-full min-h-0 flex-col bg-base-000">
			<div className="flex min-h-10 flex-none flex-wrap items-center gap-1 border-b border-line-100 bg-base-100 px-2 py-1">
				<IconButton icon="zoomOut" label="Zoom out (-)" disabled={!image} onClick={() => zoom(1 / ZOOM_STEP)} />
				<IconButton icon="zoomIn" label="Zoom in (+)" disabled={!image} onClick={() => zoom(ZOOM_STEP)} />
				<IconButton icon="fit" label="Fit to view (0)" disabled={!image} pressed={!!image && fitted} onClick={fitView} />
				<IconButton icon="actualSize" label="Actual size (1)" disabled={!image} onClick={actualSize} />
				{toolbar && <span className="mx-1 h-5 w-px bg-line-100" />}
				{toolbar}
			</div>
			<div
				ref={viewportRef}
				tabIndex={image ? 0 : -1}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={(e) => handlePointerEnd(e, 'up')}
				onPointerCancel={(e) => handlePointerEnd(e, 'cancel')}
				onLostPointerCapture={(e) => handlePointerEnd(e, 'cancel')}
				onPointerLeave={() => setCursor(undefined)}
				onContextMenu={handleContextMenu}
				onKeyDown={handleKeyDown}
				onKeyUp={handleKeyUp}
				onBlur={() => setSpaceHeld(false)}
				className={image ? cn('relative min-h-0 flex-1 touch-none overflow-hidden outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', spaceHeld || panning ? 'cursor-grab' : 'cursor-crosshair') : 'relative min-h-0 flex-1 overflow-hidden'}
			>
				{image && (
					<div className="absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
						<img src={image.url} alt="" draggable={false} className="block size-full max-w-none" style={{ imageRendering: transform.scale >= 2 ? 'pixelated' : 'auto' }} />
					</div>
				)}
				{image && overlays && (
					// Outside the CSS-transformed image, with the same zoom and pan as an SVG transform, so that
					// non-scaling-stroke sees the zoom and keeps strokes constant on screen.
					<svg className="pointer-events-none absolute inset-0 size-full">
						<g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>{overlays({ width, height }, { scale: transform.scale, visible: visibleRegion(transform, viewport) }, viewerCursor)}</g>
					</svg>
				)}
				{!image && <div className="absolute inset-0">{error ? <ViewerMessage tone="error">{error}</ViewerMessage> : loading ? <ViewerMessage>Loading image…</ViewerMessage> : empty}</div>}
			</div>
			<div className="flex h-6 flex-none items-center gap-4 overflow-hidden border-t border-line-100 bg-base-100 px-3 text-[11px] leading-4 whitespace-nowrap text-ink-300 tabular-nums">
				{image ? (
					<>
						<span>
							{width} × {height}
						</span>
						<span>{formatZoom(transform.scale)}</span>
						<span>{pixel ? `x ${pixel.x}  y ${pixel.y}` : 'x –  y –'}</span>
						{status?.(viewerCursor)}
					</>
				) : (
					<span>No image</span>
				)}
				{loading && image && <span className="text-accent">Rendering…</span>}
				{error && image && <span className="truncate text-danger">{error}</span>}
			</div>
		</div>
	)
}

// Distance and midpoint of a two-finger pinch.
interface PinchSpan {
	// Distance between the two pointers, in client pixels.
	readonly distance: number
	// Midpoint between the two pointers, in client pixels.
	readonly center: Point
}

// Returns the span of the first two pressed pointers, or undefined when fewer than two are pressed.
function pinchSpan(pointers: ReadonlyMap<number, Point>): PinchSpan | undefined {
	const [a, b] = pointers.values()
	if (!a || !b) return undefined
	return { distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
}

// Returns a zoom scale as a percentage with up to one decimal.
function formatZoom(scale: number): string {
	const percent = scale * 100
	return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1)}%`
}

interface ViewerMessageProps {
	// Message color: neutral or an error.
	readonly tone?: 'neutral' | 'error'
	// Message text.
	readonly children: ReactNode
}

// Centered message in the viewport.
function ViewerMessage({ tone = 'neutral', children }: ViewerMessageProps) {
	return <p className={tone === 'error' ? 'm-0 flex h-full items-center justify-center p-6 text-center text-[13px] text-danger' : 'm-0 flex h-full items-center justify-center p-6 text-center text-[13px] text-ink-300'}>{children}</p>
}
