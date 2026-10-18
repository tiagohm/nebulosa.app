import type { MinorBody, SkyObjectCategory, SkyObjectRef, SkySearchResult } from 'api'
import { TAU } from 'nebulosa/src/core/constants'
import { useEffect, useRef, useState } from 'react'
import { ref, useSnapshot } from 'valtio'
import { activeProfile, profileState, setPanelOpen, type SkyObserverSettings } from '../profile/profile'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import type { Celestial, CelestialObject, CelestialOptions, CelestialShape, ConstellationLine, MovingBody, MovingBodyType } from './celestial/celestial'
import { localSiderealTime } from './celestial/time'
import { HoverTooltip } from './HoverTooltip'
import { ObjectInspector } from './ObjectInspector'
import { equatorialOfCelestialObject, hoverLabel, type MapNames, movingBodyId, refKey, refOfCelestialObject, selectionTargets } from './objects'
import { ObserverPanel } from './ObserverPanel'
import { createRequestGuard } from './selection'
import { apiObserver, changeSkyObserver, fetchSkyBodies, fetchSkyPosition, loadSkyMapData, refreshSkySelection, selectSkyObject, skyState } from './sky'
import { SkySearch } from './SkySearch'
import { SkyView } from './SkyView'

// Sky workspace: explores the sky on the Celestial star map, independently of any connection or
// equipment. It loads the map data once per tab, draws the Sun, the Moon, and the planets from local
// ephemerides, shows a tooltip for the hovered object, keeps one selection whether it comes from a click
// (which never moves the view) or from the search (which centers the object), and shows the selection
// in the Object Inspector. The map follows the real time and the profile's observer; without an
// observer it has no horizon. Its view is saved when the workspace is left and restored on return.

// Construction options of the map: an equatorial stereographic chart. The Milky Way has no data, and the
// local meridian is hidden because it needs an observer the map may not have.
const MAP_OPTIONS: CelestialOptions = {
	projection: 'stereographic',
	coordinateSystem: 'equatorial',
	stars: { maxMagnitude: 8 },
	layers: { milkyWay: false, constellationBoundaries: false },
	referenceLines: { localMeridian: { enabled: false } },
	theme: { selectedObject: { color: '#d97757' } },
}

// Interval of the map's real-time updates in milliseconds.
const REALTIME_INTERVAL_MS = 30_000

// Interval at which the selection's position is recomputed while the workspace is shown, in milliseconds.
const SELECTION_REFRESH_MS = 60_000

// Id of the custom shape marking a selection that is not drawn on the map (a faint catalog object).
const SELECTION_MARKER_ID = 'selection-marker'

// Map symbol of each major body, by Horizons command.
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

// Draws the selection marker: a ring with a gap at each quadrant.
function renderSelectionMarker(_celestial: Celestial, ctx: CanvasRenderingContext2D, state: { readonly x: number; readonly y: number }) {
	ctx.strokeStyle = '#d97757'
	ctx.lineWidth = 1.5

	for (let i = 0; i < 4; i++) {
		ctx.beginPath()
		ctx.arc(state.x, state.y, 10, (i * TAU) / 4 + 0.25, ((i + 1) * TAU) / 4 - 0.25)
		ctx.stroke()
	}
}

// Group of an object picked on the map.
function categoryOf(object: CelestialObject, objectRef: SkyObjectRef): SkyObjectCategory {
	if (object.type === 'star') return 'star'
	if (object.type === 'deepSky') return 'deepSky'
	return objectRef.kind === 'body' ? 'solarSystem' : 'minorBody'
}

// Key that changes whenever the observer's location changes.
function observerKey(observer?: SkyObserverSettings) {
	return observer ? `${observer.latitude},${observer.longitude},${observer.elevation}` : ''
}

// Centers the map on a position of date in radians, keeping the zoom and dropping the pan offset.
function centerOn(celestial: Celestial, rightAscension: number, declination: number) {
	celestial.setViewTransform({ x: 0, y: 0, k: celestial.viewState.transform.k })
	celestial.centerOnEquatorial(rightAscension, declination)
}

