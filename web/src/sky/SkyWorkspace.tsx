import type { MinorBody, SkySearchResult } from 'api'
import { type ReactNode, useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime } from '../equipment-control/control'
import { formatGeographic } from '../format'
import { imagesState } from '../images/images'
import { activeSite, locationKey, openObservingSites, siteState } from '../location/site'
import { useActiveSite, useDisplayZone } from '../location/useLocation'
import { activeProfile, profileState, satelliteFavorites, setSkyTimeBarVisible } from '../profile/profile'
import { satelliteCatalogState } from '../satellites/satellites'
import { EmptyState, useWorkspacePanel, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { meteorShowerSourcesState } from '../tools/meteorshowers/meteorshowers.sources'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import type { CoordinateSystem } from './celestial/celestial'
import { skyClock } from './clock'
import { isSkyLayerVisible, METEOR_RADIANTS_LAYER, SATELLITE_TRACKS_LIMIT, SATELLITES_LAYER } from './display'
import { DisplayPanel } from './DisplayPanel'
import { clearImageFootprint, clearSkyCoordinate, skyImageState, toggleImageFootprint } from './footprint'
import { equipmentOptics } from './framing'
import { FramingPanel } from './FramingPanel'
import { HoverTooltip } from './HoverTooltip'
import { mountPoint, mountRuntime, mountView, selectionPoint } from './mount'
import { ObjectInspector } from './ObjectInspector'
import { planetarium, planetariumState } from './planetarium'
import { skySatelliteState } from './satellite/satellite'
import { liveSensors, sensorRuntime } from './sensors'
import { changeSkyObserver, type SkyPanelView, selectSkyObject, skyState } from './sky'
import { SkySearch } from './SkySearch'
import { SkyView } from './SkyView'
import { TimeController } from './TimeController'

// Sky workspace: explores the sky on the tab's star map (./planetarium), independently of any connection
// or equipment. It shows the map, a tooltip for the hovered object, the search, the Object Inspector of
// the selection, which is the same whether it comes from a click or from the search (selecting never
// moves the view), and the time bar of the simulation clock, hidden unless toggled on from the toolbar (a
// profile preference). The contextual panel also holds the display (layers) and framing (field of view of custom optical
// presets or of the Equipment Setup, drawn around the selection) settings. The Sky observes from the active profile's
// observing site, chosen in the top bar: with one the map is its local sky; without one it is an equatorial chart of the
// whole sky, never an assumed place. Times read in the profile's display zone, which changes no position. A solved image can send its footprint, drawn while its document shows that image,
// and a coordinate to mark; the view is only panned to them, never reprojected, and the toolbar toggles the footprint
// and clears the mark.

// Place (locationKey) the selection's position was last computed for; undefined before the workspace is first shown.
let appliedObserver: string | undefined

// Returns the site the active profile observes from now, outside a render.
function currentSite() {
	return activeSite(activeProfile(profileState), siteState.sites)
}

// Sky workspace.
export function SkyWorkspace() {
	const profiles = useSnapshot(profileState)
	const settings = activeProfile(profiles).settings.sky
	const { display, framing } = settings
	const observer = useActiveSite()
	const displayZone = useDisplayZone(observer)
	const sky = useSnapshot(skyState)
	const panelState = useWorkspacePanel('sky')
	const clock = useSnapshot(skyClock)
	const { status, error, coordinateHidden } = useSnapshot(planetariumState)
	const coordinateSystem: CoordinateSystem = observer ? 'horizontal' : 'equatorial'
	const key = locationKey(observer)
	const map = useMemo(() => planetarium(coordinateSystem, currentSite()), [coordinateSystem])
	const selectionKey = sky.selection?.key
	const control = useSnapshot(controlRuntime)
	const mount = mountView(useSnapshot(mountRuntime), control)
	const live = clock.mode === 'now'
	const selectionCenter = selectionPoint(sky.selection, mount, live)
	const mountCenter = mountPoint(mount, live)
	const mountTarget = mount.target

	// Follows the place of the active profile's site: the map, and the selection's position when it changed. A new name or
	// zone of the same place reloads nothing.
	useEffect(() => {
		const current = currentSite()
		map.setObserver(current)
		if (appliedObserver !== undefined && appliedObserver !== key) void changeSkyObserver(skyState, current)
		appliedObserver = key
	}, [map, key])

	// Applies the display preferences of the active profile to the map, in place.
	useEffect(() => {
		map.applyDisplay(display)
	}, [map, display])

	// Draws the selected satellite and the profile's favorites while the display shows satellites, following the catalog;
	// nothing is sampled while the layer is hidden.
	const favorites = satelliteFavorites(activeProfile(profiles).settings)
	const showSatellites = isSkyLayerVisible(display, SATELLITES_LAYER)
	const selectedSatellite = sky.selection?.ref.kind === 'satellite' ? sky.selection.ref.noradId : undefined
	const { revision } = useSnapshot(satelliteCatalogState)
	const { tracking, trail } = useSnapshot(skySatelliteState)
	const satelliteIds = showSatellites ? [...new Set([...(selectedSatellite ? [selectedSatellite] : []), ...favorites])].slice(0, SATELLITE_TRACKS_LIMIT).join(',') : ''

	useEffect(() => {
		map.setSatellites({ ids: satelliteIds ? satelliteIds.split(',') : [], selected: selectedSatellite, observer: currentSite(), revision, tracking: tracking && showSatellites && !!selectedSatellite, trail })
	}, [map, satelliteIds, selectedSatellite, key, revision, tracking, trail, showSatellites])

	// Draws the radiants of the active meteor showers while the display shows them, and the selected shower's radiant,
	// following the catalog.
	const showRadiants = isSkyLayerVisible(display, METEOR_RADIANTS_LAYER)
	const selectedShower = sky.selection?.ref.kind === 'meteorShower' ? sky.selection.ref.id : undefined
	const selectedShowerName = selectedShower ? sky.selection?.name : undefined
	const { revision: meteorRevision } = useSnapshot(meteorShowerSourcesState)

	useEffect(() => {
		map.setMeteorRadiants({ visible: showRadiants, revision: meteorRevision, selected: selectedShower, selectedName: selectedShowerName })
	}, [map, showRadiants, meteorRevision, selectedShower, selectedShowerName])

	// Draws the field of view of the selected preset, or of the Equipment Setup, around the selection,
	// following its position.
	const { telescope, guideTelescope } = activeProfile(profiles).settings
	const sensors = liveSensors(useSnapshot(sensorRuntime), control)
	// The sensors of the camera states the snapshot keeps while they do not change, so the frame follows them only.
	const { MAIN_CAMERA: mainSensor, GUIDE_CAMERA: guideSensor } = sensors
	const equipment = framing?.source === 'equipment'
	const equipmentFrame = equipment ? { name: 'Equipment Setup', optics: equipmentOptics({ telescope, guideTelescope }, framing?.sensorSource ?? 'MAIN_CAMERA', { MAIN_CAMERA: mainSensor, GUIDE_CAMERA: guideSensor }, framing?.manualSensor, framing?.equipmentRotation ?? 0).optics } : undefined
	const frameSource = equipment ? equipmentFrame : framing?.presets.find((e) => e.id === framing.activePresetId)

	useEffect(() => {
		map.syncFraming(frameSource, framing?.visible ?? false, selectionCenter)
	}, [map, frameSource, framing?.visible, selectionCenter?.rightAscension, selectionCenter?.declination])

	// Draws the footprint of a solved image, unless hidden from the toolbar, while its document still shows that image,
	// and drops it otherwise (the document closed, or its camera tab shows another frame); marks and pans to a coordinate
	// sent from an image.
	const handoffs = useSnapshot(skyImageState)
	const documents = useSnapshot(imagesState).documents
	const sent = handoffs.footprint
	const footprint = sent && documents.some((document) => document.key === sent.documentKey && document.info?.id === sent.imageId) ? sent : undefined

	useEffect(() => {
		if (sent && !footprint) clearImageFootprint(skyImageState)
	}, [sent, footprint])

	useEffect(() => {
		map.syncImageFootprint(handoffs.footprintHidden ? undefined : footprint)
	}, [map, footprint, handoffs.footprintHidden])

	useEffect(() => {
		map.syncImageCoordinate(handoffs.intent)
	}, [map, handoffs.intent])

	// Draws the mount marker at the mount's reported position while the clock shows the real time.
	useEffect(() => {
		map.syncMount(mountTarget && { ref: { kind: 'mount', connectionId: mountTarget.connectionId, id: mountTarget.id }, name: mountTarget.name }, mountCenter)
	}, [map, mountTarget, mountCenter?.rightAscension, mountCenter?.declination])

	// Highlights the selection whenever it, its position, or the map data change.
	useEffect(() => {
		if (status === 'ready') map.syncSelection()
	}, [map, status, selectionKey, selectionCenter?.rightAscension, selectionCenter?.declination])

	// Selects a search result as a click would; a minor body is first drawn at its position now.
	function handleSearchSelect(result: SkySearchResult, minorBody?: MinorBody) {
		selectSkyObject(skyState, { ref: result.ref, source: 'search', name: result.name, category: result.category, minorBody }, observer)
		map.syncSelection()
		if (result.ref.kind === 'minorBody') void map.locateMinorBody(result.ref)
	}

	// Shows a view in the panel, opening the panel.
	function openPanel(view: SkyPanelView) {
		skyState.panel = view
		panelState.setOpen(true)
	}

	// Shows a settings view, or returns to the Object Inspector when it is already shown.
	function togglePanel(view: SkyPanelView) {
		if (panelShows(view)) skyState.panel = 'inspector'
		else openPanel(view)
	}

	// Whether a view is on screen: selected, and in a panel that is shown.
	function panelShows(view: SkyPanelView) {
		return panelState.open && sky.panel === view
	}

	const location = observer ? `${observer.name} · ${formatGeographic(observer.latitude, observer.longitude)}` : 'No observing site'
	const context = clock.mode === 'now' ? location : `${location} · Simulated time`

	const panels: Record<SkyPanelView, () => { title: string; content: ReactNode }> = {
		inspector: () => ({ title: 'Object Inspector', content: <ObjectInspector observer={observer} onSetObserver={() => openObservingSites(observer?.id)} timeZone={displayZone.zone} onShowFraming={() => openPanel('framing')} /> }),
		display: () => ({ title: 'Display', content: <DisplayPanel sky={settings} local={coordinateSystem === 'horizontal'} /> }),
		framing: () => ({ title: 'Framing', content: <FramingPanel framing={framing} telescope={telescope} guideTelescope={guideTelescope} hasTarget={!!selectionCenter} /> }),
	}

	return (
		<WorkspaceLayout workspace="sky" title="Sky" context={<span className="truncate text-xs text-ink-300 max-sm:hidden">{context}</span>} panel={panels[sky.panel]()} panelState={panelState}>
			<div className="flex h-full flex-col bg-base-000">
				<div className="flex flex-none items-center gap-2 border-b border-line-100 bg-base-100 px-2 max-sm:flex-wrap max-sm:gap-y-1 max-sm:py-1 sm:h-11">
					<SkySearch onSelect={handleSearchSelect} />
					<div className="ml-auto flex flex-none items-center gap-1 max-sm:w-full">
						<IconButton icon="mount" label={mountCenter ? 'Center on Mount' : 'Center on Mount (the mount position is shown in real time only, while connected)'} disabled={!mountCenter} onClick={() => mountCenter && map.centerOn(mountCenter)} />
						<IconButton
							icon="reticle"
							label={mountCenter ? 'Follow Mount' : 'Follow Mount (the mount position is shown in real time only, while connected)'}
							disabled={!mountCenter}
							pressed={mount.following && !!mountCenter}
							onClick={() => {
								mountRuntime.following = !mountRuntime.following
								if (mountRuntime.following && mountCenter) map.centerOn(mountCenter)
							}}
						/>
						{footprint && <IconButton icon="images" label={`${handoffs.footprintHidden ? 'Show' : 'Hide'} the footprint of ${footprint.name}`} pressed={!handoffs.footprintHidden} onClick={() => toggleImageFootprint(skyImageState)} />}
						{handoffs.intent?.mark && <IconButton icon="pin" label={`Clear the mark of ${handoffs.intent.label}`} onClick={() => clearSkyCoordinate(skyImageState)} />}
						<IconButton icon="clock" label="Time Bar" pressed={settings.timeBar === true} onClick={() => setSkyTimeBarVisible(profileState, settings.timeBar !== true)} />
						<IconButton icon="frame" label="Framing" pressed={panelShows('framing')} onClick={() => togglePanel('framing')} />
						<IconButton icon="layers" label="Display" pressed={panelShows('display')} onClick={() => togglePanel('display')} />
					</div>
				</div>
				<div className="relative isolate min-h-0 flex-1">
					<SkyView planetarium={map} />
					<HoverTooltip celestial={map.celestial} names={() => map.names} />
					{status === 'loading' && <p className="pointer-events-none absolute bottom-3 left-3 m-0 text-xs text-ink-300">Loading the sky catalog…</p>}
					{handoffs.intent && coordinateHidden && (
						<p className="pointer-events-none absolute top-3 left-3 m-0 text-xs text-ink-200">
							{handoffs.intent.label} {coordinateSystem === 'horizontal' ? 'is below the horizon at the time shown' : 'is outside the part of the sky this chart projects'}; the view was not moved.
						</p>
					)}
					{status === 'error' && (
						<div className="absolute inset-0 bg-base-000/80">
							<EmptyState
								title="The sky catalog could not be loaded"
								description={error}
								action={
									<Button variant="secondary" onClick={() => map.load()}>
										Retry
									</Button>
								}
							/>
						</div>
					)}
				</div>
				{settings.timeBar === true && <TimeController timeZone={displayZone.zone} />}
			</div>
		</WorkspaceLayout>
	)
}
