import type { SkyObjectCategory, SkyObjectRef, SkyPosition } from 'api'
import { DEG2RAD, TAU } from 'nebulosa/src/core/constants'
import { proxy, subscribe } from 'valtio'
import type { SkyObserverSettings } from '../profile/schema'
import { Celestial, type CelestialObject, type CelestialOptions, type ConstellationLine, type CoordinateSystem, type MovingBody, type MovingBodyType, type RenderState, type SelectionTarget } from './celestial/celestial'
import { SKY_REALTIME_TICK_MS, type SkyClockMode, skyClock, skyTime } from './clock'
import { applySkyDisplay, MAP_STAR_MAGNITUDE_LIMIT, type SkyDisplaySettings } from './display'
import { formatAngularSize } from './format'
import { type FramePoint, framePolygon, isFraming, type OpticalConfiguration, resolveFraming } from './framing'
import { type MountPoint, mountRuntime } from './mount'
import { hoverLabel, type MapNames, MOUNT_SHAPE_TYPE, type MountMarkerData, type MountRef, movingBodyId, refKey, refOfCelestialObject, selectionTargets, type SkySelectionRef } from './objects'
import { isRememberable, type RememberedObject, RememberedObjects, type RememberedShapeData, REMEMBERED_SHAPE_TYPE, rememberedOf, rememberedShapeId } from './remembered'
import { createRequestGuard } from './selection'
import { apiObserver, browserSkyIo, fetchSkyBodies, fetchSkyPosition, loadSkyMapData, mapDataCovers, REALTIME_REFRESH, refreshSkySelection, type SkyRefreshOptions, type SkySelection, selectSkyObject, skyState } from './sky'

// The Sky workspace's star map, kept for the whole tab: the Celestial instance, its catalogs, the moving
// bodies, and the selection highlight live here rather than in React, so leaving the workspace only
// detaches the map from the page and stops its clock, and returning reattaches the same map with its
// view, data, and selection. A new map is created only when the kind of chart changes: the observer's
// local sky (horizontal, zenith at the center) when there is an observer, an equatorial chart of the
// whole sky otherwise. Objects below the local horizon are neither drawn nor highlighted. The map shows
// the instant of the Sky simulation clock (./clock); its catalogs are reloaded in place when the clock
// stops more than a year away from the instant they were computed for. The mount's reported position is
// drawn as a selectable marker while the clock shows the real time, and the view can be centered on it
// or follow it until the user pans. Selected objects the map data lacks (minor bodies, and catalog
// objects fainter than it) are remembered for the tab (./remembered) and stay drawn and selectable, the
// minor bodies moved at every update.

// Interval of the map's updates in milliseconds while the clock plays.
const PLAYING_INTERVAL_MS = 250

// Map updates per refresh of the selection's position while the clock plays: one every 2 s.
const PLAYING_SELECTION_TICKS = 8

// Delay in milliseconds before the selection's position is refreshed for a fixed instant, so stepping the
// clock repeatedly asks only for the instant reached.
const FIXED_SETTLE_MS = 400

// How the selection's position is refreshed, by clock mode: accurately when the instant is current or
// fixed, and from the local models while playing (a fixed instant reached by pausing is then refined).
const REFRESH: Readonly<Record<SkyClockMode, SkyRefreshOptions>> = { now: REALTIME_REFRESH, fixed: { tolerance: 0, mode: 'accurate' }, playing: { tolerance: 0, mode: 'fast' } }

// Smallest zoom factor of the local sky (about a 15° field on a phone) from which the view stays on the
// same point of the sky across clock updates, as a tracking telescope would, rather than on the same point
// of the horizon; at higher zoom the sky would otherwise drift by hundreds of pixels per update.
const SKY_ANCHOR_ZOOM = 8

// Color of the selection reticle.
const SELECTION_COLOR = '#7e57c2'

// Color of the symbol and name of a remembered catalog object, muted beside the map's own objects.
const REMEMBERED_COLOR = '#b0bec5'

// Radius of the ring of a remembered catalog object in pixels.
const REMEMBERED_RING_RADIUS = 4

// Id of the custom shape drawing the field of view.
const FRAMING_SHAPE_ID = 'framing'

