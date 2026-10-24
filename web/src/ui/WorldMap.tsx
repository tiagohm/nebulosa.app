import { cn } from 'cn'
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import worldMapUrl from '../../assets/world.map.svg'
import type { Point, Size } from '../viewer/transform'
import { IconButton } from './IconButton'
import { constrainWorldMapView, formatGeoPoint, type GeoPoint, graticulePath, interpolateWorldMapView, panWorldMap, project, unproject, WORLD_MAP_HEIGHT, WORLD_MAP_HOME, WORLD_MAP_WIDTH, type WorldMapView, worldMapTransform, zoomWorldMapAt } from './worldmap.geometry'

// Interactive world map in the equirectangular projection of web/assets/world.map.svg: zoom and pan with the
// wheel, a drag, a pinch, double clicks, the keyboard, and the zoom buttons; a click selects a geographic
// position, shown by a marker; and children drawn as SVG in map units (eclipse paths, visibility regions,
// symbols) that follow zoom and pan. The map wraps around the antimeridian by default, drawing the map and its
// children again on both sides, so a path continuing past ±180° is seen whole.
//
// Zoom and pan never re-render React: the view lives in a controller that writes it once per animation frame.
// The basemap is an <img>, so its thousands of country paths are never part of the DOM, on a CSS-transformed
// layer that is composited while the view moves (the GPU scales the last raster, briefly soft when zooming in)
// and rasterized again, sharp, once it settles; redrawing the vector basemap on every frame of a zoom costs
// tens of milliseconds. The children are on an SVG layer above it with the same zoom and pan as an SVG
// transform, and the --world-map-scale CSS property (viewport pixels per map unit). They re-render only when
// their owner renders them again; strokes that keep their width on screen use vectorEffect="non-scaling-stroke",
// and symbols that keep their size on screen use WorldMapSymbol.

// Commands of a mounted map, for its owner.
export interface WorldMapHandle {
	// Animates the view to center a geographic position, at a zoom when given (multiple of the smallest one),
	// otherwise at the current zoom.
	readonly centerOn: (point: GeoPoint, zoom?: number) => void
	// Animates the view zoomed by a factor around the viewport center.
	readonly zoomBy: (factor: number) => void
	// Animates the view back to the whole map.
	readonly reset: () => void
	// Returns the current view.
	readonly view: () => WorldMapView
}

export interface WorldMapProps {
	// Selected geographic position, shown by a marker; absent shows none.
	readonly selected?: GeoPoint
	// Called with the geographic position under a click (never a drag or a pinch).
	readonly onSelect?: (point: GeoPoint) => void
	// Called with the geographic position under the pointer as it moves, and undefined when it leaves.
	readonly onHover?: (point: GeoPoint | undefined) => void
	// Whether the map repeats across the antimeridian, so panning east or west never ends. On by default.
	readonly wrap?: boolean
	// Spacing of the meridians and parallels, in degrees in (0, 90]; false hides them. 30° by default.
	readonly graticule?: number | false
	// Whether the zoom buttons are shown. On by default.
	readonly controls?: boolean
	// Whether the coordinates under the pointer are shown. On by default.
	readonly coordinates?: boolean
	// View when mounted; the whole map by default. Later changes are applied through the handle.
	readonly initialView?: WorldMapView
	// Commands of the map.
	readonly ref?: Ref<WorldMapHandle>
	// Classes of the map's box, which sets its size; the map fills it.
	readonly className?: string
	// SVG elements in map units (see project and geoPath), drawn over the basemap and under the marker.
	readonly children?: ReactNode
}

// Zoom factor per pixel of wheel movement; a typical 100 px notch zooms about 16 %.
const WHEEL_ZOOM_RATE = 0.0015

// Zoom factor of a zoom button, key press, or double click.
const ZOOM_STEP = 2

// Fraction of the viewport moved by one arrow key press.
const KEY_PAN_FRACTION = 0.1

// Distance a press may move and still count as a click, in client pixels.
const CLICK_TOLERANCE = 4

// Duration of an animated view change, in milliseconds.
const ANIMATION_DURATION = 250

