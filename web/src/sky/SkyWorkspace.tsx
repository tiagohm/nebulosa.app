import type { MinorBody, SkySearchResult } from 'api'
import { type ReactNode, useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime } from '../equipment-control/control'
import { activeProfile, profileState, setPanelOpen, setSkyTimeBarVisible } from '../profile/profile'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import type { CoordinateSystem } from './celestial/celestial'
import { skyClock } from './clock'
import { DisplayPanel } from './DisplayPanel'
import { equipmentOptics } from './framing'
import { FramingPanel } from './FramingPanel'
import { HoverTooltip } from './HoverTooltip'
import { mountPoint, mountRuntime, mountView, selectionPoint } from './mount'
import { ObjectInspector } from './ObjectInspector'
import { ObserverPanel } from './ObserverPanel'
import { observerKey, planetarium, planetariumState } from './planetarium'
import { liveSensors, sensorRuntime } from './sensors'
import { changeSkyObserver, type SkyPanelView, selectSkyObject, skyState } from './sky'
import { SkySearch } from './SkySearch'
import { SkyView } from './SkyView'
import { TimeController } from './TimeController'

// Sky workspace: explores the sky on the tab's star map (./planetarium), independently of any connection
// or equipment. It shows the map, a tooltip for the hovered object, the search, the Object Inspector of
// the selection, which is the same whether it comes from a click or from the search (selecting never
// moves the view), and the time bar of the simulation clock, hidden unless toggled on from the toolbar (a
// profile preference). The contextual panel also holds the
// observer, display (layers), and framing (field of view of custom optical presets or of the Equipment
// Setup, drawn around the selection) settings. With an observer the map is the observer's local sky; without one it is an
// equatorial chart of the whole sky.

// Observer the selection's position was last computed for; undefined before the workspace is first shown.
let appliedObserver: string | undefined

// Sky workspace.
export function SkyWorkspace() {
	const profiles = useSnapshot(profileState)
	const settings = activeProfile(profiles).settings.sky
	const { observer, display, framing } = settings
	const sky = useSnapshot(skyState)
	const clock = useSnapshot(skyClock)
	const { status, error } = useSnapshot(planetariumState)
	const coordinateSystem: CoordinateSystem = observer ? 'horizontal' : 'equatorial'
	const key = observerKey(observer)
	const map = useMemo(() => planetarium(coordinateSystem, activeProfile(profileState).settings.sky.observer), [coordinateSystem])
	const selectionKey = sky.selection?.key
	const control = useSnapshot(controlRuntime)
	const mount = mountView(useSnapshot(mountRuntime), control)
	const live = clock.mode === 'now'
	const selectionCenter = selectionPoint(sky.selection, mount, live)
	const mountCenter = mountPoint(mount, live)
	const mountTarget = mount.target

	// Follows the observer of the active profile: the map, and the selection's position when it changed.
	useEffect(() => {
		const current = activeProfile(profileState).settings.sky.observer
		map.setObserver(current)
		if (appliedObserver !== undefined && appliedObserver !== key) void changeSkyObserver(skyState, current)
		appliedObserver = key
	}, [map, key])

	// Applies the display preferences of the active profile to the map, in place.
	useEffect(() => {
		map.applyDisplay(display)
	}, [map, display])

	// Draws the field of view of the selected preset, or of the Equipment Setup, around the selection,
	// following its position.
	const telescope = activeProfile(profiles).settings.telescope
	const sensors = liveSensors(useSnapshot(sensorRuntime), control)
	// The sensors of the camera states the snapshot keeps while they do not change, so the frame follows them only.
	const { MAIN_CAMERA: mainSensor, GUIDE_CAMERA: guideSensor } = sensors
	const equipment = framing?.source === 'equipment'
	const equipmentFrame = equipment ? { name: 'Equipment Setup', optics: equipmentOptics(telescope, framing?.sensorSource ?? 'MAIN_CAMERA', { MAIN_CAMERA: mainSensor, GUIDE_CAMERA: guideSensor }, framing?.manualSensor, framing?.equipmentRotation ?? 0).optics } : undefined
	const frameSource = equipment ? equipmentFrame : framing?.presets.find((e) => e.id === framing.activePresetId)

	useEffect(() => {
		map.syncFraming(frameSource, framing?.visible ?? false, selectionCenter)
	}, [map, frameSource, framing?.visible, selectionCenter?.rightAscension, selectionCenter?.declination])

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
		setPanelOpen(profileState, 'sky', true)
	}

	// Shows a settings view, or returns to the Object Inspector when it is already shown.
	function togglePanel(view: SkyPanelView) {
		if (sky.panel === view && activeProfile(profileState).settings.panels.sky !== false) skyState.panel = 'inspector'
		else openPanel(view)
	}

	const location = observer ? `${observer.name ? `${observer.name} · ` : ''}${observer.latitude.toFixed(4)}°, ${observer.longitude.toFixed(4)}°` : 'No location'
	const context = clock.mode === 'now' ? location : `${location} · Simulated time`

	const panels: Record<SkyPanelView, () => { title: string; content: ReactNode }> = {
		inspector: () => ({ title: 'Object Inspector', content: <ObjectInspector observer={observer} onSetObserver={() => openPanel('observer')} timeZone={observer?.timeZone} onShowFraming={() => openPanel('framing')} /> }),
		observer: () => ({ title: 'Observer', content: <ObserverPanel key={key} observer={observer} onDone={() => (skyState.panel = 'inspector')} /> }),
		display: () => ({ title: 'Display', content: <DisplayPanel sky={settings} local={coordinateSystem === 'horizontal'} /> }),
		framing: () => ({ title: 'Framing', content: <FramingPanel framing={framing} telescope={telescope} hasTarget={!!selectionCenter} /> }),
	}

	return (
		<WorkspaceLayout workspace="sky" title="Sky" context={<span className="truncate text-xs text-ink-300 max-sm:hidden">{context}</span>} panel={panels[sky.panel]()}>
			<div className="flex h-full flex-col bg-base-000">
				<div className="flex h-11 flex-none items-center gap-2 border-b border-line-100 bg-base-100 px-2">
					<SkySearch onSelect={handleSearchSelect} />
					<div className="ml-auto flex flex-none items-center gap-1">
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
						<IconButton icon="clock" label="Time Bar" pressed={settings.timeBar === true} onClick={() => setSkyTimeBarVisible(profileState, settings.timeBar !== true)} />
						<IconButton icon="frame" label="Framing" pressed={sky.panel === 'framing'} onClick={() => togglePanel('framing')} />
						<IconButton icon="layers" label="Display" pressed={sky.panel === 'display'} onClick={() => togglePanel('display')} />
						<Button variant="secondary" onClick={() => togglePanel('observer')} className="max-w-56 truncate">
							{observer ? (observer.name ?? 'Location') : 'Set Location'}
						</Button>
					</div>
				</div>
				<div className="relative isolate min-h-0 flex-1">
					<SkyView planetarium={map} />
					<HoverTooltip celestial={map.celestial} names={() => map.names} />
					{status === 'loading' && <p className="pointer-events-none absolute bottom-3 left-3 m-0 text-xs text-ink-300">Loading the sky catalog…</p>}
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
				{settings.timeBar === true && <TimeController timeZone={observer?.timeZone} />}
			</div>
		</WorkspaceLayout>
	)
}