// Color of the field of view outline.
const FRAMING_COLOR = '#4dd0e1'

// Points sampled along each edge of the field of view, so wide fields follow the projection's curvature.
const FRAMING_EDGE_SAMPLES = 16

// Smallest on-screen size of the field of view in pixels for which its label is drawn.
const FRAMING_LABEL_MIN_PX = 60

// Id of the custom shape marking the mount's position.
const MOUNT_MARKER_ID = 'mount-marker'

// Color of the mount marker, distinct from the selection reticle and the field of view.
const MOUNT_COLOR = '#66bb6a'

// Color of the dark halo under the mount marker, keeping it legible over bright areas.
const MOUNT_HALO = 'rgba(0, 0, 0, 0.6)'

// Radius of the mount marker's ring in pixels.
const MOUNT_RING_RADIUS = 9

// Inner and outer distance of the mount marker's crosshair ticks from its center, in pixels.
const MOUNT_TICK_RANGE = [4, 15] as const

// Draws the mount marker at a screen point (pixels): a ring with a crosshair through it and the mount's
// name beside it.
function drawMountMarker(ctx: CanvasRenderingContext2D, x: number, y: number, name: string) {
	ctx.lineCap = 'round'

	for (const [lineWidth, strokeStyle] of [
		[4, MOUNT_HALO],
		[1.5, MOUNT_COLOR],
	] as const) {
		ctx.lineWidth = lineWidth
		ctx.strokeStyle = strokeStyle
		ctx.beginPath()
		ctx.arc(x, y, MOUNT_RING_RADIUS, 0, TAU)
		ctx.moveTo(x - MOUNT_TICK_RANGE[1], y)
		ctx.lineTo(x - MOUNT_TICK_RANGE[0], y)
		ctx.moveTo(x + MOUNT_TICK_RANGE[0], y)
		ctx.lineTo(x + MOUNT_TICK_RANGE[1], y)
		ctx.moveTo(x, y - MOUNT_TICK_RANGE[1])
		ctx.lineTo(x, y - MOUNT_TICK_RANGE[0])
		ctx.moveTo(x, y + MOUNT_TICK_RANGE[0])
		ctx.lineTo(x, y + MOUNT_TICK_RANGE[1])
		ctx.stroke()
	}

	ctx.fillStyle = MOUNT_COLOR
	ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
	ctx.textAlign = 'left'
	ctx.textBaseline = 'middle'
	ctx.fillText(name, x + MOUNT_TICK_RANGE[1] + 4, y)
}

// Draws a remembered catalog object at a screen point (pixels): a small ring with its name beside it.
function drawRememberedObject(ctx: CanvasRenderingContext2D, x: number, y: number, name: string) {
	ctx.strokeStyle = REMEMBERED_COLOR
	ctx.lineWidth = 1.5
	ctx.beginPath()
	ctx.arc(x, y, REMEMBERED_RING_RADIUS, 0, TAU)
	ctx.stroke()
	ctx.fillStyle = REMEMBERED_COLOR
	ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
	ctx.textAlign = 'left'
	ctx.textBaseline = 'middle'
	ctx.fillText(name, x + REMEMBERED_RING_RADIUS + 4, y)
}

// Strokes the outline of a field of view (equatorial points in radians), breaking it where points cannot
// be projected, with a cross at its center and, when it is large enough on screen, its label.
function drawFraming(ctx: CanvasRenderingContext2D, state: RenderState, outline: readonly FramePoint[], label: string) {
	const point = new Float64Array(2)
	let open = false
	let minX = Infinity
	let maxX = -Infinity
	let minY = Infinity

	ctx.beginPath()

	for (const { rightAscension, declination } of outline) {
		if (!state.projectEquatorialToScreen(rightAscension, declination, point)) {
			open = false
			continue
		}

		if (open) ctx.lineTo(point[0], point[1])
		else ctx.moveTo(point[0], point[1])
		open = true
		minX = Math.min(minX, point[0])
		maxX = Math.max(maxX, point[0])
		minY = Math.min(minY, point[1])
	}

	ctx.strokeStyle = FRAMING_COLOR
	ctx.lineWidth = 1.5
	ctx.stroke()

	if (maxX - minX >= FRAMING_LABEL_MIN_PX) {
		ctx.fillStyle = FRAMING_COLOR
		ctx.font = '11px ui-monospace, monospace'
		ctx.textAlign = 'left'
		ctx.textBaseline = 'bottom'
		ctx.fillText(label, minX, minY - 4)
	}
}