// Time without view changes after which the basemap is rasterized again at the current zoom, in milliseconds.
const SETTLE_DELAY = 150

// Basemap at its place in map units, the same element on every render so React never reconciles it.
const BASEMAP = <img src={worldMapUrl} alt="" draggable={false} className="absolute top-0 left-0 block size-full max-w-none" />

// Copies of the basemap one map width west and east, for a wrapping map.
const BASEMAP_COPIES = (
	<>
		<img src={worldMapUrl} alt="" draggable={false} className="absolute top-0 -left-full block size-full max-w-none" />
		<img src={worldMapUrl} alt="" draggable={false} className="absolute top-0 left-full block size-full max-w-none" />
	</>
)

// Size of the basemap layer, in CSS pixels before the zoom: one map unit per pixel.
const BASEMAP_SIZE: CSSProperties = { width: WORLD_MAP_WIDTH, height: WORLD_MAP_HEIGHT }

// Pressed pointers of a gesture and what they are doing.
interface Gesture {
	// Pressed pointers by pointer id, at their latest client position in pixels.
	readonly pointers: Map<number, Point>
	// Client position of the latest drag step; absent when not dragging.
	drag?: Point
	// Distance between the two pinching pointers at the latest pinch step, in client pixels; absent when not pinching.
	pinch?: number
	// Pointer and client position of a press that may still be a click; cleared once it moves or pinches.
	press?: { readonly id: number; readonly at: Point }
}

// Owner of a map's view: keeps it, constrains it to the viewport, animates it, and writes it to the basemap and
// overlay layers once per animation frame, outside React.
class WorldMapController {
	// Current view, always constrained to the viewport.
	view: WorldMapView
	// Size of the map's box, in CSS pixels.
	viewport: Size = { width: 0, height: 0 }
	// Whether the map wraps across the antimeridian.
	wrap = true
	// Layer of the basemap and its copies, CSS-transformed from map units to viewport pixels.
	basemap?: HTMLDivElement | null
	// Group of the children and their copies, SVG-transformed from map units to viewport pixels.
	group?: SVGGElement | null
	// SVG element carrying the --world-map-scale property.
	svg?: SVGSVGElement | null
	// Pending animation frame of a render or an animation, or 0.
	private frame = 0
	// Timer that ends the compositing of the basemap once the view settles.
	private settle?: Timer
	// Pending gesture of the pointers.
	readonly gesture: Gesture = { pointers: new Map() }

	constructor(view: WorldMapView) {
		this.view = view
	}

	// Sets the size of the viewport, in CSS pixels, keeping the center and zoom, and renders right away so a
	// resize never shows a stale frame.
	resize(viewport: Size) {
		this.viewport = viewport
		this.view = constrainWorldMapView(this.view, viewport, this.wrap)
		this.render(false)
	}

	// Sets whether the map wraps, which changes its smallest scale, and renders right away.
	setWrap(wrap: boolean) {
		this.wrap = wrap
		this.view = constrainWorldMapView(this.view, this.viewport, wrap)
		this.render(false)
	}

