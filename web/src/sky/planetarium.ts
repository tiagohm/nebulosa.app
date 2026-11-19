import type { SkyObjectCategory, SkyObjectRef, SkyPosition } from 'api'
import { DEG2RAD, TAU } from 'nebulosa/src/core/constants'
import { proxy, snapshot, subscribe } from 'valtio'
import { type FramePoint, framePolygon, isFraming, type OpticalConfiguration, resolveFraming } from '../framing/geometry'
import { type GeographicLocation, locationKey, siteObserver } from '../location/site'
import { spiceKernelsState } from '../tools/spicekernels/spicekernels'
import { Celestial, type CelestialObject, type CelestialOptions, type ConstellationLine, type CoordinateSystem, type MovingBody, type MovingBodyType, type RenderState, type SelectionTarget } from './celestial/celestial'
import { SKY_REALTIME_TICK_MS, type SkyClockMode, skyClock, skyTime } from './clock'
import { applySkyDisplay, MAP_STAR_MAGNITUDE_LIMIT, type SkyDisplaySettings } from './display'
import { fromDate, type ImageFootprint, ofDateMatrix, outlineLabel, type ScreenPoint, type SkyCoordinateIntent, type SkyPoint, toDate } from './footprint'
import { formatApparentSize } from './format'
import { isCometSpkId, type KernelBody, kernelBodies } from './kernels.sky'
import { mapDataCovers, type SkyMapCatalog, skyMapAt } from './mapdata'
import { MeteorRadiantLayer, type MeteorRadiantTargets } from './meteors.sky'
import { type MountPoint, mountRuntime } from './mount'
import { hoverLabel, type MapNames, MOUNT_SHAPE_TYPE, type MountMarkerData, type MountRef, movingBodyId, refKey, refOfCelestialObject, selectionTargets, SKY_POINT_NAME, SKY_POINT_SHAPE_ID, SKY_POINT_SHAPE_TYPE, type SkyPointData, type SkyPointRef, type SkySelectionRef } from './objects'
import { skyMapFont, skyMapPalette, skyMapReferenceLines, skyMapTheme } from './palette'
import { isRememberable, type RememberedObject, RememberedObjects, type RememberedShapeData, REMEMBERED_SHAPE_TYPE, rememberedOf, rememberedShapeId } from './remembered'
import { skySatelliteState } from './satellite/satellite'
import { SatelliteLayer, type SatelliteTargets } from './satellites.sky'
import { createLatestRunner, createRequestGuard } from './selection'
import { browserSkyIo, fetchMinorBodyPositions, fetchSkyBodies, fetchSkyPosition, loadSkyMapCatalog, REALTIME_REFRESH, refreshSkySelection, type SkyRefreshOptions, type SkySelection, selectSkyObject, skyState } from './sky'

// The Sky workspace's star map, kept for the whole tab: the Celestial instance, its catalogs, the moving
// bodies, and the selection highlight live here rather than in React, so leaving the workspace only
// detaches the map from the page and stops its clock, and returning reattaches the same map with its
// view, data, and selection. A new map is created only when the kind of chart changes: the observer's
// local sky (horizontal, zenith at the center) when there is an observer, an equatorial chart of the
// whole sky otherwise. Objects below the local horizon are neither drawn nor highlighted. The map shows
// the instant of the Sky simulation clock (./clock); its J2000 catalog, downloaded once per tab, is moved and precessed
// to the instant in the browser (./mapdata) and computed again in place whenever the clock reaches an instant more than a
// year away from the one it was computed for, playing or not. The mount's reported position is
// drawn as a selectable marker while the clock shows the real time, and the view can be centered on it
// or follow it until the user pans. A click on an empty part of the map selects the Sky point there: fixed J2000
// coordinates, converted from the frame of the loaded catalogs and marked while selected, so the mount can be sent
// between objects. Selected objects the map data lacks (minor bodies, and catalog
// objects fainter than it) are remembered for the tab (./remembered) and stay drawn and selectable, the
// minor bodies moved at every update. The asteroids and comets of the kernels of the SPICE Kernel Library (./kernels.sky)
// are drawn and moved the same way while the library has them, followed from the library mirror of the tab outside React,
// and only within the magnitude limit of the zoom (they may be thousands; the remembered ones are drawn at every zoom);
// none is located while the layer of the solar-system bodies is hidden. A new kernel generation recomputes the selection
// and every body at once, so adding, removing, or turning off a kernel shows the source that takes over without waiting
// for the next update. The footprint of a solved image and a coordinate sent from an image
// (./footprint) are drawn in the frame of the loaded catalogs, so they line up with the stars, and the view is only
// panned to such a coordinate (as to the mount), keeping its zoom and its projection on the observer's sky.

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

// Radius of the ring of a remembered catalog object in pixels.
const REMEMBERED_RING_RADIUS = 4

// Prefix of the ids of the custom shapes drawing the fields of view, followed by the id of each framing.
const FRAMING_SHAPE_PREFIX = 'framing:'

// Points sampled along each edge of the field of view, so wide fields follow the projection's curvature.
const FRAMING_EDGE_SAMPLES = 16