// Map symbol and name of each major body, by Horizons command.
const BODY_TYPES: readonly (readonly [string, MovingBodyType, string])[] = [
	['10', 'sun', 'Sun'],
	['301', 'moon', 'Moon'],
	['199', 'mercury', 'Mercury'],
	['299', 'venus', 'Venus'],
	['499', 'mars', 'Mars'],
	['599', 'jupiter', 'Jupiter'],
	['699', 'saturn', 'Saturn'],
	['799', 'uranus', 'Uranus'],
	['899', 'neptune', 'Neptune'],
	['999', 'asteroid', 'Pluto'],
]

// Loading state of the map data, shown by the workspace.
export interface PlanetariumState {
	// Whether the map data is loading, loaded, or failed to load.
	status: 'loading' | 'ready' | 'error'
	// Why the map data failed to load.
	error?: string
}

// Loading state of the map data of the current map.
export const planetariumState = proxy<PlanetariumState>({ status: 'loading' })

// Construction options of a map: a stereographic chart without the Milky Way (it has no data). The local
// meridian is drawn only on the local sky, the only chart that has an observer.
function mapOptions(coordinateSystem: CoordinateSystem): CelestialOptions {
	return {
		width: 1,
		height: 1,
		projection: 'stereographic',
		coordinateSystem,
		stars: { maxMagnitude: MAP_STAR_MAGNITUDE_LIMIT },
		layers: { milkyWay: false, constellationBoundaries: false },
		referenceLines: { localMeridian: { enabled: coordinateSystem === 'horizontal' } },
		theme: { selectedObject: { color: SELECTION_COLOR } },
	}
}

// Group of an object picked on the map; undefined for the mount marker.
function categoryOf(object: CelestialObject, objectRef: SkySelectionRef): SkyObjectCategory | undefined {
	if (objectRef.kind === 'mount') return undefined
	if (object.type === 'shape') return rememberedOf(object)?.category
	if (object.type === 'star') return 'star'
	if (object.type === 'deepSky') return 'deepSky'
	if (objectRef.kind === 'constellation') return 'constellation'
	return objectRef.kind === 'body' ? 'solarSystem' : 'minorBody'
}

// Key that changes whenever the observer's location changes.
export function observerKey(observer?: SkyObserverSettings) {
	return observer ? `${observer.latitude},${observer.longitude},${observer.elevation}` : ''
}

// Star map of the tab.
export class Planetarium {
	// The Celestial map.
	readonly celestial: Celestial
	// Kind of chart, fixed for the map's lifetime.
	readonly coordinateSystem: CoordinateSystem
	// Element holding the map's canvases, moved into the workspace while it is shown.
	readonly #host: HTMLDivElement
	readonly #bodies = new Map<string, MovingBody>()
	readonly #bodiesGuard = createRequestGuard()
	readonly #minorGuard = createRequestGuard()
	readonly #locateGuard = createRequestGuard()
	readonly #loadGuard = createRequestGuard()
	readonly #unsubscribe: VoidFunction[]
	#names: MapNames = { typeNames: [], starDesignations: [], constellationCodes: new Map() }
	#observer?: SkyObserverSettings
	// Second and observer of the body positions requested last, so repeated updates do not refetch them.
	#bodiesKey = ''
	// Whether body positions are being requested; updates meanwhile only record their instant.
	#bodiesBusy = false
	// Instant (Unix milliseconds) of the latest update that arrived while body positions were requested.
	#bodiesPending?: number
	// Instant the loaded catalogs were computed for, Unix milliseconds; absent before the first load.
	#dataTime?: number
	// Ids of the shapes of the remembered catalog objects on the map.
	readonly #rememberedShapes = new Set<string>()
	// Whether the field of view shape is on the map.
	#framing = false
	// Mount marker on the map, whose coordinate is moved in place as the mount moves; absent while not drawn.
	#mountMarker?: { readonly coordinate: { rightAscension: number; declination: number }; readonly data: MountMarkerData }
	#resizeObserver?: ResizeObserver
	// Timer of the clock updates while attached.
	#clockTimer?: Timer
	// Point of date (radians) at the middle of the view before the latest clock update, recentered once the
	// map is updated; absent when the view keeps the horizon still.
	#anchor?: MountPoint
	// Instant the map shows, Unix milliseconds (UTC).
	#shownTime: number
	// Timer of the refresh of the selection for a fixed instant, once it settles.
	#settleTimer?: Timer
	// Stops following the simulation clock; set while attached.
	#unsubscribeClock?: VoidFunction
	#destroyed = false

