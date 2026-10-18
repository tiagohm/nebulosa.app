import type { MinorBody, SkyObjectCategory, SkyObjectRef } from 'api'
import { DEG2RAD, TAU } from 'nebulosa/src/core/constants'
import { proxy, subscribe } from 'valtio'
import type { SkyObserverSettings } from '../profile/profile'
import { Celestial, type CelestialObject, type CelestialOptions, type CelestialShape, type ConstellationLine, type CoordinateSystem, drawSelectionReticle, type MovingBody, type MovingBodyType, type RenderState } from './celestial/celestial'
import { skyClock, skyTime } from './clock'
import { applySkyDisplay, MAP_STAR_MAGNITUDE_LIMIT, type SkyDisplaySettings } from './display'
import { formatAngularSize } from './format'
import { type FramePoint, framePolygon, isFraming, type OpticalConfiguration, resolveFraming } from './framing'
import { type MountPoint, mountRuntime, selectionPoint } from './mount'
import { hoverLabel, type MapNames, MOUNT_SHAPE_TYPE, type MountMarkerData, type MountRef, movingBodyId, refKey, refOfCelestialObject, selectionTargets, type SkySelectionRef } from './objects'
import { createRequestGuard } from './selection'
import { apiObserver, fetchSkyBodies, fetchSkyPosition, loadSkyMapData, mapDataCovers, selectSkyObject, skyState } from './sky'

// The Sky workspace's star map, kept for the whole tab: the Celestial instance, its catalogs, the moving
// bodies, and the selection highlight live here rather than in React, so leaving the workspace only
// detaches the map from the page and stops its clock, and returning reattaches the same map with its
// view, data, and selection. A new map is created only when the kind of chart changes: the observer's
// local sky (horizontal, zenith at the center) when there is an observer, an equatorial chart of the
// whole sky otherwise. Objects below the local horizon are neither drawn nor highlighted. The map shows
// the instant of the Sky simulation clock (./clock); its catalogs are reloaded in place when the clock
// stops more than a year away from the instant they were computed for. The mount's reported position is
// drawn as a selectable marker while the clock shows the real time, and the view can be centered on it
// or follow it until the user pans.

// Interval of the map's updates in milliseconds while the clock follows the real time.
const REALTIME_INTERVAL_MS = 30_000

// Interval of the map's updates in milliseconds while the clock plays.
const PLAYING_INTERVAL_MS = 250

// Color of the selection reticle.
const SELECTION_COLOR = '#7e57c2'