// Smallest on-screen size of the field of view in pixels for which its label is drawn.
const FRAMING_LABEL_MIN_PX = 60

// Id of the custom shape drawing the footprint of a solved image.
const FOOTPRINT_SHAPE_ID = 'image-footprint'

// Id of the custom shape marking a coordinate sent from an image.
const COORDINATE_SHAPE_ID = 'image-coordinate'

// Half length of the arms of the mark of a coordinate, in pixels.
const COORDINATE_MARK = 8

// Id of the custom shape marking the mount's position.
const MOUNT_MARKER_ID = 'mount-marker'

// Color of the dark halo under the mount marker, keeping it legible over bright areas.
const MOUNT_HALO = 'rgba(0, 0, 0, 0.6)'

// Radius of the mount marker's ring in pixels.
const MOUNT_RING_RADIUS = 9

// Inner and outer distance of the mount marker's crosshair ticks from its center, in pixels.
const MOUNT_TICK_RANGE = [4, 15] as const

// Half length of the arms of the Sky point's cross, in pixels.
const SKY_POINT_MARK = 7

// Gap of the Sky point's cross around its center, in pixels.
const SKY_POINT_GAP = 2

// Draws the Sky point at a screen point (pixels): a small open cross over a dark halo, which the selection reticle
// surrounds.
function drawSkyPoint(ctx: CanvasRenderingContext2D, x: number, y: number) {
	ctx.lineCap = 'round'

	for (const [lineWidth, strokeStyle] of [
		[3.5, MOUNT_HALO],
		[1.5, skyMapPalette().ink100],
	] as const) {
		ctx.lineWidth = lineWidth
		ctx.strokeStyle = strokeStyle
		ctx.beginPath()
		ctx.moveTo(x - SKY_POINT_MARK, y)
		ctx.lineTo(x - SKY_POINT_GAP, y)
		ctx.moveTo(x + SKY_POINT_GAP, y)
		ctx.lineTo(x + SKY_POINT_MARK, y)
		ctx.moveTo(x, y - SKY_POINT_MARK)
		ctx.lineTo(x, y - SKY_POINT_GAP)
		ctx.moveTo(x, y + SKY_POINT_GAP)
		ctx.lineTo(x, y + SKY_POINT_MARK)
		ctx.stroke()
	}
}

