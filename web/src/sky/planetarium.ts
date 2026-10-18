import type { MinorBody, SkyObjectCategory, SkyObjectRef } from 'api'
import { proxy } from 'valtio'
import type { SkyObserverSettings } from '../profile/profile'
import { Celestial, type CelestialObject, type CelestialOptions, type CelestialShape, type ConstellationLine, type CoordinateSystem, drawSelectionReticle, type MovingBody, type MovingBodyType } from './celestial/celestial'
import { hoverLabel, type MapNames, movingBodyId, refKey, refOfCelestialObject, selectionTargets } from './objects'
import { createRequestGuard } from './selection'
import { apiObserver, fetchSkyBodies, fetchSkyPosition, loadSkyMapData, MAP_STAR_MAGNITUDE_LIMIT, selectSkyObject, skyState } from './sky'

// The Sky workspace's star map, kept for the whole tab: the Celestial instance, its catalogs, the moving
// bodies, and the selection highlight live here rather than in React, so leaving the workspace only
// detaches the map from the page and stops its clock, and returning reattaches the same map with its
// view, data, and selection. A new map is created only when the kind of chart changes: the observer's
// local sky (horizontal, zenith at the center) when there is an observer, an equatorial chart of the
// whole sky otherwise. Objects below the local horizon are neither drawn nor highlighted.

// Interval of the map's real-time updates in milliseconds.
const REALTIME_INTERVAL_MS = 30_000

// Color of the selection reticle.
const SELECTION_COLOR = '#7e57c2'

// Id of the custom shape marking a selection that is not drawn on the map (a faint catalog object).
const SELECTION_MARKER_ID = 'selection-marker'

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

// Group of an object picked on the map.
function categoryOf(object: CelestialObject, objectRef: SkyObjectRef): SkyObjectCategory {
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
	readonly #unsubscribe: VoidFunction[]
	#names: MapNames = { typeNames: [], starDesignations: [], constellationCodes: new Map() }
	#observer?: SkyObserverSettings
	// Second and observer of the body positions requested last, so repeated updates do not refetch them.
	#bodiesKey = ''
	#marker = false
	#resizeObserver?: ResizeObserver
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

		this.#unsubscribe = [this.celestial.on('selectionChange', ({ object }) => this.#handleClick(object)), this.celestial.on('updateEnd', ({ time }) => void this.#updateMovingBodies(time))]
		this.load()
	}

	// Map data that names the drawn objects.
	get names(): MapNames {
		return this.#names
	}

	// Shows the map inside a container, following its size, and starts the real-time clock.
	attach(container: HTMLElement) {
		if (this.#destroyed) return

		container.append(this.#host)
		const rect = container.getBoundingClientRect()
		this.celestial.resize(rect.width, rect.height)
		this.#resizeObserver = new ResizeObserver(([entry]) => entry && this.celestial.resize(entry.contentRect.width, entry.contentRect.height))
		this.#resizeObserver.observe(container)
		this.celestial.startAutoUpdate({ mode: 'realtime', interval: REALTIME_INTERVAL_MS })
	}

	// Removes the map from the page and stops its clock; the map keeps its state.
	detach() {
		this.#resizeObserver?.disconnect()
		this.#resizeObserver = undefined
		this.celestial.stopAutoUpdate()
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
		this.celestial.destroy()
	}

	// Loads the map data (downloaded once per tab), or retries after a failure.
	load() {
		planetariumState.status = 'loading'
		planetariumState.error = undefined

		loadSkyMapData().then(
			({ stars, dsos, constellations }) => {
				if (this.#destroyed) return
				this.#names = { typeNames: dsos.typeNames, starDesignations: stars.designations, constellationCodes: new Map(constellations.labels.map((e) => [e.name, e.code])) }
				this.celestial.loadStars({ ra: stars.ra as number[], dec: stars.dec as number[], mag: stars.mag as number[], bv: stars.bv as number[], names: stars.names, ids: stars.ids })
				this.celestial.loadDeepSkyObjects(dsos.ids.map((id, i) => ({ id, name: dsos.names[i], type: dsos.types[i], rightAscension: dsos.ra[i], declination: dsos.dec[i], magnitude: dsos.mag[i] ?? undefined, sizeArcMin: dsos.size[i] || undefined })))
				this.celestial.loadConstellations({ lines: constellations.lines as ConstellationLine[], boundaries: constellations.boundaries as ConstellationLine[], labels: constellations.labels.map(({ name, rightAscension, declination }) => ({ name, rightAscension, declination })) })
				planetariumState.status = 'ready'
				this.syncSelection()
			},
			(error: unknown) => {
				if (this.#destroyed) return
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

		if (!found && selection && position && !(position.altitude !== undefined && position.altitude < 0)) {
			const shape: CelestialShape = { id: SELECTION_MARKER_ID, coordinate: { rightAscension: position.rightAscension, declination: position.declination }, selectable: false, render: (_, ctx, state) => drawSelectionReticle(ctx, state.x, state.y, SELECTION_COLOR) }
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
			const { position } = await fetchSkyPosition(objectRef, Date.now(), apiObserver(this.#observer), 'fast', request.signal)
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
