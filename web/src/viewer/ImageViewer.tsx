import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconButton } from '../ui/IconButton'
import { centered, FIT_VIEW, manualView, panBy, type Point, pixelAt, type Size, toImage, type ViewerView, type ViewTransform, viewTransform, ZOOM_STEP, zoomAt } from './transform'

// Reusable image viewer: a toolbar, a viewport with zoom, pan, and overlays, and a status line. It
// renders a bitmap it is given and knows nothing about where the image came from (a capture, an opened
// document, or a processing result); whoever creates the bitmap's URL owns and releases it. The view
// (zoom and pan) is owned by the caller, which keeps one per subject (an image document, a camera view),
// so it survives switching between subjects and unmounting the viewer.

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
	// Draws SVG elements over the image, given its size, in image pixel coordinates; they follow zoom and pan. Use
	// vectorEffect="non-scaling-stroke" for strokes that keep their width on screen.
	readonly overlays?: (image: Size) => ReactNode
	// Extra toolbar controls, after the view controls.
	readonly toolbar?: ReactNode
}

// Fraction of the viewport moved by one arrow key press.
const KEY_PAN_FRACTION = 0.1

// Zoom factor per pixel of wheel movement; a typical 100 px notch zooms about 16 %.
const WHEEL_ZOOM_RATE = 0.0015

// Image viewer.
export function ImageViewer({ image, loading = false, error, empty, view, onViewChange, overlays, toolbar }: ImageViewerProps) {
	const viewportRef = useRef<HTMLDivElement>(null)
	const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
	// Pointer position over the viewport, in viewport pixels; the pixel under it follows zoom and pan.
	const [cursor, setCursor] = useState<Point>()
	const drag = useRef<Point>(undefined)
	// Pressed pointers over the viewport by pointer id, at their latest client position in pixels.
	const pointers = useRef(new Map<number, Point>())
	// Distance between the two pinching pointers at the latest pinch step, in client pixels; absent when not pinching.
	const pinch = useRef<number>(undefined)
	const width = image?.width ?? 0
	const height = image?.height ?? 0
	const transform = viewTransform(view, { width, height }, viewport)
	// Transform and viewport of the latest change, so several pointer or wheel events arriving before the
	// owner's new view is rendered accumulate instead of each starting from the same stale transform.
	const latest = useRef({ transform, viewport, onViewChange })
	latest.current = { transform, viewport, onViewChange }

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

	// A single pointer drags the image; a second one turns the gesture into a pinch that only zooms, so the
	// image does not move with the fingers.
	function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
		if (e.button !== 0 || !image) return
		e.currentTarget.setPointerCapture(e.pointerId)
		const position = { x: e.clientX, y: e.clientY }
		pointers.current.set(e.pointerId, position)

		if (pointers.current.size === 1) {
			drag.current = position
		} else if (pointers.current.size === 2) {
			drag.current = undefined
			pinch.current = pinchSpan(pointers.current)?.distance
		}
	}

	function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
		const rect = e.currentTarget.getBoundingClientRect()
		setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top })
		if (!pointers.current.has(e.pointerId)) return
		pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

		const span = pinch.current !== undefined ? pinchSpan(pointers.current) : undefined

		if (span) {
			if (pinch.current && span.distance > 0) zoom(span.distance / pinch.current, { x: span.center.x - rect.left, y: span.center.y - rect.top })
			pinch.current = span.distance
		} else if (drag.current) {
			pan(e.clientX - drag.current.x, e.clientY - drag.current.y)
			drag.current = { x: e.clientX, y: e.clientY }
		}
	}

	// Ends a drag or pinch. A finger left down after a pinch does not drag until every pointer is lifted,
	// so lifting one finger does not jump the image.
	function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
		pointers.current.delete(e.pointerId)
		if (pointers.current.size < 2) pinch.current = undefined
		drag.current = undefined
	}

	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		if (!image) return
		const step = Math.max(viewport.width, viewport.height) * KEY_PAN_FRACTION

		switch (e.key) {
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

	const pixel = image && cursor ? pixelAt({ width, height }, toImage(transform, cursor)) : undefined
	const fitted = view.kind === 'fit'

	return (
		<div className="flex h-full min-h-0 flex-col bg-base-000">
			<div className="flex h-10 flex-none items-center gap-1 border-b border-line-100 bg-base-100 px-2">
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
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerUp}
				onPointerLeave={() => setCursor(undefined)}
				onKeyDown={handleKeyDown}
				className={image ? 'relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:cursor-grabbing' : 'relative min-h-0 flex-1 overflow-hidden'}
			>
				{image && (
					<div className="absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
						<img src={image.url} alt="" draggable={false} className="block size-full max-w-none" style={{ imageRendering: transform.scale >= 2 ? 'pixelated' : 'auto' }} />
						{overlays && (
							<svg viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 size-full overflow-visible">
								{overlays({ width, height })}
							</svg>
						)}
					</div>
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