	// Creates the map of a kind of chart for an observer and starts loading its data.
	constructor(coordinateSystem: CoordinateSystem, observer?: SkyObserverSettings) {
		this.coordinateSystem = coordinateSystem
		this.#host = document.createElement('div')
		this.#host.className = 'absolute inset-0 touch-none overflow-hidden select-none'
		this.celestial = new Celestial(this.#host, mapOptions(coordinateSystem))
		this.setObserver(observer)

		for (const [code, type, name] of BODY_TYPES) {
			const body: MovingBody = { id: `body:${code}`, type, name, position: { rightAscension: 0, declination: 0 }, visible: false }
			this.#bodies.set(body.id, body)
			this.celestial.addMovingBody(body)
		}

		for (const object of remembered.values()) this.#drawRemembered(object)

		this.#shownTime = this.time
		this.celestial.setTime(this.#shownTime)
		this.#unsubscribe = [this.celestial.on('selectionChange', ({ object }) => this.#handleClick(object)), this.celestial.on('updateEnd', ({ time }) => this.#updateEnded(time)), this.celestial.on('panStart', () => (mountRuntime.following = false))]
		this.load()
	}

	// Instant the map shows, Unix milliseconds (UTC).
	get time() {
		return skyTime(skyClock, Date.now())
	}

	// Map data that names the drawn objects.
	get names(): MapNames {
		return this.#names
	}

	// Shows the map inside a container, following its size and the simulation clock.
	attach(container: HTMLElement) {
		if (this.#destroyed) return

		container.append(this.#host)
		const rect = container.getBoundingClientRect()
		this.celestial.resize(rect.width, rect.height)
		this.#resizeObserver = new ResizeObserver(([entry]) => entry && this.celestial.resize(entry.contentRect.width, entry.contentRect.height))
		this.#resizeObserver.observe(container)
		this.#unsubscribeClock = subscribe(skyClock, () => this.#followClock())
		this.#followClock()
	}

	// Removes the map from the page and stops following the clock; the map keeps its state.
	detach() {
		this.#resizeObserver?.disconnect()
		this.#resizeObserver = undefined
		this.#unsubscribeClock?.()
		this.#unsubscribeClock = undefined
		this.#stopClock()
		this.#host.remove()
	}

	// Releases the map for good.
	destroy() {
		if (this.#destroyed) return
		this.#destroyed = true
		this.detach()
		for (const off of this.#unsubscribe) off()
		this.#bodiesGuard.cancel()
		this.#minorGuard.cancel()
		this.#locateGuard.cancel()
		this.#loadGuard.cancel()
		this.celestial.destroy()
	}

	// Loads the map data for the instant shown (downloaded once per tab and epoch), or retries after a
	// failure. A reload for another epoch keeps the current data drawn until the new data arrives.
	load() {
		planetariumState.status = 'loading'
		planetariumState.error = undefined
		const request = this.#loadGuard.begin()

		loadSkyMapData().then(
			({ stars, dsos, constellations, time }) => {
				if (this.#destroyed || !request.current()) return
				this.#dataTime = time
				this.#names = { typeNames: dsos.typeNames, starDesignations: stars.designations, constellationCodes: new Map(constellations.labels.map((e) => [e.name, e.code])) }
				this.celestial.loadStars({ ra: stars.ra as number[], dec: stars.dec as number[], mag: stars.mag as number[], bv: stars.bv as number[], names: stars.names, ids: stars.ids })
				this.celestial.loadDeepSkyObjects(dsos.ids.map((id, i) => ({ id, name: dsos.names[i], type: dsos.types[i], rightAscension: dsos.ra[i], declination: dsos.dec[i], magnitude: dsos.mag[i] ?? undefined, sizeArcMin: dsos.size[i] || undefined })))
				this.celestial.loadConstellations({ lines: constellations.lines as ConstellationLine[], boundaries: constellations.boundaries as ConstellationLine[], labels: constellations.labels.map(({ name, rightAscension, declination }) => ({ name, rightAscension, declination })) })
				planetariumState.status = 'ready'
				this.syncSelection()
			},
			(error: unknown) => {
				if (this.#destroyed || !request.current()) return
				planetariumState.error = error instanceof Error ? error.message : 'Unknown error'
				planetariumState.status = 'error'
			},
		)
	}

	// Follows an observer: its location on the map and in the requests of bodies and selections.
	setObserver(observer?: SkyObserverSettings) {
		this.#observer = observer
		if (observer) this.celestial.setObserver({ latitude: observer.latitude, longitude: observer.longitude, elevation: observer.elevation })
		this.celestial.setLayerVisible('horizon', !!observer)
	}

	// Draws the field of view of an optical configuration named name around a center (equatorial point of
	// date in radians), or removes it when hidden or when there is no configuration, field, or center. The
	// caller passes the selection's point at the instant shown, so the field follows it.
	syncFraming(source: { readonly name: string; readonly optics: Readonly<OpticalConfiguration> } | undefined, visible: boolean, center: FramePoint | undefined) {
		const framing = source && resolveFraming(source.optics)

		if (!visible || !source || !framing || !isFraming(framing) || !center) {
			if (this.#framing) this.celestial.removeShape(FRAMING_SHAPE_ID)
			this.#framing = false
			return
		}

		const outline = framePolygon(center, framing.width, framing.height, source.optics.rotation * DEG2RAD, FRAMING_EDGE_SAMPLES)
		const label = `${source.name} · ${formatAngularSize(framing.width)} × ${formatAngularSize(framing.height)} · PA ${source.optics.rotation.toFixed(1)}°`
		this.#framing = true
		this.celestial.addShape({ id: FRAMING_SHAPE_ID, coordinate: { ...center }, selectable: false, render: (_, ctx, state) => drawFraming(ctx, state.state, outline, label) })
	}

	// Draws the mount marker at a point of date (radians), moving the existing marker in place so a
	// selected marker keeps its highlight, or removes it when there is no mount or point. Recenters the
	// view on it while the mount is followed.
	syncMount(mount: { readonly ref: MountRef; readonly name: string } | undefined, point: MountPoint | undefined) {
		if (!mount || !point) {
			if (this.#mountMarker) this.celestial.removeShape(MOUNT_MARKER_ID)
			this.#mountMarker = undefined
			return
		}

		const marker = this.#mountMarker

		if (marker && refKey(marker.data.ref) === refKey(mount.ref) && marker.data.name === mount.name) {
			marker.coordinate.rightAscension = point.rightAscension
			marker.coordinate.declination = point.declination
			this.celestial.markShapeChanged(MOUNT_MARKER_ID)
		} else {
			const coordinate = { rightAscension: point.rightAscension, declination: point.declination }
			const data: MountMarkerData = { ref: mount.ref, name: mount.name }
			this.#mountMarker = { coordinate, data }
			this.celestial.addShape({ id: MOUNT_MARKER_ID, type: MOUNT_SHAPE_TYPE, coordinate, data, render: (_, ctx, state) => drawMountMarker(ctx, state.x, state.y, data.name) })
		}

		if (mountRuntime.following) this.centerOn(point)
	}

	// Pans the view to a point of date (radians), keeping the zoom, orientation, and layers; a point below
	// the local horizon leaves the view unchanged.
	centerOn(point: MountPoint) {
		this.celestial.centerOnCoordinate(point.rightAscension, point.declination)
	}

	// Applies the display preferences in place, keeping the view and data; the local meridian is drawn
	// only on the local sky.
	applyDisplay(display: Readonly<SkyDisplaySettings> | undefined) {
		applySkyDisplay(this.celestial, display, this.coordinateSystem === 'horizontal', MAP_STAR_MAGNITUDE_LIMIT)
	}

	// Highlights the selection, and nothing without a selection. A minor body, or a catalog object the map
	// data lacks (fainter than it), is remembered at the selection's position, so it is drawn, highlighted,
	// and kept on the map for the tab, following the selection's position while selected.
	syncSelection() {
		const selection = skyState.selection

		if (!selection) {
			this.celestial.selectObject(null)
			return
		}

		const targets = selectionTargets(selection.ref, selection.category, this.#names)
		// A clicked object (such as one of the two Serpens labels) keeps its highlight.
		const found = this.#isSelected(selection.key) ? this.celestial.selectedObject : this.#selectFirst(targets)
		const position = selection.position

		if (position && (selection.ref.kind === 'minorBody' || (selection.ref.kind === 'catalog' && (!found || found.type === 'shape')))) {
			this.#remember(selection, position)
			if (!found) this.#selectFirst(targets)
		}
	}

	// Draws a minor body chosen in the search at its position now, remembering it; the selection highlights
	// it.
	async locateMinorBody(objectRef: SkyObjectRef) {
		const request = this.#locateGuard.begin()
		const key = refKey(objectRef)

		try {
			const { position } = await fetchSkyPosition(objectRef, this.time, apiObserver(this.#observer), 'fast', request.signal)
			const selection = skyState.selection
			if (!request.current() || selection?.key !== key) return
			this.#remember(selection, selection.position ?? position)
			this.syncSelection()
		} catch {
			// The Inspector shows why the position is unavailable.
		}
	}

	// Highlights the first loaded object of a list of selection targets; returns it, or null when none is.
	#selectFirst(targets: readonly SelectionTarget[]): CelestialObject | null {
		for (const target of targets) {
			const found = this.celestial.selectObject(target)
			if (found) return found
		}

		return null
	}

	// Remembers the selected object at a position (of date, radians), or updates it, and draws it; the least
	// recently selected objects beyond REMEMBERED_LIMIT are forgotten and removed from the map.
	#remember(selection: SkySelection, position: SkyPosition) {
		const objectRef = selection.ref
		if (!isRememberable(objectRef)) return

		const known = remembered.get(selection.key)
		const minorBody = selection.minorBody ?? known?.minorBody
		const object: RememberedObject = known ?? { ref: objectRef, key: selection.key, name: '', typeName: '', rightAscension: 0, declination: 0 }
		object.name = minorBody?.name ?? selection.name
		object.typeName = selection.catalog?.typeName ?? (objectRef.kind === 'minorBody' ? (minorBody?.kind === 'comet' ? 'Comet' : 'Minor Body') : selection.category === 'deepSky' ? 'Deep-Sky Object' : 'Star')
		object.category = selection.category ?? object.category
		object.minorBody = minorBody
		object.rightAscension = position.rightAscension
		object.declination = position.declination
		object.magnitude = position.magnitude ?? selection.catalog?.magnitude

		for (const forgotten of remembered.remember(object)) this.#forget(forgotten)
		this.#drawRemembered(object)
	}

	// Draws a remembered object at its position, or moves it there: a minor body as a moving body, a catalog
	// object as a selectable shape.
	#drawRemembered(object: RememberedObject) {
		if (object.ref.kind === 'minorBody') {
			this.#showMinorBody(object)
			return
		}

		const id = rememberedShapeId(object.key)

		if (this.#rememberedShapes.has(id)) {
			this.celestial.markShapeChanged(id)
		} else {
			const data: RememberedShapeData = { key: object.key, object }
			this.#rememberedShapes.add(id)
			this.celestial.addShape({ id, type: REMEMBERED_SHAPE_TYPE, coordinate: object, data, render: (_, ctx, state) => drawRememberedObject(ctx, state.x, state.y, object.name) })
		}
	}

	// Removes a forgotten object from the map.
	#forget(object: RememberedObject) {
		const bodyId = movingBodyId(object.ref)

		if (bodyId) {
			this.#bodies.delete(bodyId)
			this.celestial.removeMovingBody(bodyId)
		} else {
			const id = rememberedShapeId(object.key)
			this.#rememberedShapes.delete(id)
			this.celestial.removeShape(id)
		}
	}

	// Whether the map's selected object is the object of a selection key.
	#isSelected(key: string) {
		const object = this.celestial.selectedObject
		const objectRef = object && refOfCelestialObject(object, this.#names)
		return !!objectRef && refKey(objectRef) === key
	}

	// Selects the object clicked on the map; custom shapes keep the current highlight.
	#handleClick(object: CelestialObject) {
		const objectRef = refOfCelestialObject(object, this.#names)

		if (!objectRef) {
			this.syncSelection()
			return
		}

		// A remembered object keeps the identity and data it was selected with.
		const known = objectRef.kind === 'mount' ? undefined : remembered.get(refKey(objectRef))
		selectSkyObject(skyState, { ref: known?.ref ?? objectRef, source: 'map', name: hoverLabel(object, this.#names)?.name ?? '', category: known?.category ?? categoryOf(object, objectRef), minorBody: known?.minorBody }, this.#observer)
	}

	// Shows the clock's instant now and updates it on a timer that suits the clock: every
	// SKY_REALTIME_TICK_MS while following the real time, frequently while playing, and none for a fixed
	// instant. Each update refreshes the selection's position and events for the same instant as the map:
	// on every real-time update, every PLAYING_SELECTION_TICKS updates while playing, and once
	// FIXED_SETTLE_MS after a fixed instant settles. Once the clock is not playing, reloads the catalogs
	// when the instant is more than a year away from theirs.
	#followClock() {
		this.#stopClock()

		const mode = skyClock.mode
		let ticks = 0

		const tick = () => {
			const time = this.time
			// Only an instant that changes updates the map, and so recenters it.
			this.#anchor = time !== this.#shownTime ? this.#viewAnchor() : undefined
			this.#shownTime = time
			this.celestial.setTime(time)
			if (mode !== 'fixed' && ticks++ % (mode === 'playing' ? PLAYING_SELECTION_TICKS : 1) === 0) this.#refreshSelection(mode, time)
		}

		tick()

		if (mode === 'fixed') this.#settleTimer = setTimeout(() => this.#refreshSelection(mode, this.time), FIXED_SETTLE_MS)
		else this.#clockTimer = setInterval(tick, mode === 'playing' ? PLAYING_INTERVAL_MS : SKY_REALTIME_TICK_MS)
		if (mode !== 'playing' && this.#dataTime !== undefined && !mapDataCovers(this.#dataTime, this.time)) this.load()
	}

	// Point of date (radians) at the middle of the view that a clock update keeps there: only on the local
	// sky zoomed in to SKY_ANCHOR_ZOOM or more, and not while the mount is followed, which recenters itself.
	#viewAnchor(): MountPoint | undefined {
		if (this.coordinateSystem !== 'horizontal' || mountRuntime.following || this.celestial.viewState.transform.k < SKY_ANCHOR_ZOOM) return undefined
		const center = this.celestial.screenToEquatorial(this.#host.clientWidth / 2, this.#host.clientHeight / 2)
		return center ? { rightAscension: center.rightAscension, declination: center.declination } : undefined
	}

	// Follows an update of the map for an instant (Unix milliseconds): recenters the view on the point
	// anchored before it, and asks for the body positions of the instant.
	#updateEnded(time: number) {
		const anchor = this.#anchor
		this.#anchor = undefined
		if (anchor) this.centerOn(anchor)
		this.#requestMovingBodies(time)
	}

	// Stops the clock updates and the pending refresh of a fixed instant.
	#stopClock() {
		clearInterval(this.#clockTimer)
		clearTimeout(this.#settleTimer)
		this.#clockTimer = undefined
		this.#settleTimer = undefined
	}

	// Refreshes the selection's position and events for an instant (Unix milliseconds) of the map, as a
	// clock mode asks.
	#refreshSelection(mode: SkyClockMode, time: number) {
		void refreshSkySelection(skyState, this.#observer, REFRESH[mode], browserSkyIo, time)
	}

	// Asks for the body positions of an instant (Unix milliseconds). While a request is running, only the
	// latest instant asked meanwhile is kept and requested after it, so a fast clock never aborts requests
	// before they finish or queues more than one.
	#requestMovingBodies(time: number) {
		if (this.#bodiesBusy) {
			this.#bodiesPending = time
			return
		}

		this.#bodiesBusy = true

		void this.#updateMovingBodies(time).finally(() => {
			this.#bodiesBusy = false
			const pending = this.#bodiesPending
			this.#bodiesPending = undefined
			if (pending !== undefined && !this.#destroyed) this.#requestMovingBodies(pending)
		})
	}

	// Recomputes the local positions of the major bodies, and of the remembered minor bodies other than the
	// selection (which follows the Inspector's position of the same instant), for an instant. Updates of the
	// same second and observer, such as those after loading data, reuse the positions requested for them.
	async #updateMovingBodies(time: number) {
		const key = `${Math.round(time / 1000)}|${observerKey(this.#observer)}`
		if (key === this.#bodiesKey) return

		this.#bodiesKey = key
		const request = this.#bodiesGuard.begin()

		try {
			const positions = await fetchSkyBodies(time, apiObserver(this.#observer), request.signal)
			if (!request.current()) return

			for (const position of positions) {
				const body = this.#bodies.get(`body:${position.code}`)
				if (!body) continue
				Object.assign(body.position, { rightAscension: position.rightAscension, declination: position.declination })
				body.magnitude = position.magnitude
				body.visible = true
			}

			this.celestial.markMovingBodyDirty()
		} catch {
			// The bodies keep their last positions; the next update retries.
			if (request.current()) this.#bodiesKey = ''
		}

		const selected = skyState.selection?.key
		const minorBodies = [...remembered.values()].filter((object) => object.ref.kind === 'minorBody' && object.key !== selected)
		if (minorBodies.length === 0) return

		const minorRequest = this.#minorGuard.begin()

		await Promise.all(
			minorBodies.map(async (object) => {
				try {
					const { position } = await fetchSkyPosition(object.ref, time, apiObserver(this.#observer), 'fast', minorRequest.signal)
					if (!minorRequest.current() || remembered.get(object.key) !== object || skyState.selection?.key === object.key) return
					object.rightAscension = position.rightAscension
					object.declination = position.declination
					object.magnitude = position.magnitude
					this.#showMinorBody(object)
				} catch {
					// Without elements the minor body keeps its last position.
				}
			}),
		)
	}

	// Adds or moves the map's moving body of a remembered minor body.
	#showMinorBody(object: RememberedObject) {
		const id = movingBodyId(object.ref)!
		const type: MovingBodyType = object.minorBody?.kind === 'comet' ? 'comet' : 'asteroid'
		let movingBody = this.#bodies.get(id)

		// A name or kind learned later (from SBDB) replaces the body.
		if (!movingBody || movingBody.name !== object.name || movingBody.type !== type) {
			// Usually fainter than the map's magnitude limits, it is drawn at every zoom since it was looked for.
			movingBody = { id, type, name: object.name, alwaysVisible: true, position: { rightAscension: object.rightAscension, declination: object.declination } }
			this.#bodies.set(id, movingBody)
			this.celestial.addMovingBody(movingBody)
		}

		Object.assign(movingBody.position, { rightAscension: object.rightAscension, declination: object.declination })
		movingBody.magnitude = object.magnitude
		this.celestial.markMovingBodyDirty(id)
	}
}

// Objects the maps of the tab remember, kept when the map is replaced by one of the other kind.
const remembered = new RememberedObjects()

// Star map of the tab; absent until the Sky workspace is first shown.
let current: Planetarium | undefined

// Returns the tab's star map for a kind of chart, replacing the map of the other kind.
export function planetarium(coordinateSystem: CoordinateSystem, observer?: SkyObserverSettings): Planetarium {
	if (current?.coordinateSystem !== coordinateSystem) {
		current?.destroy()
		current = new Planetarium(coordinateSystem, observer)
	}

	return current
}
