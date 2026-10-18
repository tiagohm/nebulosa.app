import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { PIOVERTWO } from 'nebulosa/src/core/constants'
import type { Writable } from 'nebulosa/src/core/types'
import { type NumberArray, clamp } from 'nebulosa/src/math/numerical/math'
import { normalizeAngle } from 'nebulosa/src/math/units/angle'
import { DeepSkyCatalog, normalizeMilkyWayCoordinates, StarCatalog } from './catalog'
import { DSO_VIEWPORT_MARGIN, isProjectedSample, writeProjectedSample } from './drawing'
import { CelestialEventBus } from './events'
// oxfmt-ignore
import { applyViewTransform, HORIZON_EPSILON, isFiniteDiskProjection, isFiniteNumber, isPointInsideViewportMargin, multiplyMatrixVector, normalizeVector, projectionScale, projectViewVector, unprojectViewVector, writeBaseViewportBounds, writeEquatorialToHorizontalMatrix, writeHorizontalUnitVector, writeRaDecUnitVector, writeViewMatrix } from './geometry'
import { anchoredTransform, beginGesture, type GestureAnchor, type GesturePointer, gestureTransform } from './gesture'
import { BackgroundLayer, CONSTELLATION_LABEL_MIN_ZOOM, ConstellationBoundaryLayer, ConstellationLabelLayer, ConstellationLineLayer, DeepSkyObjectLayer, GridLayer, HorizonLayer, InteractionOverlayLayer, MilkyWayLayer, MovingBodyLayer, ReferenceLineLayer, ShapeLayer, StarLayer } from './layers'
import { resolveOptions, validateObserver, validateProjection } from './options'
import { FixedGridSpatialIndex, isPickableLayerId, objectLayerId, PICK_TYPE_CONSTELLATION_LABEL, PICK_TYPE_DSO, PICK_TYPE_MOVING_BODY, PICK_TYPE_SHAPE, PICK_TYPE_STAR, type PickIndex, pickMatchesObject, sameObject } from './picking'
import { CanvasRenderer } from './renderer'
import { type CelestialTime, unixTimeOf } from './time'
// oxfmt-ignore
import type { AutoUpdateOptions, CelestialEventCallback, CelestialEventName, CelestialObject, CelestialOptions, CelestialShape, ConstellationData, DeepSkyObject, MilkyWayCoordinates, MilkyWayStep, MovingBody, ObserverLocation, ProjectionType, RenderState, ResolvedCelestialOptions, ResolvedReferenceLinesOptions, SelectionTarget, Star, StarCatalogInput, ViewState, ViewTransform } from './types'
import { deepSkyMagnitude, isDeepSkyObjectVisibleAtZoom, isMovingBodyVisibleAtZoom, movingBodyMagnitude, starSymbolMagnitudeLimitAtZoom } from './visibility'

export { StarCatalog } from './catalog'
export { drawSelectionReticle } from './drawing'
export type { CelestialTime } from './time'
export type * from './types'

// Celestial: an interactive Canvas star map rendered in the browser. It owns the observer, time, and view,
// projects the loaded catalogs and caller objects through an azimuthal projection, and drives the layers,
// picking, pointer interactions (pan, pinch, and wheel zoom), and events. Astronomical updates (time or observer
// changes) are coalesced into microtasks and rendering into animation frames. This module is the entry
// point of the star map and re-exports its public types.

// Pixel equivalent of a wheel delta reported in lines; higher makes line-mode wheels zoom faster.
const WHEEL_DELTA_LINE_PIXELS = 16

// Pixel equivalent of a wheel delta reported in pages; higher makes page-mode wheels zoom faster.
const WHEEL_DELTA_PAGE_PIXELS = 800

// Canvas group of each built-in layer; layers sharing a group share a canvas and redraw together.
const LAYER_CANVAS_GROUPS: Record<string, string> = {
	background: 'sky',
	horizon: 'sky',
	milkyWay: 'sky',
	grid: 'sky',
	referenceLines: 'sky',
	constellations: 'sky',
	constellationBoundaries: 'sky',
	deepSky: 'sky',
	stars: 'stars',
	movingBodies: 'dynamic',
	constellationLabels: 'dynamic',
	shapes: 'dynamic',
	overlay: 'overlay',
}

// Layers whose content depends on time and observer and must redraw after an astronomical update.
const ASTRONOMICAL_DIRTY_LAYER_IDS = ['grid', 'referenceLines', 'milkyWay', 'constellations', 'constellationBoundaries', 'constellationLabels', 'deepSky', 'stars', 'movingBodies', 'shapes'] as const

// Returns a wheel event's vertical delta in pixels, whatever its delta mode.
function normalizedWheelDeltaY(event: WheelEvent) {
	if (event.deltaMode === 1) return event.deltaY * WHEEL_DELTA_LINE_PIXELS
	if (event.deltaMode === 2) return event.deltaY * WHEEL_DELTA_PAGE_PIXELS
	return event.deltaY
}

// Resolves a container element or CSS selector; throws when the selector matches no HTML element.
function resolveContainer(container: HTMLElement | string): HTMLElement {
	if (typeof container !== 'string') {
		return container
	}

	const element = document.querySelector(container)

	if (!(element instanceof HTMLElement)) {
		throw new Error(`Celestial container not found: ${container}`)
	}

	return element
}

// Pressed pointer of a gesture, in map-local pixels.
interface ActivePointer extends GesturePointer {
	// Horizontal press position in pixels.
	readonly startX: number
	// Vertical press position in pixels.
	readonly startY: number
}

// Normalizes a thrown value to an Error.
function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}

// Interactive Canvas star map.
export class Celestial {
	readonly #host: HTMLElement
	readonly #renderer: CanvasRenderer
	readonly #emitter = new CelestialEventBus()
	readonly #picking = new FixedGridSpatialIndex()
	// Row-major rotation from equatorial-of-date to horizontal unit vectors.
	readonly #eqToHorizontal = new Float64Array(9)
	// Row-major rotation from world (frame of the coordinate system) to view unit vectors.
	readonly #viewMatrix = new Float32Array(9)
	// World unit vector at the view center.
	readonly #centerVector = new Float32Array(3)
	// World unit vector that orients the view's up direction.
	readonly #referenceUp = new Float32Array(3)
	readonly #tempProjection = new Float32Array(2)
	readonly #tempVector = new Float32Array(3)
	readonly #tempScreen = new Float32Array(2)
	// Base screen bounds [minX, maxX, minY, maxY] stars were last projected into.
	readonly #starProjectionBounds = new Float64Array(4)
	readonly #starViewportBounds = new Float64Array(4)

	readonly #options: ResolvedCelestialOptions
	#renderState: Writable<RenderState> | null = null
	#cachedRect: DOMRect | null = null
	#starCatalog: StarCatalog | null = null
	#deepSkyCatalog: DeepSkyCatalog | null = null
	#constellations: ConstellationData = {}
	#milkyWay: MilkyWayStep[] = []
	readonly #movingBodies = new Map<string, MovingBody>()
	readonly #movingBodyList: MovingBody[] = []
	readonly #shapes = new Map<string, CelestialShape>()
	readonly #shapeList: CelestialShape[] = []
	// Shapes registered in the picking index, by pick index.
	readonly #pickedShapes: CelestialShape[] = []
	#transform: ViewTransform = { x: 0, y: 0, k: 1 }
	#hoverObject: CelestialObject | null = null
	#selectedObject: CelestialObject | null = null
	#autoUpdateTimer: ReturnType<typeof setInterval> | null = null
	#autoUpdateOptions: Required<AutoUpdateOptions> | null = null
	#frameId = 0
	#updateQueued = false
	#projectedGeometryRevision = 0
	#pickingDirty = false
	#destroyed = false
	// Pressed pointers by pointer id, with their press positions, in map-local pixels.
	readonly #activePointers = new Map<number, ActivePointer>()
	// Pan or pinch in progress, anchored when the pressed pointers last changed.
	#gesture: GestureAnchor | undefined
	// Whether the pointers moved the view since the first press, which suppresses the click.
	#pointerMoved = false
	#lastPointerMove = 0
	#lastPointerX = Number.NaN
	#lastPointerY = Number.NaN