// Draws the mount marker at a screen point (pixels): a ring with a crosshair through it and the mount's
// name beside it.
function drawMountMarker(ctx: CanvasRenderingContext2D, x: number, y: number, name: string) {
	ctx.lineCap = 'round'

	for (const [lineWidth, strokeStyle] of [
		[4, MOUNT_HALO],
		[1.5, skyMapPalette().mount],
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

	ctx.fillStyle = skyMapPalette().mount
	ctx.font = skyMapFont(11)
	ctx.textAlign = 'left'
	ctx.textBaseline = 'middle'
	ctx.fillText(name, x + MOUNT_TICK_RANGE[1] + 4, y)
}

// Draws a remembered catalog object at a screen point (pixels): a small ring with its name beside it.
function drawRememberedObject(ctx: CanvasRenderingContext2D, x: number, y: number, name: string) {
	const color = skyMapPalette().ink300
	ctx.strokeStyle = color
	ctx.lineWidth = 1.5
	ctx.beginPath()
	ctx.arc(x, y, REMEMBERED_RING_RADIUS, 0, TAU)
	ctx.stroke()
	ctx.fillStyle = color
	ctx.font = skyMapFont(11)
	ctx.textAlign = 'left'
	ctx.textBaseline = 'middle'
	ctx.fillText(name, x + REMEMBERED_RING_RADIUS + 4, y)
}

// Adds an outline (equatorial points in radians, undefined where there is none) to the current path, breaking it where
// a point is missing or cannot be projected, and returns the points projected, in CSS pixels.
function traceOutline(ctx: CanvasRenderingContext2D, state: RenderState, outline: readonly (FramePoint | undefined)[]) {
	const point = new Float64Array(2)
	const projected: ScreenPoint[] = []
	let open = false

	for (const vertex of outline) {
		if (!vertex || !state.projectEquatorialToScreen(vertex.rightAscension, vertex.declination, point)) {
			open = false
			continue
		}

		if (open) ctx.lineTo(point[0], point[1])
		else ctx.moveTo(point[0], point[1])
		open = true
		projected.push([point[0], point[1]])
	}

	return projected
}

// Draws the label of an outline above its topmost point (see outlineLabel), when it is large enough on screen.
function drawOutlineLabel(ctx: CanvasRenderingContext2D, projected: readonly ScreenPoint[], label: string, color: string) {
	const placement = outlineLabel(projected)
	if (!placement || placement.width < FRAMING_LABEL_MIN_PX) return

	ctx.fillStyle = color
	ctx.font = skyMapFont(11)
	ctx.textAlign = placement.align
	ctx.textBaseline = 'bottom'
	ctx.fillText(label, placement.x, placement.y - 4)
}

// Strokes the outline of a field of view (equatorial points in radians) in a colour, breaking it where points cannot be
// projected, with its label when it is large enough on screen.
function drawFraming(ctx: CanvasRenderingContext2D, state: RenderState, outline: readonly FramePoint[], label: string, color: string) {
	ctx.beginPath()
	const projected = traceOutline(ctx, state, outline)

	ctx.strokeStyle = color
	ctx.lineWidth = 1.5
	ctx.stroke()

	drawOutlineLabel(ctx, projected, label, color)
}

// Strokes the footprint of a solved image (points of date in radians, undefined where its WCS could not unproject),
// dashed, breaking it where a point is missing or cannot be projected, with a cross at its centre and its name when it
// is large enough on screen.
function drawImageFootprint(ctx: CanvasRenderingContext2D, state: RenderState, center: { readonly x: number; readonly y: number }, outline: readonly (FramePoint | undefined)[], name: string) {
	ctx.save()
	ctx.beginPath()
	const projected = traceOutline(ctx, state, outline)

	ctx.moveTo(center.x - 5, center.y)
	ctx.lineTo(center.x + 5, center.y)
	ctx.moveTo(center.x, center.y - 5)
	ctx.lineTo(center.x, center.y + 5)
	const color = skyMapPalette().ink200
	ctx.strokeStyle = color
	ctx.lineWidth = 1.5
	ctx.setLineDash([6, 4])
	ctx.stroke()
	ctx.restore()

	drawOutlineLabel(ctx, projected, name, color)
}

// Returns a sky position [right ascension, declination] in radians as a point of the map.
function framePoint([rightAscension, declination]: SkyPoint): FramePoint {
	return { rightAscension, declination }
}

// Draws the mark of a coordinate sent from an image at a screen point (pixels): an open cross with its label.
function drawCoordinateMark(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
	const color = skyMapPalette().ink200
	ctx.strokeStyle = color
	ctx.lineWidth = 1.5
	ctx.beginPath()
	ctx.moveTo(x - COORDINATE_MARK, y)
	ctx.lineTo(x - 3, y)
	ctx.moveTo(x + 3, y)
	ctx.lineTo(x + COORDINATE_MARK, y)
	ctx.moveTo(x, y - COORDINATE_MARK)
	ctx.lineTo(x, y - 3)
	ctx.moveTo(x, y + 3)
	ctx.lineTo(x, y + COORDINATE_MARK)
	ctx.stroke()
	ctx.fillStyle = color
	ctx.font = skyMapFont(11)
	ctx.textAlign = 'left'
	ctx.textBaseline = 'middle'
	ctx.fillText(label, x + COORDINATE_MARK + 4, y)
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

// Framing drawn around the selection.
export interface SkyFrame {
	// Id of the framing, unique among those drawn.
	readonly id: string
	// Name shown in its label.
	readonly name: string
	// Optical configuration, with the rotation of the sensor.
	readonly optics: Readonly<OpticalConfiguration>
	// CSS colour of its outline and label.
	readonly color: string
}

// Whether two optical configurations are the same, sensor included.
function sameOptics(a: Readonly<OpticalConfiguration>, b: Readonly<OpticalConfiguration>) {
	if (a.focalLength !== b.focalLength || a.focalMultiplier !== b.focalMultiplier || a.aperture !== b.aperture || a.rotation !== b.rotation) return false
	const keys = Object.keys(a.sensor) as (keyof OpticalConfiguration['sensor'])[]
	return keys.length === Object.keys(b.sensor).length && keys.every((key) => a.sensor[key] === (b.sensor as Record<string, unknown>)[key])
}

// Whether two lists of framings are the same by value, in the same order, whatever objects hold them.
export function sameSkyFrames(a: readonly SkyFrame[], b: readonly SkyFrame[]) {
	return a.length === b.length && a.every((frame, i) => frame.id === b[i].id && frame.name === b[i].name && frame.color === b[i].color && sameOptics(frame.optics, b[i].optics))
}

// Loading state of the map data, shown by the workspace.
export interface PlanetariumState {
	// Whether the map data is loading, loaded, or failed to load.
	status: 'loading' | 'ready' | 'error'
	// Why the map data failed to load.
	error?: string
	// Whether the coordinate requested last from an image cannot be projected (below the local horizon at the instant
	// shown, or outside the part of the sky the chart projects), so the view could not be panned to it.
	coordinateHidden?: boolean
}

// Loading state of the map data of the current map.
export const planetariumState = proxy<PlanetariumState>({ status: 'loading' })

// Construction options of a map: a stereographic chart without the Milky Way (it has no data), drawn in the palette of
// the design tokens (./palette). The local meridian is drawn only on the local sky, the only chart that has an observer.
function mapOptions(coordinateSystem: CoordinateSystem): CelestialOptions {
	const references = skyMapReferenceLines()

	return {
		width: 1,
		height: 1,
		projection: 'stereographic',
		coordinateSystem,
		stars: { maxMagnitude: MAP_STAR_MAGNITUDE_LIMIT },
		layers: { milkyWay: false, constellationBoundaries: false },
		referenceLines: { ...references, localMeridian: { ...references.localMeridian, enabled: coordinateSystem === 'horizontal' } },
		theme: skyMapTheme(),
	}
}

// Group of an object picked on the map; undefined for the mount marker and the Sky point.
function categoryOf(object: CelestialObject, objectRef: SkySelectionRef): SkyObjectCategory | undefined {
	if (objectRef.kind === 'mount' || objectRef.kind === 'coordinates') return undefined
	if (objectRef.kind === 'meteorShower') return 'meteorShower'
	if (object.type === 'shape') return rememberedOf(object)?.category
	if (object.type === 'star') return 'star'
	if (object.type === 'deepSky') return 'deepSky'
	if (objectRef.kind === 'constellation') return 'constellation'
	if (objectRef.kind === 'satellite') return 'satellite'
	return objectRef.kind === 'body' ? 'solarSystem' : 'minorBody'
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
	#observer?: GeographicLocation
	// Second and observer of the major and of the minor body positions requested last, so repeated updates do not
	// refetch them.
	#bodiesKey = ''
	#minorKey = ''
	// Runners of the major and of the minor body requests: one of each in flight, for the latest instant asked.
	readonly #requestMajorBodies = createLatestRunner(
		(time) => this.#updateMajorBodies(time),
		() => !this.#destroyed,
	)
	readonly #requestMinorBodies = createLatestRunner(
		(time) => this.#updateMinorBodies(time),
		() => !this.#destroyed,
	)
	// J2000 map catalog of the tab; absent before it is loaded.
	#catalog?: SkyMapCatalog
	// Instant the drawn catalogs were computed for, Unix milliseconds; absent before the first load.
	#dataTime?: number
	// Small bodies of the Horizons kernels of the library, by reference key, drawn once their first position arrives
	// unless they are remembered, whose object then draws them.
	readonly #kernelBodies = new Map<string, RememberedObject>()
	// Keys of the kernel bodies that have a position.
	readonly #kernelPlaced = new Set<string>()
	// Kernel generation of the library the positions were last asked for; absent before the library is known.
	#kernelGeneration?: number
	// Kernel list of the library mirror the bodies were last drawn from, a snapshot that keeps its identity while no kernel
	// changes (a job update replaces only the jobs); absent before the first.
	#kernelList?: readonly unknown[]
	// Ids of the shapes of the remembered catalog objects on the map.
	readonly #rememberedShapes = new Set<string>()
	// Ids of the framings whose field of view shape is on the map.
	readonly #framings = new Set<string>()
	// Framings, visibility, and center (radians) the fields of view were last drawn for; absent before the first.
	#framingsDrawn?: { readonly frames: readonly SkyFrame[]; readonly visible: boolean; readonly center?: FramePoint }
	// Footprint of a solved image to draw; absent when none is shown.
	#footprint?: ImageFootprint
	// Coordinate requested last from an image, and the request number already applied.
	#coordinate?: SkyCoordinateIntent
	#coordinateSeq = 0
	// Mount marker on the map, whose coordinate is moved in place as the mount moves; absent while not drawn.
	#mountMarker?: { readonly coordinate: { rightAscension: number; declination: number }; readonly data: MountMarkerData }
	// Key of the Sky point marked on the map; absent while none is.
	#skyPointKey?: string
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
	// Artificial satellites drawn on the map.
	readonly #satellites: SatelliteLayer
	// Meteor shower radiants drawn on the map.
	readonly #meteorRadiants: MeteorRadiantLayer
	// Precession-nutation matrix of the loaded map data and the instant it is for.
	#dataMatrix?: { readonly time: number; readonly matrix: ReturnType<typeof ofDateMatrix> }
	#destroyed = false

	// Creates the map of a kind of chart for an observer and starts loading its data.
	constructor(coordinateSystem: CoordinateSystem, observer?: GeographicLocation) {
		this.coordinateSystem = coordinateSystem
		this.#host = document.createElement('div')
		this.#host.className = 'absolute inset-0 touch-none overflow-hidden select-none'
		this.celestial = new Celestial(this.#host, mapOptions(coordinateSystem))
		this.#satellites = new SatelliteLayer(this.celestial, { time: () => this.time, rate: () => (skyClock.mode === 'fixed' ? 0 : skyClock.mode === 'playing' ? skyClock.rate : 1), centerOn: (point) => this.centerOn(point) })
		this.#meteorRadiants = new MeteorRadiantLayer(this.celestial, { time: () => this.time, toMapFrame: (rightAscension, declination) => this.#toMapFrame(rightAscension, declination) })
		this.setObserver(observer)

		for (const [code, type, name] of BODY_TYPES) {
			const body: MovingBody = { id: `body:${code}`, type, name, position: { rightAscension: 0, declination: 0 }, visible: false }
			this.#bodies.set(body.id, body)
			this.celestial.addMovingBody(body)
		}

		for (const object of remembered.values()) this.#drawRemembered(object)

		this.#shownTime = this.time
		this.celestial.setTime(this.#shownTime)
		this.#unsubscribe = [
			this.celestial.on('selectionChange', ({ object }) => this.#handleClick(object)),
			this.celestial.on('click', ({ object, coordinate }) => {
				if (!object) this.#selectSkyPoint(coordinate)
			}),
			this.celestial.on('updateEnd', ({ time }) => this.#updateEnded(time)),
			this.celestial.on('panStart', () => {
				mountRuntime.following = false
				skySatelliteState.tracking = false
			}),
			subscribe(spiceKernelsState, () => this.#followLibrary()),
		]
		this.#followLibrary()
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
		this.#satellites.start()
	}

	// Removes the map from the page and stops following the clock; the map keeps its state.
	detach() {
		this.#resizeObserver?.disconnect()
		this.#resizeObserver = undefined
		this.#unsubscribeClock?.()
		this.#unsubscribeClock = undefined
		this.#satellites.stop()
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
		this.#satellites.destroy()
		this.#meteorRadiants.destroy()
		this.#loadGuard.cancel()
		this.celestial.destroy()
	}

	// Sets the artificial satellites drawn: the selected one and those the display shows, with whether the view follows
	// the selected one and draws its track.
	setSatellites(targets: SatelliteTargets) {
		this.#satellites.set(targets)
	}

	// Sets the meteor shower radiants drawn: those of the active showers while the layer is shown, and the selected one.
	setMeteorRadiants(targets: MeteorRadiantTargets) {
		this.#meteorRadiants.set(targets)
	}

	// Follows the library mirror of the tab: draws its small bodies again when its kernels or its generation changed, and
	// does nothing for any other change (such as the progress of a job).
	#followLibrary() {
		const library = snapshot(spiceKernelsState).snapshot
		const kernels = library?.kernels
		if (kernels === this.#kernelList && library?.generation === this.#kernelGeneration) return
		this.#kernelList = kernels
		this.#setKernelBodies(kernelBodies(kernels), library?.generation)
	}

	// Draws the small bodies of the kernels of the library and removes those no longer in it, unless the map remembers
	// them; a change of the kernel generation (a kernel added, removed, turned on or off, or the offline switch) recomputes
	// the selection and every body for the instant shown, as their ephemeris source may have changed.
	#setKernelBodies(bodies: readonly KernelBody[], generation: number | undefined) {
		const keys = new Set<string>()
		let changed = false

		for (const { spkId, name, comet } of bodies) {
			const ref: RememberedObject['ref'] = { kind: 'minorBody', spkId, designation: name }
			const key = refKey(ref)
			keys.add(key)
			const known = this.#kernelBodies.get(key)

			if (!known) {
				this.#kernelBodies.set(key, { ref, key, name, typeName: comet ? 'Comet' : 'Minor Body', category: 'minorBody', rightAscension: 0, declination: 0 })
				changed = true
			} else if (known.name !== name) {
				known.name = name
				if (this.#kernelPlaced.has(key) && !remembered.get(key)) this.#showMinorBody(known)
			}
		}

		for (const [key, object] of this.#kernelBodies) {
			if (keys.has(key)) continue
			this.#kernelBodies.delete(key)
			this.#kernelPlaced.delete(key)
			if (remembered.get(key)) continue
			const id = movingBodyId(object.ref)!
			this.#bodies.delete(id)
			this.celestial.removeMovingBody(id)
		}

		const regenerated = this.#kernelGeneration !== undefined && generation !== undefined && generation !== this.#kernelGeneration
		if (generation !== undefined) this.#kernelGeneration = generation
		if (regenerated) void refreshSkySelection(skyState, this.#observer, { tolerance: -1, mode: REFRESH[skyClock.mode].mode, force: true }, browserSkyIo, this.time)

		if (regenerated) this.#bodiesKey = ''
		if (changed || regenerated) {
			this.#minorKey = ''
			this.#requestMovingBodies(this.time)
		}
	}

	// A geocentric J2000 direction (radians) in the frame of the loaded map data, as the stars are drawn; undefined before
	// the data is loaded. The matrix is computed once per data load.
	#toMapFrame(rightAscension: number, declination: number) {
		const matrix = this.#mapMatrix()
		return matrix && framePoint(toDate(matrix, [rightAscension, declination]))
	}

	// Precession-nutation matrix of the loaded map data, computed once per data load; undefined before the data is loaded.
	#mapMatrix() {
		const time = this.#dataTime
		if (time === undefined) return undefined
		if (this.#dataMatrix?.time !== time) this.#dataMatrix = { time, matrix: ofDateMatrix(time) }
		return this.#dataMatrix.matrix
	}

	// Loads the J2000 map catalog (downloaded once per tab) and shows it at the instant shown, or retries after a failure.
	load() {
		planetariumState.status = 'loading'
		planetariumState.error = undefined
		const request = this.#loadGuard.begin()

		loadSkyMapCatalog().then(
			(catalog) => {
				if (this.#destroyed || !request.current()) return
				this.#catalog = catalog
				this.#showEpoch(this.time)
				planetariumState.status = 'ready'
			},
			(error: unknown) => {
				if (this.#destroyed || !request.current()) return
				planetariumState.error = error instanceof Error ? error.message : 'Unknown error'
				planetariumState.status = 'error'
			},
		)
	}

	// Draws the catalog at its positions of date for an instant (Unix milliseconds), computed in the browser (./mapdata),
	// and redraws what is placed in the frame of the map data: the selection, the Sky point, the image shapes, and the
	// meteor radiants.
	#showEpoch(time: number) {
		const catalog = this.#catalog
		if (!catalog) return
		const { stars, dsos, constellations } = skyMapAt(catalog, time)
		this.#dataTime = time
		this.#names = { typeNames: dsos.typeNames, starDesignations: stars.designations, constellationCodes: new Map(constellations.labels.map((e) => [e.name, e.code])) }
		this.celestial.loadStars({ ra: stars.ra as number[], dec: stars.dec as number[], mag: stars.mag as number[], bv: stars.bv as number[], names: stars.names, ids: stars.ids })
		this.celestial.loadDeepSkyObjects(dsos.ids.map((id, i) => ({ id, name: dsos.names[i], type: dsos.types[i], rightAscension: dsos.ra[i], declination: dsos.dec[i], magnitude: dsos.mag[i] ?? undefined, sizeArcMin: dsos.size[i] || undefined })))
		this.celestial.loadConstellations({ lines: constellations.lines as ConstellationLine[], boundaries: constellations.boundaries as ConstellationLine[], labels: constellations.labels.map(({ name, rightAscension, declination }) => ({ name, rightAscension, declination })) })
		// The Sky point is marked again in the frame of the new data.
		this.#skyPointKey = undefined
		this.syncSelection()
		this.#drawImageShapes()
		this.#meteorRadiants.redraw()
	}

	// Computes the map data again for an instant (Unix milliseconds) more than MAP_DATA_EPOCH_MS from the data's.
	#followEpoch(time: number) {
		if (this.#dataTime !== undefined && !mapDataCovers(this.#dataTime, time)) this.#showEpoch(time)
	}

	// Follows an observer: its location on the map and in the requests of bodies and selections.
	setObserver(observer?: GeographicLocation) {
		this.#observer = observer
		if (observer) this.celestial.setObserver({ latitude: observer.latitude, longitude: observer.longitude, elevation: observer.elevation })
		this.celestial.setLayerVisible('horizon', !!observer)
	}

	// Draws the fields of view of framings (each named, with its optical configuration and colour) around a center
	// (equatorial point of date in radians), and removes the others; every one is removed while hidden or without a
	// center. A framing without a field is not drawn. The caller passes the selection's point at the instant shown, so the
	// fields follow it. Nothing is redrawn when the framings (by value), the visibility, and the center are those drawn last,
	// so the caller may sync on every render.
	syncFramings(framings: readonly SkyFrame[], visible: boolean, center: FramePoint | undefined) {
		const last = this.#framingsDrawn
		if (last && last.visible === visible && last.center?.rightAscension === center?.rightAscension && last.center?.declination === center?.declination && sameSkyFrames(last.frames, framings)) return
		this.#framingsDrawn = { frames: framings, visible, center: center && { rightAscension: center.rightAscension, declination: center.declination } }
		const drawn = new Set<string>()

		if (visible && center) {
			for (const { id, name, optics, color } of framings) {
				const framing = resolveFraming(optics)
				if (!isFraming(framing)) continue
				const outline = framePolygon(center, framing.width, framing.height, optics.rotation * DEG2RAD, FRAMING_EDGE_SAMPLES)
				const label = `${name} · ${formatApparentSize(framing.width)} × ${formatApparentSize(framing.height)} · PA ${optics.rotation.toFixed(1)}°`
				drawn.add(id)
				this.celestial.addShape({ id: `${FRAMING_SHAPE_PREFIX}${id}`, coordinate: { ...center }, selectable: false, render: (_, ctx, state) => drawFraming(ctx, state.state, outline, label, color) })
			}
		}

		for (const id of this.#framings) if (!drawn.has(id)) this.celestial.removeShape(`${FRAMING_SHAPE_PREFIX}${id}`)
		this.#framings.clear()
		for (const id of drawn) this.#framings.add(id)
	}

	// Draws the footprint of a solved image (J2000 points), or removes it when absent. It is converted to the frame of
	// the map data once loaded, so it lines up with the stars drawn.
	syncImageFootprint(footprint: ImageFootprint | undefined) {
		this.#footprint = footprint
		this.#drawImageShapes()
	}

	// Applies a coordinate requested from an image once: marks it when asked and pans the view to it (keeping the zoom
	// and the projection; a point the map cannot project, below the local horizon or outside the chart, leaves the
	// view unchanged, which coordinateHidden of planetariumState reports). The mark of an earlier request is redrawn or removed as it changes.
	syncImageCoordinate(intent: SkyCoordinateIntent | undefined) {
		this.#coordinate = intent
		this.#drawImageShapes()
	}

	// Draws the footprint and the coordinate from images in the frame of the loaded map data, and pans to a coordinate
	// requested since the last time; waits for the data when it is not loaded yet.
	#drawImageShapes() {
		if (this.#dataTime === undefined) return
		const matrix = ofDateMatrix(this.#dataTime)
		const footprint = this.#footprint
		const coordinate = this.#coordinate

		if (footprint) {
			const outline = footprint.outline.map((point) => (point ? framePoint(toDate(matrix, point)) : undefined))
			const center = framePoint(toDate(matrix, footprint.center))
			this.celestial.addShape({ id: FOOTPRINT_SHAPE_ID, coordinate: center, selectable: false, render: (_, ctx, state) => drawImageFootprint(ctx, state.state, state, outline, footprint.name) })
		} else {
			this.celestial.removeShape(FOOTPRINT_SHAPE_ID)
		}

		const point = coordinate && framePoint(toDate(matrix, [coordinate.rightAscension, coordinate.declination]))
		if (coordinate?.mark && point) this.celestial.addShape({ id: COORDINATE_SHAPE_ID, coordinate: point, selectable: false, render: (_, ctx, state) => drawCoordinateMark(ctx, state.x, state.y, coordinate.label) })
		else this.celestial.removeShape(COORDINATE_SHAPE_ID)

		if (coordinate && point && coordinate.seq !== this.#coordinateSeq) {
			this.#coordinateSeq = coordinate.seq
			mountRuntime.following = false
			planetariumState.coordinateHidden = !this.celestial.centerOnCoordinate(point.rightAscension, point.declination)
		}
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
	// only on the local sky. Showing the layer of the solar-system bodies again locates the minor bodies at once.
	applyDisplay(display: Readonly<SkyDisplaySettings> | undefined) {
		const minorShown = this.celestial.isLayerVisible('movingBodies')
		applySkyDisplay(this.celestial, display, this.coordinateSystem === 'horizontal', MAP_STAR_MAGNITUDE_LIMIT)

		if (!minorShown && this.celestial.isLayerVisible('movingBodies')) {
			this.#minorKey = ''
			this.#requestMinorBodies(this.time)
		}
	}

	// Highlights the selection, and nothing without a selection. A minor body, or a catalog object the map
	// data lacks (fainter than it), is remembered at the selection's position, so it is drawn, highlighted,
	// and kept on the map for the tab, following the selection's position while selected.
	syncSelection() {
		const selection = skyState.selection
		this.#markSkyPoint(selection?.ref.kind === 'coordinates' ? selection.ref : undefined)

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
			const { position } = await fetchSkyPosition(objectRef, this.time, siteObserver(this.#observer), 'fast', request.signal)
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

	// Removes a forgotten object from the map; a minor body of a kernel of the library stays drawn as the kernel's.
	#forget(object: RememberedObject) {
		const bodyId = movingBodyId(object.ref)
		const kernelBody = this.#kernelBodies.get(object.key)

		if (bodyId && kernelBody && this.#kernelPlaced.has(object.key)) {
			this.#showMinorBody(kernelBody)
		} else if (bodyId) {
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

	// Selects the Sky point at a coordinate clicked where there is no object (in the frame of the loaded map data, radians),
	// as fixed J2000 coordinates; nothing happens before the data is loaded.
	#selectSkyPoint(coordinate: { readonly rightAscension: number; readonly declination: number }) {
		const matrix = this.#mapMatrix()
		if (!matrix) return
		const [rightAscension, declination] = fromDate(matrix, [coordinate.rightAscension, coordinate.declination])
		selectSkyObject(skyState, { ref: { kind: 'coordinates', rightAscension, declination }, source: 'map', name: SKY_POINT_NAME }, this.#observer)
		this.syncSelection()
	}

	// Marks the Sky point in the frame of the loaded map data, or removes its mark when there is none; waits for the data
	// when it is not loaded yet.
	#markSkyPoint(ref: SkyPointRef | undefined) {
		const key = ref && refKey(ref)
		if (key === this.#skyPointKey) return
		const point = ref && this.#toMapFrame(ref.rightAscension, ref.declination)

		if (ref && key && point) {
			const data: SkyPointData = { ref }
			this.celestial.addShape({ id: SKY_POINT_SHAPE_ID, type: SKY_POINT_SHAPE_TYPE, coordinate: point, data, render: (_, ctx, state) => drawSkyPoint(ctx, state.x, state.y) })
			this.#skyPointKey = key
		} else {
			this.celestial.removeShape(SKY_POINT_SHAPE_ID)
			this.#skyPointKey = undefined
		}
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
	// FIXED_SETTLE_MS after a fixed instant settles. Each update also computes the catalogs again when the instant is
	// more than a year away from theirs.
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
			this.#followEpoch(time)
			if (mode !== 'fixed' && ticks++ % (mode === 'playing' ? PLAYING_SELECTION_TICKS : 1) === 0) this.#refreshSelection(mode, time)
		}

		tick()

		if (mode === 'fixed') this.#settleTimer = setTimeout(() => this.#refreshSelection(mode, this.time), FIXED_SETTLE_MS)
		else this.#clockTimer = setInterval(tick, mode === 'playing' ? PLAYING_INTERVAL_MS : SKY_REALTIME_TICK_MS)
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
		this.#meteorRadiants.update(time)
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

	// Asks for the positions of the major bodies and of the minor bodies of an instant (Unix milliseconds), each through
	// its own runner, so a slow answer for one never holds the other.
	#requestMovingBodies(time: number) {
		this.#requestMajorBodies(time)
		this.#requestMinorBodies(time)
	}

	// Recomputes the local positions of the major bodies for an instant (Unix milliseconds). Updates of the same second
	// and observer, such as those after loading data, reuse the positions requested for them.
	async #updateMajorBodies(time: number) {
		const key = `${Math.round(time / 1000)}|${locationKey(this.#observer)}`
		if (key === this.#bodiesKey) return

		this.#bodiesKey = key
		const request = this.#bodiesGuard.begin()

		try {
			const positions = await fetchSkyBodies(time, siteObserver(this.#observer), request.signal)
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
	}

	// Recomputes, in one request, the local places and magnitudes of the remembered minor bodies and of those of the
	// kernels of the library other than the selection (which follows the Inspector's position of the same instant) for an
	// instant (Unix milliseconds), and redraws them once; nothing is asked while the layer of the solar-system bodies is
	// hidden. A body the server cannot locate locally keeps its last position.
	async #updateMinorBodies(time: number) {
		const key = `${Math.round(time / 1000)}|${locationKey(this.#observer)}`
		if (key === this.#minorKey || !this.celestial.isLayerVisible('movingBodies')) return

		const selected = skyState.selection?.key
		const objects = [...remembered.values(), ...[...this.#kernelBodies.values()].filter((object) => !remembered.get(object.key))].filter((object) => object.ref.kind === 'minorBody' && object.key !== selected)
		this.#minorKey = key
		if (objects.length === 0) return

		const request = this.#minorGuard.begin()

		try {
			const refs = objects.flatMap((object) => (object.ref.kind === 'minorBody' ? [object.ref] : []))
			const positions = await fetchMinorBodyPositions(time, siteObserver(this.#observer), refs, request.signal)
			if (!request.current()) return
			const bySpkId = new Map(positions.map((e) => [e.spkId, e]))
			let moved = false

			for (const object of objects) {
				const position = object.ref.kind === 'minorBody' ? bySpkId.get(object.ref.spkId) : undefined
				if (!position || (remembered.get(object.key) ?? this.#kernelBodies.get(object.key)) !== object || skyState.selection?.key === object.key) continue
				object.rightAscension = position.rightAscension
				object.declination = position.declination
				object.magnitude = position.magnitude
				if (this.#kernelBodies.get(object.key) === object) this.#kernelPlaced.add(object.key)
				this.#placeMinorBody(object)
				moved = true
			}

			if (moved) this.celestial.markMovingBodyDirty()
		} catch {
			// The bodies keep their last positions; the next update retries.
			if (request.current()) this.#minorKey = ''
		}
	}

	// Adds or moves the map's moving body of a remembered minor body or of one of a kernel of the library, and redraws it.
	#showMinorBody(object: RememberedObject) {
		this.#placeMinorBody(object)
		this.celestial.markMovingBodyDirty(movingBodyId(object.ref))
	}

	// Adds or moves the map's moving body of a remembered minor body or of one of a kernel of the library without redrawing
	// it; without SBDB data, a comet is told by its SPK-ID. A remembered body, usually fainter than the map's magnitude
	// limits, is drawn at every zoom since it was looked for; a body of a kernel only within the limit of the zoom, and its
	// name only where it fits.
	#placeMinorBody(object: RememberedObject) {
		const id = movingBodyId(object.ref)!
		const comet = object.minorBody ? object.minorBody.kind === 'comet' : object.ref.kind === 'minorBody' && isCometSpkId(object.ref.spkId)
		const type: MovingBodyType = comet ? 'comet' : 'asteroid'
		const alwaysVisible = remembered.get(object.key) === object
		let movingBody = this.#bodies.get(id)

		// A name or kind learned later (from SBDB), or a body remembered or forgotten, replaces the body.
		if (!movingBody || movingBody.name !== object.name || movingBody.type !== type || (movingBody.alwaysVisible === true) !== alwaysVisible) {
			movingBody = { id, type, name: object.name, alwaysVisible, position: { rightAscension: object.rightAscension, declination: object.declination } }
			this.#bodies.set(id, movingBody)
			this.celestial.addMovingBody(movingBody)
		}

		Object.assign(movingBody.position, { rightAscension: object.rightAscension, declination: object.declination })
		movingBody.magnitude = object.magnitude
	}
}

// Objects the maps of the tab remember, kept when the map is replaced by one of the other kind.
const remembered = new RememberedObjects()

// Star map of the tab; absent until the Sky workspace is first shown.
let current: Planetarium | undefined

// Returns the tab's star map for a kind of chart, replacing the map of the other kind.
export function planetarium(coordinateSystem: CoordinateSystem, observer?: GeographicLocation): Planetarium {
	if (current?.coordinateSystem !== coordinateSystem) {
		current?.destroy()
		current = new Planetarium(coordinateSystem, observer)
	}

	return current
}