// Id of the custom shape marking a selection that is not drawn on the map (a faint catalog object).
const SELECTION_MARKER_ID = 'selection-marker'

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
const MOUNT_COLOR = '#ffb74d'

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
	#marker = false
	// Whether the field of view shape is on the map.
	#framing = false
	// Mount marker on the map, whose coordinate is moved in place as the mount moves; absent while not drawn.
	#mountMarker?: { readonly coordinate: { rightAscension: number; declination: number }; readonly data: MountMarkerData }
	#resizeObserver?: ResizeObserver
	// Timer of the clock updates while attached.
	#clockTimer?: ReturnType<typeof setInterval>
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

		this.celestial.setTime(skyTime(skyClock, Date.now()))
		this.#unsubscribe = [this.celestial.on('selectionChange', ({ object }) => this.#handleClick(object)), this.celestial.on('updateEnd', ({ time }) => this.#requestMovingBodies(time)), this.celestial.on('panStart', () => (mountRuntime.following = false))]
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
		clearInterval(this.#clockTimer)
		this.#clockTimer = undefined
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

	// Centers the view on a point of date (radians), keeping the zoom and layers.
	centerOn(point: MountPoint) {
		this.celestial.centerOnCoordinate(point.rightAscension, point.declination)
	}

	// Applies the display preferences in place, keeping the view and data; the local meridian is drawn
	// only on the local sky.
	applyDisplay(display: Readonly<SkyDisplaySettings> | undefined) {
		applySkyDisplay(this.celestial, display, this.coordinateSystem === 'horizontal', MAP_STAR_MAGNITUDE_LIMIT)
	}

	// Highlights the selection: the drawn object when there is one, otherwise a marker at its position
	// when it is above the horizon, and nothing without a selection. Keeps only the selected minor body
	// on the map.
	syncSelection() {
		const selection = skyState.selection
		const keep = selection?.ref.kind === 'minorBody' ? movingBodyId(selection.ref) : undefined

		for (const id of this.#bodies.keys()) {
			if (id.startsWith('minor:') && id !== keep) {
				this.#bodies.delete(id)
				this.celestial.removeMovingBody(id)
			}
		}

		const position = selection?.position
		if (selection?.ref.kind === 'minorBody' && position) this.#showMinorBody(selection.ref, selection.minorBody, position.rightAscension, position.declination, position.magnitude)
		const point = selectionPoint(selection, mountRuntime, skyClock.mode === 'now')

		let found: CelestialObject | null = null

		if (!selection) {
			this.celestial.selectObject(null)
		} else if (this.#isSelected(selection.key)) {
			// A clicked object (such as one of the two Serpens labels) keeps its highlight.
			found = this.celestial.selectedObject
		} else {
			for (const target of selectionTargets(selection.ref, selection.category, this.#names)) {
				found = this.celestial.selectObject(target)
				if (found) break
			}
		}

		if (!found && selection && point && !(position?.altitude !== undefined && position.altitude < 0)) {
			const shape: CelestialShape = { id: SELECTION_MARKER_ID, coordinate: { ...point }, selectable: false, render: (_, ctx, state) => drawSelectionReticle(ctx, state.x, state.y, SELECTION_COLOR) }
			this.#marker = true
			this.celestial.addShape(shape)
		} else if (this.#marker) {
			this.#marker = false
			this.celestial.removeShape(SELECTION_MARKER_ID)
		}
	}

	// Draws a minor body chosen in the search at its position now; the selection highlights it.
	async locateMinorBody(objectRef: SkyObjectRef, body?: MinorBody) {
		const request = this.#locateGuard.begin()
		const key = refKey(objectRef)

		try {
			const { position } = await fetchSkyPosition(objectRef, this.time, apiObserver(this.#observer), 'fast', request.signal)
			if (!request.current() || skyState.selection?.key !== key) return
			this.#showMinorBody(objectRef, body, position.rightAscension, position.declination, position.magnitude)
			this.syncSelection()
		} catch {
			// The Inspector shows why the position is unavailable.
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

		selectSkyObject(skyState, { ref: objectRef, source: 'map', name: hoverLabel(object, this.#names)?.name ?? '', category: categoryOf(object, objectRef) }, this.#observer)
	}

	// Shows the clock's instant now and updates it on a timer that suits the clock: slow while following
	// the real time, frequent while playing, and none for a fixed instant. Once the clock is not playing,
	// reloads the catalogs when the instant is more than a year away from theirs.
	#followClock() {
		clearInterval(this.#clockTimer)
		this.#clockTimer = undefined

		const tick = () => this.celestial.setTime(this.time)
		tick()

		if (skyClock.mode !== 'fixed') this.#clockTimer = setInterval(tick, skyClock.mode === 'playing' ? PLAYING_INTERVAL_MS : REALTIME_INTERVAL_MS)
		if (skyClock.mode !== 'playing' && this.#dataTime !== undefined && !mapDataCovers(this.#dataTime, this.time)) this.load()
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

	// Recomputes the local positions of the major bodies, and of the selected minor body, for an instant.
	// Updates of the same second and observer, such as those after loading data, reuse the positions
	// requested for them.
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

		const selection = skyState.selection
		if (selection?.ref.kind !== 'minorBody') return

		const minorRequest = this.#minorGuard.begin()

		try {
			const { position } = await fetchSkyPosition(selection.ref, time, apiObserver(this.#observer), 'fast', minorRequest.signal)
			if (minorRequest.current() && skyState.selection?.key === selection.key) this.#showMinorBody(selection.ref, selection.minorBody, position.rightAscension, position.declination, position.magnitude)
		} catch {
			// Without elements the minor body is drawn from the Inspector's position only.
		}
	}

	// Adds or moves the map's moving body of a minor body.
	#showMinorBody(objectRef: SkyObjectRef, body: MinorBody | undefined, rightAscension: number, declination: number, magnitude?: number) {
		const id = movingBodyId(objectRef)!
		let movingBody = this.#bodies.get(id)

		if (!movingBody) {
			movingBody = { id, type: body?.kind === 'comet' ? 'comet' : 'asteroid', name: body?.name ?? (objectRef.kind === 'minorBody' ? objectRef.designation : id), position: { rightAscension, declination } }
			this.#bodies.set(id, movingBody)
			this.celestial.addMovingBody(movingBody)
		}

		Object.assign(movingBody.position, { rightAscension, declination })
		movingBody.magnitude = magnitude
		this.celestial.markMovingBodyDirty(id)
	}
}

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