	// Writes the transform of the current view; nothing is drawn until the viewport has a size. While moving, the
	// basemap stays a composited layer until SETTLE_DELAY passes without another move.
	private render(moving: boolean) {
		const { scale, x, y } = worldMapTransform(this.view, this.viewport, this.wrap)
		if (scale <= 0 || !this.basemap || !this.group || !this.svg) return
		this.basemap.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
		this.group.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`)
		this.svg.style.setProperty('--world-map-scale', `${scale}`)

		if (moving) {
			this.basemap.style.willChange = 'transform'
			clearTimeout(this.settle)
			this.settle = setTimeout(() => this.basemap?.style.removeProperty('will-change'), SETTLE_DELAY)
		}
	}

	// Replaces the view and renders it on the next animation frame, stopping any animation.
	set(view: WorldMapView) {
		this.view = constrainWorldMapView(view, this.viewport, this.wrap)
		this.cancel()
		this.frame = requestAnimationFrame(() => {
			this.frame = 0
			this.render(true)
		})
	}

	// Moves the view to a target over ANIMATION_DURATION with an ease-out, or at once when the user prefers
	// reduced motion.
	animate(target: WorldMapView) {
		const to = constrainWorldMapView(target, this.viewport, this.wrap)
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return this.set(to)

		const from = this.view
		const start = performance.now()
		this.cancel()

		const step = (now: number) => {
			const t = Math.min(1, (now - start) / ANIMATION_DURATION)
			const eased = 1 - (1 - t) ** 3
			this.view = constrainWorldMapView(interpolateWorldMapView(from, to, eased, this.wrap), this.viewport, this.wrap)
			this.render(true)
			this.frame = t < 1 ? requestAnimationFrame(step) : 0
		}

		this.frame = requestAnimationFrame(step)
	}

	// Stops a pending render or animation; the view stays where it is.
	cancel() {
		if (this.frame) cancelAnimationFrame(this.frame)
		this.frame = 0
	}

	// Stops every pending frame and timer, when the map unmounts.
	dispose() {
		this.cancel()
		clearTimeout(this.settle)
	}

	// Zooms by a factor around a viewport point, at once.
	zoomAt(factor: number, at: Point) {
		this.set(zoomWorldMapAt(this.view, factor, at, this.viewport, this.wrap))
	}

	// Moves the map by a distance in viewport pixels, at once.
	pan(dx: number, dy: number) {
		this.set(panWorldMap(this.view, dx, dy, this.viewport, this.wrap))
	}

	// Animates a zoom by a factor around a viewport point, the viewport center when absent.
	zoomTo(factor: number, at?: Point) {
		const { width, height } = this.viewport
		this.animate(zoomWorldMapAt(this.view, factor, at ?? { x: width / 2, y: height / 2 }, this.viewport, this.wrap))
	}

	// Returns the geographic position under a viewport point.
	geoAt(at: Point): GeoPoint {
		const { scale, x, y } = worldMapTransform(this.view, this.viewport, this.wrap)
		return unproject({ x: (at.x - x) / scale, y: (at.y - y) / scale })
	}
}

// Returns the position of a pointer event relative to the element handling it, in CSS pixels.
function viewportPoint(e: { readonly clientX: number; readonly clientY: number; readonly currentTarget: Element }): Point {
	const rect = e.currentTarget.getBoundingClientRect()
	return { x: e.clientX - rect.left, y: e.clientY - rect.top }
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

// World map.
export function WorldMap({ selected, onSelect, onHover, wrap = true, graticule = 30, controls = true, coordinates = true, initialView = WORLD_MAP_HOME, ref, className, children }: WorldMapProps) {
	const [controller] = useState(() => new WorldMapController(initialView))
	const boxRef = useRef<HTMLDivElement>(null)
	const readoutRef = useRef<HTMLSpanElement>(null)
	// Callbacks of the latest render, so the native listeners registered once always call the current ones.
	const callbacks = useRef({ onSelect, onHover })
	callbacks.current = { onSelect, onHover }
	// Id of the group the wrapping copies reference, without the characters useId adds that an IRI cannot hold.
	const contentId = `world-map-${useId().replaceAll(/[^\w-]/g, '')}`
	const graticuleData = useMemo(() => (graticule ? graticulePath(graticule) : undefined), [graticule])

	useImperativeHandle(
		ref,
		() => ({
			centerOn: ({ longitude, latitude }, zoom) => controller.animate({ zoom: zoom ?? controller.view.zoom, center: project(longitude, latitude) }),
			zoomBy: (factor) => controller.zoomTo(factor),
			reset: () => controller.animate(WORLD_MAP_HOME),
			view: () => controller.view,
		}),
		[controller],
	)

	useLayoutEffect(() => controller.setWrap(wrap), [controller, wrap])

	// Measures the box synchronously before the first paint, then follows its size. The wheel listener is native
	// because React's is passive and cannot stop the page from scrolling.
	useLayoutEffect(() => {
		const box = boxRef.current
		if (!box) return

		controller.resize({ width: box.clientWidth, height: box.clientHeight })
		const observer = new ResizeObserver(([entry]) => entry && controller.resize({ width: entry.contentRect.width, height: entry.contentRect.height }))
		observer.observe(box)

		function handleWheel(e: WheelEvent) {
			e.preventDefault()
			const rect = box!.getBoundingClientRect()
			controller.zoomAt(Math.exp(-e.deltaY * WHEEL_ZOOM_RATE), { x: e.clientX - rect.left, y: e.clientY - rect.top })
		}

		box.addEventListener('wheel', handleWheel, { passive: false })

		return () => {
			observer.disconnect()
			box.removeEventListener('wheel', handleWheel)
			controller.dispose()
		}
	}, [controller])

	// Shows the position under the pointer, written directly so hovering never re-renders.
	function hover(point: GeoPoint | undefined) {
		if (readoutRef.current) readoutRef.current.textContent = point ? formatGeoPoint(point) : '—'
		callbacks.current.onHover?.(point)
	}

	// A single pointer drags the map; a second one turns the gesture into a pinch that only zooms, so the map
	// does not move with the fingers.
	function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
		if (e.button !== 0) return
		const { gesture } = controller
		e.currentTarget.setPointerCapture(e.pointerId)
		controller.cancel()
		const position = { x: e.clientX, y: e.clientY }
		gesture.pointers.set(e.pointerId, position)

		if (gesture.pointers.size === 1) {
			gesture.drag = position
			gesture.press = { id: e.pointerId, at: position }
		} else if (gesture.pointers.size === 2) {
			gesture.drag = undefined
			gesture.press = undefined
			gesture.pinch = pinchSpan(gesture.pointers)?.distance
		}
	}

	function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
		const { gesture } = controller
		const at = viewportPoint(e)

		if (gesture.pointers.has(e.pointerId)) {
			gesture.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
			if (gesture.press && Math.hypot(e.clientX - gesture.press.at.x, e.clientY - gesture.press.at.y) > CLICK_TOLERANCE) gesture.press = undefined
			const span = gesture.pinch !== undefined ? pinchSpan(gesture.pointers) : undefined

			if (span) {
				const rect = e.currentTarget.getBoundingClientRect()
				if (gesture.pinch && span.distance > 0) controller.zoomAt(span.distance / gesture.pinch, { x: span.center.x - rect.left, y: span.center.y - rect.top })
				gesture.pinch = span.distance
			} else if (gesture.drag) {
				controller.pan(e.clientX - gesture.drag.x, e.clientY - gesture.drag.y)
				gesture.drag = { x: e.clientX, y: e.clientY }
			}
		}

		if (e.pointerType === 'mouse' || gesture.pointers.size === 1) hover(controller.geoAt(at))
	}

	// Ends a drag or pinch. A finger left down after a pinch does not drag until every pointer is lifted, so
	// lifting one finger does not jump the map.
	function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
		const { gesture } = controller
		gesture.pointers.delete(e.pointerId)
		if (gesture.pointers.size < 2) gesture.pinch = undefined
		gesture.drag = undefined
		if (gesture.press?.id === e.pointerId && e.type === 'pointerup') callbacks.current.onSelect?.(controller.geoAt(viewportPoint(e)))
		gesture.press = undefined
		if (e.pointerType !== 'mouse' && gesture.pointers.size === 0) hover(undefined)
	}

	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const { width, height } = controller.viewport
		const step = Math.max(width, height) * KEY_PAN_FRACTION

		switch (e.key) {
			case '+':
			case '=':
				controller.zoomTo(ZOOM_STEP)
				break
			case '-':
				controller.zoomTo(1 / ZOOM_STEP)
				break
			case '0':
				controller.animate(WORLD_MAP_HOME)
				break
			case 'ArrowLeft':
				controller.pan(step, 0)
				break
			case 'ArrowRight':
				controller.pan(-step, 0)
				break
			case 'ArrowUp':
				controller.pan(0, step)
				break
			case 'ArrowDown':
				controller.pan(0, -step)
				break
			default:
				return
		}

		e.preventDefault()
	}

	return (
		<div
			ref={boxRef}
			tabIndex={0}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
			onPointerLeave={(e) => e.pointerType === 'mouse' && hover(undefined)}
			onDoubleClick={(e) => controller.zoomTo(ZOOM_STEP, viewportPoint(e))}
			onKeyDown={handleKeyDown}
			className={cn('relative min-h-0 touch-none overflow-hidden bg-base-000 outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:cursor-grabbing', onSelect ? 'cursor-crosshair' : 'cursor-grab', className)}
		>
			<div ref={(basemap) => void (controller.basemap = basemap)} className="absolute top-0 left-0 origin-top-left" style={BASEMAP_SIZE}>
				{BASEMAP}
				{wrap && BASEMAP_COPIES}
			</div>
			<svg ref={(svg) => void (controller.svg = svg)} className="absolute inset-0 block size-full">
				<g ref={(group) => void (controller.group = group)}>
					<g id={contentId}>
						{graticuleData && <path d={graticuleData} fill="none" vectorEffect="non-scaling-stroke" className="stroke-line-100" strokeWidth={0.5} />}
						{children}
						{selected && <SelectedMarker point={selected} />}
					</g>
					{wrap && (
						<>
							<use href={`#${contentId}`} x={-WORLD_MAP_WIDTH} />
							<use href={`#${contentId}`} x={WORLD_MAP_WIDTH} />
						</>
					)}
				</g>
			</svg>
			{controls && (
				<div className="absolute top-2 right-2 flex flex-col gap-1 rounded-sm border border-line-100 bg-base-100/90 p-0.5" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
					<IconButton icon="zoomIn" label="Zoom in (+)" onClick={() => controller.zoomTo(ZOOM_STEP)} />
					<IconButton icon="zoomOut" label="Zoom out (-)" onClick={() => controller.zoomTo(1 / ZOOM_STEP)} />
					<IconButton icon="fit" label="Whole map (0)" onClick={() => controller.animate(WORLD_MAP_HOME)} />
				</div>
			)}
			{coordinates && (
				<span ref={readoutRef} className="pointer-events-none absolute bottom-2 left-2 rounded-sm bg-base-100/90 px-2 py-0.5 text-[11px] leading-4 whitespace-pre text-ink-200 tabular-nums">
					—
				</span>
			)}
		</div>
	)
}

