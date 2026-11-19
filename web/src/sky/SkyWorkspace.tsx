import type { MinorBody, SkySearchResult } from 'api'
import { useEffect, useMemo, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime } from '../equipment-control/control'
import { frameColor } from '../framing/palette'
import { useResolvedFramings } from '../framing/resolve'
import { imagesState } from '../images/images'
import { activeSite, locationKey, openObservingSites, siteState } from '../location/site'
import { useActiveSite, useDisplayZone } from '../location/useLocation'
import { activeProfile, profileState, satelliteFavorites, setSkyTimeBarVisible } from '../profile/profile'
import { satelliteCatalogState } from '../satellites/satellites'
import { EmptyState, useWorkspacePanel, type WorkspacePanel, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { meteorShowerSourcesState } from '../tools/meteorshowers/meteorshowers.sources'
import { Button } from '../ui/Button'
import { FavoriteButton } from '../ui/FavoriteButton'
import { IconButton } from '../ui/IconButton'
import type { CoordinateSystem } from './celestial/celestial'
import { setSkyTimeNow, skyClock } from './clock'
import { isSkyLayerVisible, METEOR_RADIANTS_LAYER, SATELLITE_TRACKS_LIMIT, SATELLITES_LAYER } from './display'
import { DisplayPanel } from './DisplayPanel'
import { addSkyObjectFavorite, isSkyFavorite, removeSkyObjectFavorite, selectionResult } from './favorites'
import { clearImageFootprint, clearSkyCoordinate, skyImageState, toggleImageFootprint } from './footprint'
import { FramingPanel } from './FramingPanel'
import { HoverTooltip } from './HoverTooltip'
import { mountPoint, mountRuntime, mountView, selectionPoint } from './mount'
import { ObjectInspector } from './ObjectInspector'
import { planetarium, planetariumState } from './planetarium'
import { skySatelliteState } from './satellite/satellite'
import { SHORTCUT_ZOOM_FACTOR, skyShortcut, takesKeys } from './shortcuts'
import { changeSkyObserver, type SkyPanelView, selectSkyObject, skyState } from './sky'
import { SkySearch } from './SkySearch'
import { SkyView } from './SkyView'
import { TimeController } from './TimeController'

// Sky workspace: explores the sky on the tab's star map (./planetarium), independently of any connection
// or equipment. It shows the map, a tooltip for the hovered object, the search, the Object Inspector of
// the selection, which is the same whether it comes from a click or from the search (selecting never
// moves the view), and the time bar of the simulation clock, hidden unless toggled on from the toolbar (a
// profile preference). The contextual panel also holds the display (layers) and the framings of the Framing tool drawn
// around the selection, each of which can be hidden. The Sky observes from the active profile's
// observing site, chosen in the top bar: with one the map is its local sky; without one it is an equatorial chart of the
// whole sky, never an assumed place. Times read in the profile's display zone, which changes no position. A solved image can send its footprint, drawn while its document shows that image,
// and a coordinate to mark; the view is only panned to them, never reprojected, and the toolbar toggles the footprint
// and clears the mark. Keyboard shortcuts (./shortcuts) focus the search, zoom, and return to the real time.

// Classes of the toolbar's icon buttons: 43.75 px touch targets on phones, where the buttons take a line of their own,
// and the compact 28 px toolbar size elsewhere.
const TOUCH_BUTTON = 'max-sm:size-12.5'

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

	// Draws the fields of view of the framings not hidden around the selection, each in its colour, following its position.
	const framings = useResolvedFramings()
	const hidden = framing?.hidden
	const skyFrames = framings.flatMap((each) => (hidden?.includes(each.id) ? [] : [{ id: each.id, name: each.name, optics: each.optics, color: frameColor(each.color) }]))
	// The workspace renders on every mount or camera update, and each render builds the frames anew, so the outlines follow
	// the value of the frames, never the objects, and are rebuilt only when a frame really changed.
	const framesKey = JSON.stringify(skyFrames)

	useEffect(() => {
		map.syncFramings(skyFrames, framing?.visible ?? false, selectionCenter)
	}, [map, framesKey, framing?.visible, selectionCenter?.rightAscension, selectionCenter?.declination])

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

	// Keyboard shortcuts of the workspace (./shortcuts): / focuses the search, + and − zoom, N returns to the real time.
	const searchRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			const command = skyShortcut(e.key, e.ctrlKey || e.altKey || e.metaKey)
			if (!command || e.defaultPrevented || takesKeys(e.target)) return

			e.preventDefault()
			if (command === 'search') searchRef.current?.focus()
			else if (command === 'zoomIn') map.celestial.zoomBy(SHORTCUT_ZOOM_FACTOR)
			else if (command === 'zoomOut') map.celestial.zoomBy(1 / SHORTCUT_ZOOM_FACTOR)
			else setSkyTimeNow(skyClock)
		}

		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [map])

	// Selects a search result as a click would; a minor body is first drawn at its position now. Where the panel is a
	// drawer, which starts closed, it opens on the Object Inspector, so choosing a result always shows what was chosen
	// even when the map does not (an object below the horizon or outside the view).
	function handleSearchSelect(result: SkySearchResult, minorBody?: MinorBody) {
		selectSkyObject(skyState, { ref: result.ref, source: 'search', name: result.name, category: result.category, minorBody }, observer)
		map.syncSelection()
		if (result.ref.kind === 'minorBody') void map.locateMinorBody(result.ref)
		if (!panelState.docked) openPanel('inspector')
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

	// Star of the Object Inspector's header: marks the selection, once what it is is known (the catalog data of a catalog
	// object), and unmarks it at any time. The mount marker and the Sky point have none.
	const selection = sky.selection
	const selectedRef = selection?.ref
	const favoriteEntry = selection && selectionResult(selection)
	const favorite = !!selectedRef && isSkyFavorite(activeProfile(profiles).settings, selectedRef)
	const inspectorActions =
		selectedRef && selectedRef.kind !== 'mount' && selectedRef.kind !== 'coordinates' ? (
			<FavoriteButton
				favorite={favorite}
				disabled={!favorite && !favoriteEntry}
				onChange={(marked) => {
					if (!marked) removeSkyObjectFavorite(profileState, selectedRef)
					else if (favoriteEntry) addSkyObjectFavorite(profileState, favoriteEntry)
				}}
			/>
		) : undefined

	// The active site is named by the top bar alone; the header says only when there is none or the time is simulated, at
	// every width: both change what the map shows, and the time bar that also says the time is simulated can be hidden.
	const context = [!observer && 'No observing site', clock.mode !== 'now' && 'Simulated time'].filter(Boolean).join(' · ')

	// Name of the selection when the local sky cannot draw it, its refracted altitude at the instant shown being negative;
	// undefined otherwise, and always on the equatorial chart, which has no horizon.
	const selectionAltitude = sky.selection?.position?.altitude
	const hiddenSelection = coordinateSystem === 'horizontal' && selectionAltitude !== undefined && selectionAltitude < 0 ? sky.selection?.name : undefined

	const panels: Record<SkyPanelView, () => WorkspacePanel> = {
		inspector: () => ({ title: 'Object Inspector', actions: inspectorActions, content: <ObjectInspector observer={observer} onSetObserver={() => openObservingSites(observer?.id)} timeZone={displayZone.zone} onShowFraming={() => openPanel('framing')} /> }),
		display: () => ({ title: 'Display', content: <DisplayPanel sky={settings} local={coordinateSystem === 'horizontal'} /> }),
		framing: () => ({ title: 'Framing', content: <FramingPanel framings={framings} framing={framing} hasTarget={!!selectionCenter} /> }),
	}

	return (
		<WorkspaceLayout workspace="sky" title="Sky" context={context ? <span className="truncate text-xs text-ink-300">{context}</span> : undefined} panel={panels[sky.panel]()} panelState={panelState}>
			<div className="flex h-full flex-col bg-base-000">
				<div className="flex flex-none items-center gap-2 border-b border-line-100 bg-base-100 px-2 max-sm:flex-wrap max-sm:gap-y-1 max-sm:py-1 sm:h-11">
					<SkySearch onSelect={handleSearchSelect} inputRef={searchRef} />
					<div className="ml-auto flex flex-none items-center gap-1 max-sm:w-full max-sm:flex-wrap max-sm:justify-end">
						<IconButton icon="mount" label={mountCenter ? 'Center on Mount' : 'Center on Mount (the mount position is shown in real time only, while connected)'} disabled={!mountCenter} onClick={() => mountCenter && map.centerOn(mountCenter)} className={TOUCH_BUTTON} />
						<IconButton
							className={TOUCH_BUTTON}
							icon="reticle"
							label={mountCenter ? 'Follow Mount' : 'Follow Mount (the mount position is shown in real time only, while connected)'}
							disabled={!mountCenter}
							pressed={mount.following && !!mountCenter}
							onClick={() => {
								mountRuntime.following = !mountRuntime.following
								if (mountRuntime.following && mountCenter) map.centerOn(mountCenter)
							}}
						/>
						{footprint && <IconButton icon="images" label={`${handoffs.footprintHidden ? 'Show' : 'Hide'} the footprint of ${footprint.name}`} pressed={!handoffs.footprintHidden} onClick={() => toggleImageFootprint(skyImageState)} className={TOUCH_BUTTON} />}
						{handoffs.intent?.mark && <IconButton icon="pin" label={`Clear the mark of ${handoffs.intent.label}`} onClick={() => clearSkyCoordinate(skyImageState)} className={TOUCH_BUTTON} />}
						<IconButton icon="clock" label="Time Bar" pressed={settings.timeBar === true} onClick={() => setSkyTimeBarVisible(profileState, settings.timeBar !== true)} className={TOUCH_BUTTON} />
						<IconButton icon="frame" label="Framing" pressed={panelShows('framing')} onClick={() => togglePanel('framing')} className={TOUCH_BUTTON} />
						<IconButton icon="layers" label="Display" pressed={panelShows('display')} onClick={() => togglePanel('display')} className={TOUCH_BUTTON} />
					</div>
				</div>
				<div className="relative isolate min-h-0 flex-1">
					<SkyView planetarium={map} />
					<HoverTooltip celestial={map.celestial} names={() => map.names} />
					{status === 'loading' && <p className="pointer-events-none absolute bottom-3 left-3 m-0 text-xs text-ink-300">Loading the sky catalog…</p>}
					{((handoffs.intent && coordinateHidden) || hiddenSelection) && (
						<div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-1 text-xs text-ink-200">
							{handoffs.intent && coordinateHidden && (
								<p className="m-0">
									{handoffs.intent.label} {coordinateSystem === 'horizontal' ? 'is below the horizon at the time shown' : 'is outside the part of the sky this chart projects'}; the view was not moved.
								</p>
							)}
							{hiddenSelection && <p className="m-0">{hiddenSelection} is below the horizon at the time shown.</p>}
						</div>
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