	// Creates the map inside a container element or CSS selector and binds its pointer interactions. Nothing
	// is projected until the caller loads data and calls run() or queueRun(), so it can configure the map
	// before the first update.
	constructor(container: HTMLElement | string, options: CelestialOptions = {}) {
		this.#host = resolveContainer(container)
		this.#options = resolveOptions(options, Date.now())
		this.#renderer = new CanvasRenderer(this.#host, this.#options.width, this.#options.height, this.#options.maxDevicePixelRatio)

		this.setupLayers()

		this.bindInteractions()

		// The element rect is cached for pointer math; scroll/resize can move it, so invalidate on both.
		window.addEventListener('scroll', this.invalidateRect, { capture: true, passive: true })
		window.addEventListener('resize', this.invalidateRect, { passive: true })

		this.resetViewCenter()
		writeEquatorialToHorizontalMatrix(this.#options.time, this.#options.observer, this.#eqToHorizontal)
	}

	// Selected object, or null.
	get selectedObject() {
		return this.#selectedObject
	}

	// Sets the observation instant and queues an update when it changed.
	setTime(time: CelestialTime) {
		const unixTime = unixTimeOf(time)

		if (unixTime !== this.#options.time) {
			this.#options.time = unixTime
			this.queueUpdate()
		}
	}

	// Sets the observer location and queues an update when it changed.
	setObserver(observer: ObserverLocation) {
		observer = validateObserver(observer)

		if (observer.latitude !== this.#options.observer.latitude || observer.longitude !== this.#options.observer.longitude || observer.elevation !== this.#options.observer.elevation) {
			this.#options.observer = observer
			this.queueUpdate()
		}
	}

	// Changes the map projection and reprojects immediately.
	setProjection(projection: ProjectionType) {
		projection = validateProjection(projection)

		if (projection !== this.#options.projection) {
			this.#options.projection = projection
			this.queueProjectionOnly()
		}
	}

	// Sets the faintest star magnitude projected and drawn.
	setMagnitudeLimit(limit: number) {
		if (limit !== this.#options.stars.maxMagnitude) {
			this.#options.stars.maxMagnitude = limit
			this.projectStars()
			this.rebuildPickingIndex()

			if (this.#hoverObject?.type === 'star' || this.#selectedObject?.type === 'star') {
				this.#renderer.markDirty('overlay')
			}

			this.requestRender()
		}
	}

	// Toggles star labels without reprojecting stars.
	setStarLabelsVisible(visible: boolean) {
		if (this.#options.stars.labels !== visible) {
			this.#options.stars.labels = visible
			this.#renderer.markDirty('stars')
			this.requestRender()
		}
	}

	// Shows or hides one reference line (local meridian, celestial equator, or ecliptic) without reprojecting.
	setReferenceLineVisible(line: keyof ResolvedReferenceLinesOptions, visible: boolean) {
		const style = this.#options.referenceLines[line]

		if (style.enabled !== visible) {
			style.enabled = visible
			this.#renderer.markDirty('referenceLines')
			this.requestRender()
		}
	}

	// Sets the pan and zoom transform, clamping the zoom to the configured range; a gesture in progress continues from it.
	setViewTransform(transform: ViewTransform) {
		if (this.writeViewTransform(this.normalizeViewTransform(transform))) {
			this.restartGesture()
			this.afterTransformChanged()
		}
	}

	// Sets the default auto-update interval in milliseconds, restarting a running auto-update; non-positive
	// values emit an error.
	setUpdateInterval(ms: number) {
		if (!isFiniteNumber(ms) || ms <= 0) {
			this.emitError(new Error('Invalid update interval'))
			return
		}

		const interval = Math.floor(ms)

		if (interval !== this.#options.updateInterval) {
			this.#options.updateInterval = interval

			if (this.#autoUpdateOptions) {
				this.startAutoUpdate({ ...this.#autoUpdateOptions, interval })
			}
		}
	}

	// Starts a timer that follows the wall clock (realtime, applied immediately) or advances the observation
	// time by the time step on each tick (simulation); replaces any running auto-update.
	startAutoUpdate(options?: AutoUpdateOptions) {
		this.stopAutoUpdate()

		const mode = options?.mode ?? 'realtime'
		const interval = Math.max(1, Math.floor(options?.interval ?? this.#options.updateInterval))
		const timeStep = Math.floor(options?.timeStep ?? options?.interval ?? this.#options.updateInterval)

		this.#autoUpdateOptions = { mode, interval, timeStep }

		const tick = () => {
			this.setTime(mode === 'simulation' ? this.#options.time + timeStep : Date.now())
		}

		if (mode === 'realtime') {
			tick()
		}

		this.#autoUpdateTimer = setInterval(tick, interval)
	}

	// Stops the auto-update timer.
	stopAutoUpdate() {
		if (this.#autoUpdateTimer) {
			clearInterval(this.#autoUpdateTimer)
			this.#autoUpdateTimer = null
		}

		this.#autoUpdateOptions = null
	}

	// Resizes the map to a size in pixels and reprojects without recreating the instance. The cached
	// element rect is dropped even when the size is unchanged, since the map may have moved (for example,
	// re-attached to another container).
	resize(width: number, height: number) {
		const nextWidth = Math.max(1, Math.floor(width))
		const nextHeight = Math.max(1, Math.floor(height))
		this.#cachedRect = null

		if (nextWidth === this.#options.width && nextHeight === this.#options.height) {
			return
		}

		this.#options.width = nextWidth
		this.#options.height = nextHeight
		this.invalidateProjectedGeometry()
		this.#cachedRect = null
		this.#renderer.resize(this.#options.width, this.#options.height)
		this.projectStars()
		this.projectDeepSkyObjects()
		this.rebuildPickingIndex()
		this.#renderer.markAllDirty()
		this.#emitter.has('resize') && this.#emitter.emit('resize', { width: this.#options.width, height: this.#options.height })
		this.requestRender()
	}

	// Schedules a coalesced render frame.
	render() {
		this.requestRender()
	}

	// Returns whether a layer is visible.
	isLayerVisible(layerId: string) {
		return this.#options.layers[layerId] !== false
	}

	// Stops timers, removes listeners and canvases, and drops loaded data; later calls are ignored.
	destroy() {
		if (this.#destroyed) return

		this.#destroyed = true
		this.stopAutoUpdate()
		this.unbindInteractions()
		this.#activePointers.clear()
		this.#gesture = undefined
		window.removeEventListener('scroll', this.invalidateRect, { capture: true })
		window.removeEventListener('resize', this.invalidateRect)

		if (this.#frameId) {
			cancelAnimationFrame(this.#frameId)
			this.#frameId = 0
		}

		this.#renderer.destroy()
		this.#emitter.clear()
		this.#renderState = null
		this.#starCatalog = null
		this.#deepSkyCatalog = null
		this.#constellations = {}
		this.#milkyWay.length = 0
		this.#movingBodies.clear()
		this.#movingBodyList.length = 0
		this.#shapes.clear()
		this.#shapeList.length = 0
	}

	// Loads stars from object arrays or typed arrays and queues an update; failures emit an error.
	loadStars(stars: readonly Star[] | StarCatalogInput) {
		try {
			this.#starCatalog = new StarCatalog(stars)
			this.#starCatalog.cacheStyleBuckets(this.#options.stars, this.#options.theme)
			this.queueUpdate()
		} catch (error) {
			this.emitError(normalizeError(error))
		}
	}

	// Loads constellation lines, boundaries, and labels.
	loadConstellations(data: ConstellationData) {
		this.#constellations = {
			lines: data.lines ?? [],
			labels: data.labels ?? [],
			boundaries: data.boundaries ?? [],
		}

		this.invalidateProjectedGeometry()
		this.#renderer.markDirty('constellations')
		this.#renderer.markDirty('constellationBoundaries')
		this.#renderer.markDirty('constellationLabels')
		this.rebuildPickingIndex()
		this.requestRender()
	}

	// Loads the Milky Way outline levels.
	loadMilkyWay(coordinates: MilkyWayCoordinates) {
		this.#milkyWay = normalizeMilkyWayCoordinates(coordinates)
		this.invalidateProjectedGeometry()
		this.#renderer.markDirty('milkyWay')
		this.requestRender()
	}

	// Loads deep-sky objects, keeping the selection and hover when their objects are still present.
	loadDeepSkyObjects(objects: readonly DeepSkyObject[]) {
		this.#deepSkyCatalog = new DeepSkyCatalog(objects)
		this.syncSelectedDeepSkyObject()
		this.syncHoverDeepSkyObject()
		this.projectDeepSkyObjects()
		this.rebuildPickingIndex()
		this.#renderer.markDirty('overlay')
		this.requestRender()
	}

	// Refreshes cached deep-sky coordinates after the caller mutated one object (by id) or all of them;
	// returns false when nothing is loaded or the id is unknown.
	markDeepSkyObjectsChanged(id?: DeepSkyObject['id']) {
		const catalog = this.#deepSkyCatalog
		if (!catalog) return false

		let index: number | undefined

		if (id !== undefined) {
			index = this.findDeepSkyObjectIndex(id)
			if (index < 0) return false
		}

		catalog.refreshEquatorialVectors(index)
		this.syncSelectedDeepSkyObject()
		this.syncHoverDeepSkyObject()
		this.projectDeepSkyObjects()
		this.rebuildPickingIndex()

		if (id === undefined || (this.#selectedObject?.type === 'deepSky' && this.#selectedObject.object.id === id) || (this.#hoverObject?.type === 'deepSky' && this.#hoverObject.object.id === id)) {
			this.#renderer.markDirty('overlay')
		}

		this.requestRender()
		return true
	}

	// Adds or replaces a moving body by id and returns the id; call markMovingBodyDirty() to redraw.
	addMovingBody(object: MovingBody) {
		const id = object.id
		const previous = this.#movingBodies.get(id)
		this.#movingBodies.set(id, object)

		if (previous) {
			const index = this.#movingBodyList.indexOf(previous)

			if (index >= 0) {
				this.#movingBodyList[index] = object
			} else {
				this.#movingBodyList.push(object)
			}
		} else {
			this.#movingBodyList.push(object)
		}

		return id
	}

	// Removes a moving body, clearing it from the selection and hover; returns whether it existed.
	removeMovingBody(id: string) {
		const object = this.#movingBodies.get(id)

		if (object === undefined) return false

		this.#movingBodies.delete(id)
		const index = this.#movingBodyList.indexOf(object)

		if (index >= 0) {
			this.#movingBodyList.splice(index, 1)
		}

		if (this.#selectedObject?.type === 'movingBody' && this.#selectedObject.object.id === id) {
			this.#selectedObject = null
			this.#renderer.markDirty('overlay')
		}

		if (this.#hoverObject?.type === 'movingBody' && this.#hoverObject.object.id === id) {
			this.#hoverObject = null
			this.#renderer.markDirty('overlay')
		}

		return true
	}

	// Removes every moving body.
	clearMovingBodies() {
		if (this.#movingBodies.size === 0) return

		this.#movingBodies.clear()
		this.#movingBodyList.length = 0

		if (this.#selectedObject?.type === 'movingBody') {
			this.#selectedObject = null
			this.#renderer.markDirty('overlay')
		}

		if (this.#hoverObject?.type === 'movingBody') {
			this.#hoverObject = null
			this.#renderer.markDirty('overlay')
		}
	}

	// Redraws moving bodies after the caller mutated one (by id) or several; returns false for an unknown id.
	markMovingBodyDirty(id?: string) {
		if (id !== undefined && !this.#movingBodies.has(id)) {
			return false
		}

		this.syncSelectedMovingBodyObject()
		this.syncHoverMovingBodyObject()
		this.rebuildPickingIndex()
		this.#renderer.markDirty('movingBodies')

		if (id === undefined || (this.#selectedObject?.type === 'movingBody' && this.#selectedObject.object.id === id) || (this.#hoverObject?.type === 'movingBody' && this.#hoverObject.object.id === id)) {
			this.#renderer.markDirty('overlay')
		}

		this.requestRender()
		return true
	}

	// Adds or replaces a custom shape by id, redraws it, and returns the id.
	addShape(shape: CelestialShape) {
		const id = shape.id
		const previous = this.#shapes.get(id)
		this.#shapes.set(id, shape)

		if (previous) {
			const index = this.#shapeList.indexOf(previous)

			if (index >= 0) {
				this.#shapeList[index] = shape
			} else {
				this.#shapeList.push(shape)
			}
		} else {
			this.#shapeList.push(shape)
		}

		this.markShapeChanged(id)
		return id
	}

	// Removes a custom shape, clearing it from the selection and hover; returns whether it existed.
	removeShape(id: string) {
		const shape = this.#shapes.get(id)

		if (shape === undefined) return false

		this.#shapes.delete(id)
		const index = this.#shapeList.indexOf(shape)

		if (index >= 0) {
			this.#shapeList.splice(index, 1)
		}

		if (this.#selectedObject?.type === 'shape' && this.#selectedObject.id === id) {
			this.#selectedObject = null
			this.#renderer.markDirty('overlay')
		}

		if (this.#hoverObject?.type === 'shape' && this.#hoverObject.id === id) {
			const object = this.#hoverObject
			this.#hoverObject = null
			this.#renderer.markDirty('overlay')
			// A shape removed under the pointer is left, so a tooltip of it does not outlive it.
			this.#emitter.has('objectLeave') && this.#emitter.emit('objectLeave', { object })
		}

		this.markShapeChanged()
		return true
	}

	// Removes every custom shape.
	clearShapes() {
		if (this.#shapes.size === 0) return

		this.#shapes.clear()
		this.#shapeList.length = 0

		if (this.#selectedObject?.type === 'shape') {
			this.#selectedObject = null
			this.#renderer.markDirty('overlay')
		}

		if (this.#hoverObject?.type === 'shape') {
			this.#hoverObject = null
			this.#renderer.markDirty('overlay')
		}

		this.markShapeChanged()
	}

	// Redraws custom shapes after the caller mutated one (by id) or several; returns false for an unknown id.
	markShapeChanged(id?: string) {
		if (id !== undefined && !this.#shapes.has(id)) {
			return false
		}

		this.rebuildPickingIndex()
		this.#renderer.markDirty('shapes')

		if (id === undefined || (this.#selectedObject?.type === 'shape' && this.#selectedObject.id === id) || (this.#hoverObject?.type === 'shape' && this.#hoverObject.id === id)) {
			this.#renderer.markDirty('overlay')
		}

		this.requestRender()
		return true
	}

	// Shows or hides a layer by id, dropping hidden objects from the selection and hover; unknown ids emit an
	// error.
	setLayerVisible(layerId: string, visible: boolean) {
		const layer = this.#renderer.getLayer(layerId)

		if (!layer) {
			this.emitError(new Error(`Unknown layer: ${layerId}`))
			return
		}

		layer.visible = visible
		layer.markDirty()
		this.#options.layers[layerId] = visible

		if (isPickableLayerId(layerId)) {
			if (!visible) {
				this.clearHiddenLayerObjects(layerId)
			}

			this.rebuildPickingIndex()
		}

		this.requestRender()
	}

	// Centers the view on a right ascension and declination in radians, celestial north up.
	centerOnEquatorial(ra: number, dec: number) {
		writeRaDecUnitVector(normalizeAngle(ra), clamp(dec, -PIOVERTWO, PIOVERTWO), this.#centerVector)
		this.#referenceUp[0] = 0
		this.#referenceUp[1] = 0
		this.#referenceUp[2] = 1
		this.writeCurrentViewMatrix()
		this.queueProjectionOnly()
	}

	// Centers the view on an azimuth and altitude in radians, north up.
	centerOnHorizontal(az: number, alt: number) {
		writeHorizontalUnitVector(normalizeAngle(az), clamp(alt, -PIOVERTWO, PIOVERTWO), this.#centerVector)
		this.#referenceUp[0] = 0
		this.#referenceUp[1] = 1
		this.#referenceUp[2] = 0
		this.writeCurrentViewMatrix()
		this.queueProjectionOnly()
	}

	// Pans the view so a right ascension and declination of date in radians is at the middle of the
	// viewport, keeping the zoom and the view orientation, exactly as a drag would. The view itself is
	// never rotated, because the local sky's layers assume it stays centered on the zenith. Returns false,
	// leaving the view unchanged, when the point cannot be projected (below the local horizon).
	centerOnCoordinate(ra: number, dec: number): boolean {
		if (!this.projectEquatorialToScreen(ra, dec, this.#tempScreen)) return false

		const { width, height } = this.#options
		const { x, y, k } = this.#transform
		this.setViewTransform({ x: x + width / 2 - this.#tempScreen[0], y: y + height / 2 - this.#tempScreen[1], k })
		return true
	}

	// Selects a loaded object by id without moving the view, or clears the selection with null, and redraws
	// the highlight. Unlike a click, it does not emit selectionChange: the caller already knows. Returns the
	// selected object, or null (with the selection cleared) when no loaded object has the id.
	selectObject(target: SelectionTarget | null): CelestialObject | null {
		const object = target ? this.findObject(target) : null

		if (!sameObject(object, this.#selectedObject)) {
			this.#selectedObject = object
			this.#renderer.markDirty('overlay')
			this.requestRender()
		}

		return object
	}

	// Current navigation state, for restoring the view in another instance.
	get viewState(): ViewState {
		const c = this.#centerVector
		const u = this.#referenceUp
		return { center: [c[0], c[1], c[2]], up: [u[0], u[1], u[2]], transform: { ...this.#transform } }
	}

	// Restores a navigation state taken from viewState, clamping the zoom to the configured range.
	setViewState(state: ViewState) {
		this.#centerVector.set(state.center)
		this.#referenceUp.set(state.up)

		if (!normalizeVector(this.#centerVector) || !normalizeVector(this.#referenceUp)) {
			this.resetViewCenter()
		} else {
			this.writeCurrentViewMatrix()
		}

		this.writeViewTransform(this.normalizeViewTransform(state.transform))
		this.restartGesture()
		this.queueProjectionOnly()
		this.afterTransformChanged()
	}

	// Converts map-local screen pixels into right ascension [0, 2π) and declination in radians; returns null
	// outside the projection or, in horizontal views, below the horizon.
	screenToEquatorial(x: number, y: number): EquatorialCoordinate | null {
		if (!Number.isFinite(x) || !Number.isFinite(y) || this.#transform.k <= 0) {
			return null
		}

		const width = this.#options.width
		const height = this.#options.height
		const scale = projectionScale(width, height, this.#options.projection)
		const baseX = width / 2 + (x - width / 2 - this.#transform.x) / this.#transform.k
		const baseY = height / 2 + (y - height / 2 - this.#transform.y) / this.#transform.k
		const projectionX = (width / 2 - baseX) / scale
		const projectionY = (height / 2 - baseY) / scale

		if (!unprojectViewVector(this.#options.projection, projectionX, projectionY, this.#tempVector)) {
			return null
		}

		const viewX = this.#tempVector[0]
		const viewY = this.#tempVector[1]
		const viewZ = this.#tempVector[2]
		const matrix = this.#viewMatrix
		let worldX = matrix[0] * viewX + matrix[3] * viewY + matrix[6] * viewZ
		let worldY = matrix[1] * viewX + matrix[4] * viewY + matrix[7] * viewZ
		let worldZ = matrix[2] * viewX + matrix[5] * viewY + matrix[8] * viewZ

		if (this.#options.coordinateSystem === 'horizontal') {
			if (worldZ < -HORIZON_EPSILON) {
				return null
			}

			const horizontalX = worldX
			const horizontalY = worldY
			const horizontalZ = worldZ
			const eqMatrix = this.#eqToHorizontal
			worldX = eqMatrix[0] * horizontalX + eqMatrix[3] * horizontalY + eqMatrix[6] * horizontalZ
			worldY = eqMatrix[1] * horizontalX + eqMatrix[4] * horizontalY + eqMatrix[7] * horizontalZ
			worldZ = eqMatrix[2] * horizontalX + eqMatrix[5] * horizontalY + eqMatrix[8] * horizontalZ
		}

		this.#tempVector[0] = worldX
		this.#tempVector[1] = worldY
		this.#tempVector[2] = worldZ

		if (!normalizeVector(this.#tempVector)) {
			return null
		}

		return {
			rightAscension: normalizeAngle(Math.atan2(this.#tempVector[1], this.#tempVector[0])),
			declination: Math.asin(clamp(this.#tempVector[2], -1, 1)),
		}
	}

	// Registers an event callback and returns a function that unregisters it.
	on<K extends CelestialEventName>(eventName: K, callback: CelestialEventCallback<K>): () => void {
		return this.#emitter.on(eventName, callback)
	}

	// Unregisters an event callback.
	off<K extends CelestialEventName>(eventName: K, callback: CelestialEventCallback<K>): void {
		this.#emitter.off(eventName, callback)
	}

	// Coalesces synchronous update requests into one update on the next microtask.
	queueRun() {
		if (this.#updateQueued) return

		this.#updateQueued = true

		queueMicrotask(() => {
			this.#updateQueued = false
			this.run()
		})
	}

	// Recomputes the equatorial-to-horizontal rotation for the current time and observer, reprojects every
	// catalog, rebuilds picking, and schedules a render.
	run() {
		if (this.#destroyed) return

		const emitUpdateStart = this.#emitter.has('updateStart')
		const emitUpdateEnd = this.#emitter.has('updateEnd')
		const start = emitUpdateEnd ? performance.now() : 0
		emitUpdateStart && this.#emitter.emit('updateStart', { time: this.#options.time })
		writeEquatorialToHorizontalMatrix(this.#options.time, this.#options.observer, this.#eqToHorizontal)
		this.invalidateProjectedGeometry()
		this.projectStars()
		this.projectDeepSkyObjects()
		this.rebuildPickingIndex()
		emitUpdateEnd && this.#emitter.emit('updateEnd', { time: this.#options.time, duration: performance.now() - start })
		this.markAstronomicalDirty()
		this.requestRender()
	}

	// Drops the selection and hover when they belong to a layer being hidden.
	private clearHiddenLayerObjects(layerId: string) {
		if (this.#selectedObject && objectLayerId(this.#selectedObject) === layerId) {
			this.#selectedObject = null
			this.#renderer.markDirty('overlay')
		}

		if (this.#hoverObject && objectLayerId(this.#hoverObject) === layerId) {
			const object = this.#hoverObject
			this.#hoverObject = null
			this.#renderer.markDirty('overlay')
			this.#emitter.has('objectLeave') && this.#emitter.emit('objectLeave', { object })
		}
	}

	// Creates and registers the built-in layers.
	private setupLayers() {
		const layers = [
			new BackgroundLayer(),
			new HorizonLayer(),
			new MilkyWayLayer(),
			new GridLayer(),
			new ReferenceLineLayer(),
			new ConstellationLineLayer(),
			new ConstellationBoundaryLayer(),
			new DeepSkyObjectLayer(),
			new StarLayer(),
			new MovingBodyLayer(),
			new ConstellationLabelLayer(),
			new ShapeLayer(),
			new InteractionOverlayLayer(),
		]

		for (const layer of layers) {
			layer.visible = this.#options.layers[layer.id] ?? true
			this.#renderer.addLayer(layer, LAYER_CANVAS_GROUPS[layer.id] ?? layer.id)
		}
	}

	// Centers the view on the zenith (north up) in horizontal views, or on RA 0, Dec 0 (celestial north up)
	// in equatorial views.
	private resetViewCenter() {
		if (this.#options.coordinateSystem === 'horizontal') {
			this.#centerVector[0] = 0
			this.#centerVector[1] = 0
			this.#centerVector[2] = 1
			this.#referenceUp[0] = 0
			this.#referenceUp[1] = 1
			this.#referenceUp[2] = 0
		} else {
			this.#centerVector[0] = 1
			this.#centerVector[1] = 0
			this.#centerVector[2] = 0
			this.#referenceUp[0] = 0
			this.#referenceUp[1] = 0
			this.#referenceUp[2] = 1
		}

		this.writeCurrentViewMatrix()
	}

	// Recomputes the view matrix from the center and reference up vectors.
	private writeCurrentViewMatrix() {
		writeViewMatrix(this.#centerVector, this.#referenceUp, this.#viewMatrix)
	}

	// Invalidates the layers' cached projected geometry.
	private invalidateProjectedGeometry() {
		this.#projectedGeometryRevision++
	}

	// Queues a full astronomical update unless one is queued or the map is destroyed.
	private queueUpdate() {
		if (this.#updateQueued || this.#destroyed) return

		this.queueRun()
	}

	// Reprojects immediately after a view or projection change, without recomputing the time-dependent
	// rotation.
	private queueProjectionOnly() {
		if (this.#destroyed) return

		this.invalidateProjectedGeometry()
		this.projectStars()
		this.projectDeepSkyObjects()
		this.rebuildPickingIndex()
		this.#renderer.markAllDirty()
		this.requestRender()
	}

	// Refreshes the selected moving body from the current list, or clears it when gone.
	private syncSelectedMovingBodyObject() {
		if (this.#selectedObject?.type !== 'movingBody') return

		this.#selectedObject = this.currentMovingBodyObject(this.#selectedObject)
	}

	// Refreshes the selected deep-sky object from the current catalog, or clears it when gone.
	private syncSelectedDeepSkyObject() {
		if (this.#selectedObject?.type !== 'deepSky') return

		this.#selectedObject = this.currentDeepSkyObject(this.#selectedObject)
	}

	// Refreshes the hovered deep-sky object from the current catalog, emitting objectLeave when gone.
	private syncHoverDeepSkyObject() {
		if (this.#hoverObject?.type !== 'deepSky') return

		const previous = this.#hoverObject
		this.#hoverObject = this.currentDeepSkyObject(previous)

		if (!this.#hoverObject) {
			this.#emitter.has('objectLeave') && this.#emitter.emit('objectLeave', { object: previous })
		}
	}

	// Returns the picked deep-sky object as found by id in the current catalog, or null.
	private currentDeepSkyObject(object: Extract<CelestialObject, { type: 'deepSky' }>): CelestialObject | null {
		const catalog = this.#deepSkyCatalog
		if (!catalog) return null

		const indexed = catalog.objects[object.index]

		if (indexed?.id === object.object.id) {
			return { type: 'deepSky', index: object.index, object: indexed }
		}

		const index = this.findDeepSkyObjectIndex(object.object.id)
		return index >= 0 ? { type: 'deepSky', index, object: catalog.objects[index] } : null
	}

	// Returns the loaded object of a selection target, or null.
	private findObject(target: SelectionTarget): CelestialObject | null {
		if (target.type === 'star') {
			const index = this.#starCatalog?.ids.indexOf(target.id) ?? -1
			return index >= 0 ? this.#starCatalog!.getObject(index) : null
		}

		if (target.type === 'deepSky') {
			const index = this.findDeepSkyObjectIndex(target.id)
			return index >= 0 ? { type: 'deepSky', index, object: this.#deepSkyCatalog!.objects[index] } : null
		}

		if (target.type === 'constellationLabel') {
			const labels = this.#constellations.labels ?? []
			const index = labels.findIndex((e) => e.name === target.id)
			return index >= 0 ? { type: 'constellationLabel', index, label: labels[index] } : null
		}

		const index = this.#movingBodyList.findIndex((e) => e.id === target.id)
		return index >= 0 ? { type: 'movingBody', index, object: this.#movingBodyList[index] } : null
	}

	// Returns the catalog index of a deep-sky object id, or -1.
	private findDeepSkyObjectIndex(id: DeepSkyObject['id']) {
		const objects = this.#deepSkyCatalog?.objects
		if (!objects) return -1

		for (let i = 0; i < objects.length; i++) {
			if (objects[i].id === id) return i
		}

		return -1
	}

	// Refreshes the hovered moving body from the current list, or clears it when gone.
	private syncHoverMovingBodyObject() {
		if (this.#hoverObject?.type !== 'movingBody') return

		this.#hoverObject = this.currentMovingBodyObject(this.#hoverObject)
	}

	// Returns the picked moving body as found by id in the current list, or null.
	private currentMovingBodyObject(object: Extract<CelestialObject, { type: 'movingBody' }>): CelestialObject | null {
		const indexed = this.#movingBodyList[object.index]

		if (indexed?.id === object.object.id) {
			return { type: 'movingBody', index: object.index, object: indexed }
		}

		for (let i = 0; i < this.#movingBodyList.length; i++) {
			const movingBody = this.#movingBodyList[i]
			if (movingBody.id === object.object.id) return { type: 'movingBody', index: i, object: movingBody }
		}

		return null
	}

	// Marks the layers that depend on time and observer dirty.
	private markAstronomicalDirty() {
		for (let i = 0; i < ASTRONOMICAL_DIRTY_LAYER_IDS.length; i++) {
			this.#renderer.markDirty(ASTRONOMICAL_DIRTY_LAYER_IDS[i])
		}

		if (this.#options.coordinateSystem === 'equatorial') {
			this.#renderer.markDirty('horizon')
		}

		if (this.#hoverObject || this.#selectedObject) {
			this.#renderer.markDirty('overlay')
		}
	}

	// Projects the stars within the magnitude limit into base screen coordinates, culled to a margin of one
	// canvas size around the viewport (around the canvas for finite disk projections).
	private projectStars() {
		const catalog = this.#starCatalog

		if (!catalog) return

		const width = this.#options.width
		const height = this.#options.height
		const scale = projectionScale(width, height, this.#options.projection)
		const margin = Math.max(width, height)
		const projectionBounds = this.#starProjectionBounds

		if (this.#options.projection === 'gnomonic') {
			writeBaseViewportBounds(width, height, this.#transform, margin, projectionBounds)
		} else {
			projectionBounds[0] = -margin
			projectionBounds[1] = width + margin
			projectionBounds[2] = -margin
			projectionBounds[3] = height + margin
		}

		const maxMagnitude = this.#options.stars.maxMagnitude
		const maxRenderStars = this.#options.stars.maxRenderStars
		const isHorizontal = this.#options.coordinateSystem === 'horizontal'
		const horizontalMatrix = this.#eqToHorizontal
		const temp = this.#tempVector
		const mag = catalog.mag
		const eqX = catalog.eqX
		const eqY = catalog.eqY
		const eqZ = catalog.eqZ
		catalog.beginProjection()

		for (let i = 0; i < catalog.count; i++) {
			if (catalog.visibleCount >= maxRenderStars) {
				break
			}

			if (mag[i] > maxMagnitude) {
				continue
			}

			let x = eqX[i]
			let y = eqY[i]
			let z = eqZ[i]

			if (isHorizontal) {
				multiplyMatrixVector(horizontalMatrix, x, y, z, temp)
				x = temp[0]
				y = temp[1]
				z = temp[2]

				if (z < -HORIZON_EPSILON) {
					continue
				}
			}

			if (!this.projectWorldVectorToBaseScreen(x, y, z, scale, this.#tempScreen)) {
				continue
			}

			const sx = this.#tempScreen[0]
			const sy = this.#tempScreen[1]

			if (sx < projectionBounds[0] || sx > projectionBounds[1] || sy < projectionBounds[2] || sy > projectionBounds[3]) {
				continue
			}

			catalog.recordVisible(i, sx, sy)
		}

		catalog.finalizeProjectionBuckets()
		this.#renderer.markDirty('stars')
	}

	// Returns whether the last star projection still covers the viewport; only the gnomonic projection culls
	// stars by viewport, so panning far may require reprojecting.
	private starProjectionCoversViewport() {
		if (!this.#starCatalog || this.#options.projection !== 'gnomonic') return true

		writeBaseViewportBounds(this.#options.width, this.#options.height, this.#transform, 0, this.#starViewportBounds)
		return this.#starViewportBounds[0] >= this.#starProjectionBounds[0] && this.#starViewportBounds[1] <= this.#starProjectionBounds[1] && this.#starViewportBounds[2] >= this.#starProjectionBounds[2] && this.#starViewportBounds[3] <= this.#starProjectionBounds[3]
	}

	// Projects deep-sky objects into base screen coordinates for reuse during pan and zoom.
	private projectDeepSkyObjects() {
		const catalog = this.#deepSkyCatalog

		if (!catalog) return

		const width = this.#options.width
		const height = this.#options.height
		const scale = projectionScale(width, height, this.#options.projection)
		const margin = Math.max(width, height)
		const cullOutsideProjectionMargin = isFiniteDiskProjection(this.#options.projection)
		const isHorizontal = this.#options.coordinateSystem === 'horizontal'
		const horizontalMatrix = this.#eqToHorizontal
		const temp = this.#tempVector
		catalog.beginProjection()

		for (let i = 0; i < catalog.count; i++) {
			let x = catalog.eqX[i]
			let y = catalog.eqY[i]
			let z = catalog.eqZ[i]

			if (isHorizontal) {
				multiplyMatrixVector(horizontalMatrix, x, y, z, temp)
				x = temp[0]
				y = temp[1]
				z = temp[2]

				if (z < -HORIZON_EPSILON) {
					continue
				}
			}

			if (!this.projectWorldVectorToBaseScreen(x, y, z, scale, this.#tempScreen)) {
				continue
			}

			const screenX = this.#tempScreen[0]
			const screenY = this.#tempScreen[1]

			if (cullOutsideProjectionMargin && (screenX < -margin || screenY < -margin || screenX > width + margin || screenY > height + margin)) {
				continue
			}

			catalog.recordVisible(i, screenX, screenY)
		}

		this.#renderer.markDirty('deepSky')
	}

	// Projects a world unit vector to base screen pixels at `out[0..1]` using `scale` pixels per projection
	// unit; returns false when it is not projectable.
	private projectWorldVectorToBaseScreen(x: number, y: number, z: number, scale: number, out: NumberArray): boolean {
		const vx = this.#viewMatrix[0] * x + this.#viewMatrix[1] * y + this.#viewMatrix[2] * z
		const vy = this.#viewMatrix[3] * x + this.#viewMatrix[4] * y + this.#viewMatrix[5] * z
		const vz = this.#viewMatrix[6] * x + this.#viewMatrix[7] * y + this.#viewMatrix[8] * z

		if (!projectViewVector(this.#options.projection, vx, vy, vz, this.#tempProjection)) {
			return false
		}

		out[0] = this.#options.width / 2 - this.#tempProjection[0] * scale
		out[1] = this.#options.height / 2 - this.#tempProjection[1] * scale
		return true
	}

	// Projects a right ascension and declination in radians to transformed screen pixels.
	private readonly projectEquatorialToScreen = (ra: number, dec: number, out: NumberArray): boolean => {
		this.projectEquatorialSample(ra, dec, out)
		return isProjectedSample(out)
	}

	// Samples a right ascension and declination in radians in transformed screen pixels.
	private readonly projectEquatorialSample = (ra: number, dec: number, out: NumberArray): number => {
		const visibility = this.projectEquatorialBaseSample(ra, dec, out)

		if (isProjectedSample(out)) {
			applyViewTransform(out[0], out[1], this.#options.width, this.#options.height, this.#transform, out)
		}

		return visibility
	}

	// Samples a right ascension and declination in radians in base screen pixels.
	private readonly projectEquatorialBaseSample = (ra: number, dec: number, out: NumberArray): number => {
		writeRaDecUnitVector(ra, dec, this.#tempVector)
		return this.projectEquatorialVectorBaseSample(this.#tempVector[0], this.#tempVector[1], this.#tempVector[2], out)
	}

	// Samples an equatorial unit vector in transformed screen pixels.
	private readonly projectEquatorialVectorSample = (equatorialX: number, equatorialY: number, equatorialZ: number, out: NumberArray): number => {
		const visibility = this.projectEquatorialVectorBaseSample(equatorialX, equatorialY, equatorialZ, out)

		if (isProjectedSample(out)) {
			applyViewTransform(out[0], out[1], this.#options.width, this.#options.height, this.#transform, out)
		}

		return visibility
	}

	// Samples an equatorial unit vector in base screen pixels; visibility is the sine of the altitude in
	// horizontal views and 1 otherwise.
	private readonly projectEquatorialVectorBaseSample = (equatorialX: number, equatorialY: number, equatorialZ: number, out: NumberArray): number => {
		let visibility = 1
		let x = equatorialX
		let y = equatorialY
		let z = equatorialZ

		if (this.#options.coordinateSystem === 'horizontal') {
			multiplyMatrixVector(this.#eqToHorizontal, x, y, z, this.#tempVector)
			x = this.#tempVector[0]
			y = this.#tempVector[1]
			z = this.#tempVector[2]
			visibility = z

			if (visibility < -HORIZON_EPSILON) {
				return writeProjectedSample(out, visibility, false)
			}
		}

		return writeProjectedSample(out, visibility, this.projectWorldVectorToBaseScreen(x, y, z, projectionScale(this.#options.width, this.#options.height, this.#options.projection), out))
	}

	// Projects an azimuth and altitude in radians to transformed screen pixels, in either view frame.
	private readonly projectHorizontalToScreen = (az: number, alt: number, out: NumberArray): boolean => {
		this.projectHorizontalSample(az, alt, out)
		return isProjectedSample(out)
	}

	// Samples an azimuth and altitude in radians in transformed screen pixels.
	private readonly projectHorizontalSample = (az: number, alt: number, out: NumberArray): number => {
		const visibility = this.projectHorizontalBaseSample(az, alt, out)

		if (isProjectedSample(out)) {
			applyViewTransform(out[0], out[1], this.#options.width, this.#options.height, this.#transform, out)
		}

		return visibility
	}

	// Samples an azimuth and altitude in radians in base screen pixels; visibility is the sine of the altitude
	// in horizontal views and 1 otherwise.
	private readonly projectHorizontalBaseSample = (az: number, alt: number, out: NumberArray): number => {
		writeHorizontalUnitVector(az, alt, this.#tempVector)

		let x = this.#tempVector[0]
		let y = this.#tempVector[1]
		let z = this.#tempVector[2]
		const visibility = this.#options.coordinateSystem === 'horizontal' ? z : 1

		if (this.#options.coordinateSystem === 'equatorial') {
			const matrix = this.#eqToHorizontal
			const hx = x
			const hy = y
			const hz = z
			x = matrix[0] * hx + matrix[3] * hy + matrix[6] * hz
			y = matrix[1] * hx + matrix[4] * hy + matrix[7] * hz
			z = matrix[2] * hx + matrix[5] * hy + matrix[8] * hz
		}

		return writeProjectedSample(out, visibility, this.projectWorldVectorToBaseScreen(x, y, z, projectionScale(this.#options.width, this.#options.height, this.#options.projection), out))
	}

	// Rebuilds the picking index from the projected objects of the visible pickable layers.
	private rebuildPickingIndex() {
		this.#pickingDirty = false
		const radius = this.#options.interactions.pickRadius
		this.#picking.reset(this.#options.width, this.#options.height, Math.max(16, radius * 3))
		this.#pickedShapes.length = 0
		const catalog = this.#starCatalog

		if (catalog && this.isLayerVisible('stars')) {
			const indices = catalog.getBucketedVisibleIndices()
			const maxMagnitude = starSymbolMagnitudeLimitAtZoom(this.#transform.k, this.#options.stars.maxMagnitude)

			for (let i = 0; i < catalog.visibleCount; i++) {
				const index = indices[i]

				if (catalog.mag[index] > maxMagnitude) {
					continue
				}

				applyViewTransform(catalog.screenX[index], catalog.screenY[index], this.#options.width, this.#options.height, this.#transform, this.#tempScreen)
				this.#picking.add(PICK_TYPE_STAR, index, this.#tempScreen[0], this.#tempScreen[1], catalog.mag[index])
			}
		}

		if (this.isLayerVisible('deepSky')) {
			const deepSkyCatalog = this.#deepSkyCatalog

			if (deepSkyCatalog) {
				for (let i = 0; i < deepSkyCatalog.visibleCount; i++) {
					const index = deepSkyCatalog.visibleIndices[i]
					const object = deepSkyCatalog.objects[index]

					if (!isDeepSkyObjectVisibleAtZoom(object, this.#transform.k)) {
						continue
					}

					applyViewTransform(deepSkyCatalog.screenX[index], deepSkyCatalog.screenY[index], this.#options.width, this.#options.height, this.#transform, this.#tempScreen)

					if (isPointInsideViewportMargin(this.#tempScreen[0], this.#tempScreen[1], this.#options.width, this.#options.height, DSO_VIEWPORT_MARGIN)) {
						this.#picking.add(PICK_TYPE_DSO, index, this.#tempScreen[0], this.#tempScreen[1], deepSkyMagnitude(object))
					}
				}
			}
		}

		if (this.isLayerVisible('movingBodies')) {
			for (let i = 0; i < this.#movingBodyList.length; i++) {
				const object = this.#movingBodyList[i]

				if (object.visible === false || object.selectable === false || !isMovingBodyVisibleAtZoom(object, this.#transform.k)) {
					continue
				}

				if (this.projectEquatorialToScreen(object.position.rightAscension, object.position.declination, this.#tempScreen)) {
					this.#picking.add(PICK_TYPE_MOVING_BODY, i, this.#tempScreen[0], this.#tempScreen[1], movingBodyMagnitude(object))
				}
			}
		}

		const labels = this.#constellations.labels ?? []

		if (this.isLayerVisible('constellationLabels') && this.#transform.k >= CONSTELLATION_LABEL_MIN_ZOOM) {
			for (let i = 0; i < labels.length; i++) {
				const label = labels[i]

				if (this.projectEquatorialToScreen(label.rightAscension, label.declination, this.#tempScreen)) {
					this.#picking.add(PICK_TYPE_CONSTELLATION_LABEL, i, this.#tempScreen[0], this.#tempScreen[1], 3)
				}
			}
		}

		if (this.isLayerVisible('shapes')) {
			for (let i = 0; i < this.#shapeList.length; i++) {
				const shape = this.#shapeList[i]

				if (shape.visible === false || shape.selectable === false) {
					continue
				}

				if (this.projectEquatorialToScreen(shape.coordinate.rightAscension, shape.coordinate.declination, this.#tempScreen)) {
					const index = this.#pickedShapes.length
					this.#pickedShapes.push(shape)
					this.#picking.add(PICK_TYPE_SHAPE, index, this.#tempScreen[0], this.#tempScreen[1], -8)
				}
			}
		}
	}

	// Rebuilds the picking index when a view change left it stale.
	private ensurePickingIndex() {
		if (!this.#pickingDirty) return

		this.rebuildPickingIndex()
	}

	// Schedules one animation-frame render unless one is pending or the map is destroyed.
	private requestRender() {
		if (this.#frameId || this.#destroyed) return

		this.#frameId = requestAnimationFrame(() => {
			this.#frameId = 0
			this.flushRender()
		})
	}

	// Redraws the dirty layers, emitting renderStart and renderEnd when listened.
	private flushRender() {
		const emitRenderStart = this.#emitter.has('renderStart')
		const emitRenderEnd = this.#emitter.has('renderEnd')
		const start = emitRenderEnd ? performance.now() : 0
		emitRenderStart && this.#emitter.emit('renderStart', { time: this.#options.time })
		this.#renderer.render(this.createRenderState())

		if (emitRenderEnd) {
			const duration = performance.now() - start
			const fps = duration > 0 ? 1000 / duration : 0
			this.#emitter.emit('renderEnd', { time: this.#options.time, duration, fps })
		}
	}

	// Returns the render state passed to layers. The object is reused across frames and only its volatile
	// fields are refreshed, so per-frame work during pan/zoom avoids object allocation.
	private createRenderState(): RenderState {
		const options = this.#options
		let state = this.#renderState

		if (!state) {
			// Bound method references and `this` are stable for the instance lifetime, so they are set once.
			// Volatile fields are assigned right below; the cast covers the partial initializer.
			state = {
				celestial: this,
				projectEquatorialToScreen: this.projectEquatorialToScreen,
				projectEquatorialSample: this.projectEquatorialSample,
				projectEquatorialVectorSample: this.projectEquatorialVectorSample,
				projectEquatorialBaseSample: this.projectEquatorialBaseSample,
				projectEquatorialVectorBaseSample: this.projectEquatorialVectorBaseSample,
				projectHorizontalToScreen: this.projectHorizontalToScreen,
				projectHorizontalSample: this.projectHorizontalSample,
				projectHorizontalBaseSample: this.projectHorizontalBaseSample,
			} as unknown as Writable<RenderState>

			this.#renderState = state
		}

		state.width = options.width
		state.height = options.height
		state.dpr = this.#renderer.devicePixelRatio
		state.time = options.time
		state.observer = options.observer
		state.projection = options.projection
		state.coordinateSystem = options.coordinateSystem
		state.transform = this.#transform
		state.projectionRadius = projectionScale(options.width, options.height, options.projection)
		state.projectedGeometryRevision = this.#projectedGeometryRevision
		state.referenceLines = options.referenceLines
		state.stars = options.stars
		state.theme = options.theme
		state.starCatalog = this.#starCatalog
		state.deepSkyCatalog = this.#deepSkyCatalog
		state.constellations = this.#constellations
		state.milkyWay = this.#milkyWay
		state.movingBodies = this.#movingBodyList
		state.shapes = this.#shapeList
		state.hoverObject = this.#hoverObject
		state.selectedObject = this.#selectedObject
		return state
	}

	// Resolves a pick result into a picked-object payload, or null.
	private resolvePick(index: PickIndex | null): CelestialObject | null {
		if (!index) return null

		switch (index.type) {
			case PICK_TYPE_STAR:
				return this.#starCatalog?.getObject(index.index) ?? null
			case PICK_TYPE_DSO: {
				const object = this.#deepSkyCatalog?.objects[index.index]
				return object ? { type: 'deepSky', index: index.index, object } : null
			}
			case PICK_TYPE_MOVING_BODY: {
				const object = this.#movingBodyList[index.index]
				return object ? { type: 'movingBody', index: index.index, object } : null
			}
			case PICK_TYPE_CONSTELLATION_LABEL: {
				const label = this.#constellations.labels?.[index.index]
				return label ? { type: 'constellationLabel', index: index.index, label } : null
			}
			case PICK_TYPE_SHAPE: {
				const shape = this.#pickedShapes[index.index]
				return shape ? { type: 'shape', id: shape.id, shape } : null
			}
			default:
				return null
		}
	}

	// Resolves a pointer pick, reusing the hover object when the pick still refers to it.
	private resolvePointerPick(index: PickIndex | null): CelestialObject | null {
		if (pickMatchesObject(index, this.#hoverObject)) {
			return this.#hoverObject
		}

		return this.resolvePick(index)
	}

	// Emits an error event instead of throwing inside update and render loops.
	private emitError(error: Error) {
		this.#emitter.emit('error', error)
	}

	// Binds the pointer handlers for pan, pinch and wheel zoom, hover, and click.
	private bindInteractions() {
		if (!this.#options.interactions.enabled) return

		const element = this.#renderer.element
		element.addEventListener('pointerdown', this.handlePointerDown)
		element.addEventListener('pointermove', this.handlePointerMove)
		element.addEventListener('click', this.handleClick)
		element.addEventListener('wheel', this.handleWheel, { passive: false })
		document.addEventListener('pointerup', this.handlePointerUp)
		document.addEventListener('pointercancel', this.handlePointerUp)
	}

	// Removes the pointer handlers.
	private unbindInteractions() {
		const element = this.#renderer.element
		element.removeEventListener('pointerdown', this.handlePointerDown)
		element.removeEventListener('pointermove', this.handlePointerMove)
		element.removeEventListener('click', this.handleClick)
		element.removeEventListener('wheel', this.handleWheel)
		document.removeEventListener('pointerup', this.handlePointerUp)
		document.removeEventListener('pointercancel', this.handlePointerUp)
	}

	// Re-anchors the gesture on the pointers still down, or ends it when none is.
	private restartGesture() {
		this.#gesture = beginGesture(this.#activePointers.values(), this.#transform)
	}

	// Records that the pointers moved the view since the first press, emitting panStart the first time in a
	// gesture: the user took over the viewport.
	private markPointerMoved() {
		if (this.#pointerMoved) return
		this.#pointerMoved = true
		this.#emitter.has('panStart') && this.#emitter.emit('panStart', {})
	}

	// Adds a pressed pointer (primary button, finger, or pen) to the gesture; a second pointer starts a pinch.
	private readonly handlePointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) return

		const point = this.eventPoint(event)

		if (this.#activePointers.size === 0) {
			this.#pointerMoved = false
		}

		this.#activePointers.set(event.pointerId, { x: point[0], y: point[1], startX: point[0], startY: point[1] })
		if (this.#activePointers.size > 1) this.markPointerMoved()
		this.restartGesture()
		this.#renderer.element.setPointerCapture?.(event.pointerId)
	}

	// Pans or pinches while pointers are down, otherwise updates the hover pick at most once per throttle
	// interval.
	private readonly handlePointerMove = (event: PointerEvent): void => {
		const point = this.eventPoint(event)
		const x = point[0]
		const y = point[1]
		this.#lastPointerX = x
		this.#lastPointerY = y

		const pointer = this.#activePointers.get(event.pointerId)

		if (pointer) {
			pointer.x = x
			pointer.y = y
			if (Math.abs(x - pointer.startX) + Math.abs(y - pointer.startY) > 3) this.markPointerMoved()

			if (this.#gesture) {
				const { width, height, interactions } = this.#options
				const transform = gestureTransform(this.#gesture, this.#activePointers.values(), width, height, interactions.minZoom, interactions.maxZoom)

				if (this.writeViewTransform(transform)) {
					this.afterTransformChanged()
				}
			}

			return
		}

		if (this.#activePointers.size > 0) return

		const now = performance.now()

		if (now - this.#lastPointerMove < this.#options.interactions.pointerMoveThrottleMs) return

		this.#lastPointerMove = now
		this.updatePointerHover(x, y)
	}

	// Removes a released or cancelled pointer from the gesture, refreshing the hover when the last one lifts
	// after moving the view.
	private readonly handlePointerUp = (event: PointerEvent): void => {
		if (!this.#activePointers.delete(event.pointerId)) return

		this.#renderer.element.releasePointerCapture?.(event.pointerId)
		this.restartGesture()

		if (this.#activePointers.size === 0 && this.#pointerMoved) {
			this.refreshPointerHover()
		}
	}

	// Emits click and selects the picked object, unless the click ended a pan or pinch.
	private readonly handleClick = (event: MouseEvent): void => {
		if (this.#pointerMoved) return

		const point = this.eventPoint(event)
		const x = point[0]
		const y = point[1]

		this.ensurePickingIndex()
		const object = this.resolvePick(this.#picking.findNearest(x, y, this.#options.interactions.pickRadius))

		if (this.#emitter.has('click')) {
			const coordinate = this.screenToEquatorial(x, y)

			if (coordinate) {
				this.#emitter.emit('click', { x, y, coordinate, object, event })
			}
		}

		if (!object) return

		this.#selectedObject = object
		this.#renderer.markDirty('overlay')
		this.#emitter.has('selectionChange') && this.#emitter.emit('selectionChange', { object })
		this.requestRender()
	}

	// Zooms around the pointer on wheel, re-anchoring a gesture in progress.
	private readonly handleWheel = (event: WheelEvent): void => {
		event.preventDefault()

		const point = this.eventPoint(event)
		const previousK = this.#transform.k
		const nextK = clamp(previousK * Math.exp(-normalizedWheelDeltaY(event) * this.#options.interactions.wheelZoomSpeed), this.#options.interactions.minZoom, this.#options.interactions.maxZoom)

		if (nextK === previousK) return

		this.writeViewTransform(anchoredTransform(this.#transform, point[0], point[1], point[0], point[1], nextK, this.#options.width, this.#options.height))
		this.restartGesture()
		this.afterTransformChanged()
	}

	// Returns a transform with non-finite values reset and the zoom clamped to the configured range.
	private normalizeViewTransform(transform: ViewTransform): ViewTransform {
		return {
			x: isFiniteNumber(transform.x) ? transform.x : 0,
			y: isFiniteNumber(transform.y) ? transform.y : 0,
			k: clamp(isFiniteNumber(transform.k) ? transform.k : 1, this.#options.interactions.minZoom, this.#options.interactions.maxZoom),
		}
	}

	// Replaces the transform and returns whether it changed.
	private writeViewTransform(transform: ViewTransform) {
		if (transform.x === this.#transform.x && transform.y === this.#transform.y && transform.k === this.#transform.k) return false
		this.#transform = transform
		return true
	}

	// Redraws after a pan or zoom, reprojecting stars only when the view left the projected area.
	private afterTransformChanged() {
		this.#pickingDirty = true

		if (!this.starProjectionCoversViewport()) {
			this.projectStars()
		}

		this.#renderer.markAllDirty()
		this.#emitter.has('viewTransformChange') && this.#emitter.emit('viewTransformChange', { transform: this.#transform })
		this.requestRender()
	}

	// Re-picks at the last pointer position, or clears the hover when the pointer never moved over the map.
	private refreshPointerHover() {
		if (Number.isFinite(this.#lastPointerX) && Number.isFinite(this.#lastPointerY)) {
			this.updatePointerHover(this.#lastPointerX, this.#lastPointerY)
		} else {
			this.updateHover(null)
		}
	}

	// Picks at a map-local position, emitting hover and updating the hover object.
	private updatePointerHover(x: number, y: number) {
		this.ensurePickingIndex()
		const object = this.resolvePointerPick(this.#picking.findNearest(x, y, this.#options.interactions.pickRadius))

		if (this.#emitter.has('hover')) {
			const coordinate = this.screenToEquatorial(x, y)

			if (coordinate) {
				this.#emitter.emit('hover', { x, y, coordinate, object })
			}
		}

		this.updateHover(object)
	}

	// Replaces the hover object, emitting objectLeave and objectHover when it changed.
	private updateHover(object: CelestialObject | null) {
		if (sameObject(this.#hoverObject, object)) return

		if (this.#hoverObject && this.#emitter.has('objectLeave')) {
			this.#emitter.emit('objectLeave', { object: this.#hoverObject })
		}

		this.#hoverObject = object

		if (object && this.#emitter.has('objectHover')) {
			this.#emitter.emit('objectHover', { object })
		}

		this.#renderer.markDirty('overlay')
		this.requestRender()
	}

	// Invalidates the cached element rect after scroll or resize moved the map.
	private readonly invalidateRect = (): void => {
		this.#cachedRect = null
	}

	// Converts a pointer event's client position into map-local pixels in a reused array.
	private eventPoint(event: MouseEvent) {
		let rect = this.#cachedRect

		if (!rect) {
			rect = this.#renderer.element.getBoundingClientRect()
			this.#cachedRect = rect
		}

		this.#tempScreen[0] = event.clientX - rect.left
		this.#tempScreen[1] = event.clientY - rect.top
		return this.#tempScreen
	}
}