// Style undoing the map's zoom, so a symbol keeps its size on screen.
const SYMBOL_SCALE: CSSProperties = { transform: 'scale(calc(1 / var(--world-map-scale)))' }

export interface WorldMapSymbolProps extends GeoPoint {
	// SVG elements in screen pixels, centered on the position.
	readonly children: ReactNode
}

// Places SVG elements at a geographic position at a constant size on screen, such as a city, the greatest
// eclipse, or the subsolar point; inside a WorldMap only.
export function WorldMapSymbol({ longitude, latitude, children }: WorldMapSymbolProps) {
	const { x, y } = project(longitude, latitude)

	return (
		<g transform={`translate(${x} ${y})`}>
			<g style={SYMBOL_SCALE}>{children}</g>
		</g>
	)
}

interface SelectedMarkerProps {
	// Selected geographic position.
	readonly point: GeoPoint
}

// Marker of the selected position: an accent ring with a dot and ticks, outlined so it reads over land and
// sea, 28 pixels wide on screen.
function SelectedMarker({ point }: SelectedMarkerProps) {
	return (
		<WorldMapSymbol longitude={point.longitude} latitude={point.latitude}>
			<g className="pointer-events-none" fill="none" strokeLinecap="round">
				<path d="M0-14v6M0 8v6M-14 0h6M8 0h6M7 0a7 7 0 1 0-14 0a7 7 0 1 0 14 0" className="stroke-base-000" strokeWidth={4} />
				<path d="M0-14v6M0 8v6M-14 0h6M8 0h6M7 0a7 7 0 1 0-14 0a7 7 0 1 0 14 0" className="stroke-accent" strokeWidth={2} />
				<circle r={2} className="fill-accent" />
			</g>
		</WorldMapSymbol>
	)
}