// Applies the observer to the map: its location, and the horizon only when there is one.
function applyObserver(celestial: Celestial, observer?: SkyObserverSettings) {
	if (observer) celestial.setObserver({ latitude: observer.latitude, longitude: observer.longitude, elevation: observer.elevation })
	celestial.setLayerVisible('horizon', !!observer)
}

// Sky workspace.
export function SkyWorkspace() {
	const profiles = useSnapshot(profileState)
	const observer = activeProfile(profiles).settings.sky.observer
	const sky = useSnapshot(skyState)
	const [celestial, setCelestial] = useState<Celestial>()
	const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>('loading')
	const [dataError, setDataError] = useState<string>()
	const [retry, setRetry] = useState(0)
	const mapNames = useRef<MapNames>({ typeNames: [], starDesignations: [] })
	const observerRef = useRef(observer)
	observerRef.current = observer
	const bodies = useRef(new Map<string, MovingBody>())
	const bodiesGuard = useRef(createRequestGuard())
	const minorGuard = useRef(createRequestGuard())
	const locateGuard = useRef(createRequestGuard())
	const marker = useRef<CelestialShape | undefined>(undefined)
	const appliedObserver = useRef(observerKey(observer))

	const selection = sky.selection
	const selectionKey = selection?.key
	const selectionPosition = selection?.position

	// Sets up a new map: observer, bodies, data, saved view, and events.
	function handleReady(map: Celestial): VoidFunction {
		applyObserver(map, observerRef.current)
		bodies.current.clear()

		for (const [code, type, name] of BODY_TYPES) {
			const body: MovingBody = { id: `body:${code}`, type, name, position: { rightAscension: 0, declination: 0 }, visible: false }
			bodies.current.set(body.id, body)
			map.addMovingBody(body)
		}

		if (skyState.view) {
			map.setViewState(skyState.view)
		} else if (observerRef.current) {
			// Starts at the zenith of the observer.
			const { latitude, longitude } = observerRef.current
			centerOn(map, localSiderealTime(Date.now(), (longitude * TAU) / 360), (latitude * TAU) / 360)
		}

		const unsubscribe = [
			map.on('selectionChange', ({ object }) => {
				const objectRef = refOfCelestialObject(object)

				if (!objectRef) {
					// Constellation labels and markers are not objects: keep the highlight on the selection.
					syncHighlight(map)
					return
				}

				selectSkyObject(skyState, { ref: objectRef, source: 'map', name: hoverLabel(object, mapNames.current)?.name ?? '', category: categoryOf(object, objectRef) }, observerRef.current)
			}),
			map.on('updateEnd', ({ time }) => void updateMovingBodies(map, time)),
		]

		map.startAutoUpdate({ mode: 'realtime', interval: REALTIME_INTERVAL_MS })
		setCelestial(map)

		return () => {
			for (const off of unsubscribe) off()
			bodiesGuard.current.cancel()
			minorGuard.current.cancel()
			locateGuard.current.cancel()
			marker.current = undefined
			skyState.view = ref(map.viewState)
			setCelestial(undefined)
		}
	}

	// Recomputes the local positions of the major bodies, and of the selected minor body, for an instant.
	async function updateMovingBodies(map: Celestial, time: number) {
		const request = bodiesGuard.current.begin()

		try {
			const positions = await fetchSkyBodies(time, apiObserver(observerRef.current), request.signal)
			if (!request.current()) return

			for (const position of positions) {
				const body = bodies.current.get(`body:${position.code}`)
				if (!body) continue
				Object.assign(body.position, { rightAscension: position.rightAscension, declination: position.declination })
				body.magnitude = position.magnitude
				body.visible = true
			}

			map.markMovingBodyDirty()
		} catch {
			// The bodies keep their last positions; the next update retries.
		}

		const current = skyState.selection
		if (current?.ref.kind !== 'minorBody') return

		const minorRequest = minorGuard.current.begin()

		try {
			const { position } = await fetchSkyPosition(current.ref, time, apiObserver(observerRef.current), 'fast', minorRequest.signal)
			if (minorRequest.current() && skyState.selection?.key === current.key) showMinorBody(map, current.ref, current.minorBody, position.rightAscension, position.declination, position.magnitude)
		} catch {
			// Without elements the minor body is drawn from the Inspector's position only.
		}
	}

	// Adds or moves the map's moving body of a minor body.
	function showMinorBody(map: Celestial, objectRef: SkyObjectRef, body: MinorBody | undefined, rightAscension: number, declination: number, magnitude?: number) {
		const id = movingBodyId(objectRef)!
		let movingBody = bodies.current.get(id)

		if (!movingBody) {
			movingBody = { id, type: body?.kind === 'comet' ? 'comet' : 'asteroid', name: body?.name ?? (objectRef.kind === 'minorBody' ? objectRef.designation : id), position: { rightAscension, declination } }
			bodies.current.set(id, movingBody)
			map.addMovingBody(movingBody)
		}

		Object.assign(movingBody.position, { rightAscension, declination })
		movingBody.magnitude = magnitude
		map.markMovingBodyDirty(id)
	}

	// Removes the minor bodies that are no longer selected from the map.
	function removeStaleMinorBodies(map: Celestial, keep?: string) {
		for (const id of bodies.current.keys()) {
			if (id.startsWith('minor:') && id !== keep) {
				bodies.current.delete(id)
				map.removeMovingBody(id)
			}
		}
	}

	// Highlights the selection on the map: the drawn object when there is one, otherwise a marker at its
	// position, and nothing without a selection.
	function syncHighlight(map: Celestial) {
		const current = skyState.selection
		let found: CelestialObject | null = null

		if (current) {
			for (const target of selectionTargets(current.ref, current.category)) {
				found = map.selectObject(target)
				if (found) break
			}
		} else {
			map.selectObject(null)
		}

		const position = current?.position

		if (!found && current && position) {
			const shape: CelestialShape = { id: SELECTION_MARKER_ID, coordinate: { rightAscension: position.rightAscension, declination: position.declination }, selectable: false, render: renderSelectionMarker }
			marker.current = shape
			map.addShape(shape)
		} else if (marker.current) {
			marker.current = undefined
			map.removeShape(SELECTION_MARKER_ID)
		}
	}

	// Selects a search result and centers it on the map: at its drawn position, or at its position now
	// when the map does not draw it.
	async function handleSearchSelect(result: SkySearchResult, minorBody?: MinorBody) {
		selectSkyObject(skyState, { ref: result.ref, source: 'search', name: result.name, category: result.category, minorBody }, observerRef.current)
		const map = celestial
		if (!map) return

		const request = locateGuard.current.begin()
		const key = refKey(result.ref)

		for (const target of selectionTargets(result.ref, result.category)) {
			const object = map.selectObject(target)

			if (object) {
				centerOn(map, ...equatorialOfCelestialObject(object))
				return
			}
		}

		try {
			const { position } = await fetchSkyPosition(result.ref, Date.now(), apiObserver(observerRef.current), 'fast', request.signal)
			if (!request.current() || skyState.selection?.key !== key) return
			if (result.ref.kind === 'minorBody') showMinorBody(map, result.ref, minorBody, position.rightAscension, position.declination, position.magnitude)
			centerOn(map, position.rightAscension, position.declination)
			syncHighlight(map)
		} catch {
			// The Inspector shows why the position is unavailable.
		}
	}

	// Centers the map on the selection: its drawn position, or its computed position.
	function handleCenter() {
		const current = skyState.selection
		if (!celestial || !current) return

		const object = celestial.selectedObject
		const drawn = object && refOfCelestialObject(object)

		if (object && drawn && refKey(drawn) === current.key) centerOn(celestial, ...equatorialOfCelestialObject(object))
		else if (current.position) centerOn(celestial, current.position.rightAscension, current.position.declination)
	}

	// Shows the observer settings in the panel.
	function openObserver() {
		skyState.panel = 'observer'
		setPanelOpen(profileState, 'sky', true)
	}

	// Loads the map data into the map once it exists.
	useEffect(() => {
		if (!celestial) return
		let alive = true
		setDataStatus('loading')

		loadSkyMapData().then(
			({ stars, dsos, constellations }) => {
				if (!alive) return
				mapNames.current = { typeNames: dsos.typeNames, starDesignations: stars.designations }
				celestial.loadStars({ ra: stars.ra as number[], dec: stars.dec as number[], mag: stars.mag as number[], bv: stars.bv as number[], names: stars.names, ids: stars.ids })
				celestial.loadDeepSkyObjects(dsos.ids.map((id, i) => ({ id, name: dsos.names[i], type: dsos.types[i], rightAscension: dsos.ra[i], declination: dsos.dec[i], magnitude: dsos.mag[i] ?? undefined, sizeArcMin: dsos.size[i] || undefined })))
				celestial.loadConstellations({ lines: constellations.lines as ConstellationLine[], boundaries: constellations.boundaries as ConstellationLine[], labels: [...constellations.labels] })
				setDataStatus('ready')
			},
			(error: unknown) => {
				if (!alive) return
				setDataError(error instanceof Error ? error.message : 'Unknown error')
				setDataStatus('error')
			},
		)

		return () => {
			alive = false
		}
	}, [celestial, retry])

	// Follows the observer of the active profile: the map, the bodies, and the selection's position.
	useEffect(() => {
		const key = observerKey(observer)
		if (!celestial) return

		applyObserver(celestial, observer)
		if (appliedObserver.current === key) return
		appliedObserver.current = key
		void changeSkyObserver(skyState, observer)
	}, [celestial, observerKey(observer)])

	// Highlights the selection whenever it, its position, or the map data change, and keeps only the
	// selected minor body on the map.
	useEffect(() => {
		if (!celestial) return

		const current = skyState.selection
		removeStaleMinorBodies(celestial, current?.ref.kind === 'minorBody' ? movingBodyId(current.ref) : undefined)
		if (current?.ref.kind === 'minorBody' && current.position) showMinorBody(celestial, current.ref, current.minorBody, current.position.rightAscension, current.position.declination, current.position.magnitude)
		syncHighlight(celestial)
	}, [celestial, dataStatus, selectionKey, selectionPosition])

	// Keeps the selection's position current while the workspace is shown.
	useEffect(() => {
		if (skyState.selection) void refreshSkySelection(skyState, observerRef.current)
		const timer = setInterval(() => skyState.selection && void refreshSkySelection(skyState, observerRef.current), SELECTION_REFRESH_MS)
		return () => clearInterval(timer)
	}, [])

	const location = observer ? `${observer.name ? `${observer.name} · ` : ''}${observer.latitude.toFixed(4)}°, ${observer.longitude.toFixed(4)}°` : 'No location'

	const panel =
		sky.panel === 'observer' ? { title: 'Observer', content: <ObserverPanel key={observerKey(observer)} observer={observer} onDone={() => (skyState.panel = 'inspector')} /> } : { title: 'Object Inspector', content: <ObjectInspector hasObserver={!!observer} onCenter={handleCenter} onSetObserver={openObserver} /> }

	return (
		<WorkspaceLayout workspace="sky" title="Sky" context={<span className="truncate text-xs text-ink-300 max-sm:hidden">{location}</span>} panel={panel}>
			<div className="flex h-full flex-col bg-base-000">
				<div className="flex h-11 flex-none items-center gap-2 border-b border-line-100 bg-base-100 px-2">
					<SkySearch onSelect={(result, minorBody) => void handleSearchSelect(result, minorBody)} />
					<IconButton icon="reticle" label="Center on selection" disabled={!selection} onClick={handleCenter} />
					<Button variant="secondary" size="sm" onClick={openObserver} className="ml-auto max-w-56 truncate">
						{observer ? (observer.name ?? 'Location') : 'Set Location'}
					</Button>
				</div>
				<div className="relative isolate min-h-0 flex-1">
					<SkyView options={MAP_OPTIONS} onReady={handleReady} />
					<HoverTooltip celestial={celestial} names={() => mapNames.current} />
					{dataStatus === 'loading' && <p className="pointer-events-none absolute bottom-3 left-3 m-0 text-xs text-ink-300">Loading the sky catalog…</p>}
					{dataStatus === 'error' && (
						<div className="absolute inset-0 bg-base-000/80">
							<EmptyState
								title="The sky catalog could not be loaded"
								description={dataError}
								action={
									<Button variant="secondary" size="sm" onClick={() => setRetry((n) => n + 1)}>
										Retry
									</Button>
								}
							/>
						</div>
					)}
				</div>
			</div>
		</WorkspaceLayout>
	)
}
