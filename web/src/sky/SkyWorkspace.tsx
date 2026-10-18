import type { MinorBody, SkySearchResult } from 'api'
import { useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { activeProfile, profileState, setPanelOpen } from '../profile/profile'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import type { CoordinateSystem } from './celestial/celestial'
import { HoverTooltip } from './HoverTooltip'
import { ObjectInspector } from './ObjectInspector'
import { ObserverPanel } from './ObserverPanel'
import { observerKey, planetarium, planetariumState } from './planetarium'
import { changeSkyObserver, refreshSkySelection, selectSkyObject, skyState } from './sky'
import { SkySearch } from './SkySearch'
import { SkyView } from './SkyView'

// Sky workspace: explores the sky on the tab's star map (./planetarium), independently of any connection
// or equipment. It shows the map, a tooltip for the hovered object, the search, and the Object Inspector
// of the selection, which is the same whether it comes from a click or from the search; selecting never
// moves the view. With an observer the map is the observer's local sky; without one it is an equatorial
// chart of the whole sky.

// Interval at which the selection's position is recomputed while the workspace is shown, in milliseconds.
const SELECTION_REFRESH_MS = 60_000

// Observer the selection's position was last computed for; undefined before the workspace is first shown.
let appliedObserver: string | undefined

// Sky workspace.
export function SkyWorkspace() {
	const profiles = useSnapshot(profileState)
	const observer = activeProfile(profiles).settings.sky.observer
	const sky = useSnapshot(skyState)
	const { status, error } = useSnapshot(planetariumState)
	const coordinateSystem: CoordinateSystem = observer ? 'horizontal' : 'equatorial'
	const key = observerKey(observer)
	const map = useMemo(() => planetarium(coordinateSystem, activeProfile(profileState).settings.sky.observer), [coordinateSystem])
	const selectionKey = sky.selection?.key
	const selectionPosition = sky.selection?.position

	// Follows the observer of the active profile: the map, and the selection's position when it changed.
	useEffect(() => {
		const current = activeProfile(profileState).settings.sky.observer
		map.setObserver(current)
		if (appliedObserver !== undefined && appliedObserver !== key) void changeSkyObserver(skyState, current)
		appliedObserver = key
	}, [map, key])

	// Highlights the selection whenever it, its position, or the map data change.
	useEffect(() => {
		if (status === 'ready') map.syncSelection()
	}, [map, status, selectionKey, selectionPosition])

	// Keeps the selection's position current while the workspace is shown.
	useEffect(() => {
		const refresh = () => void refreshSkySelection(skyState, activeProfile(profileState).settings.sky.observer)
		refresh()
		const timer = setInterval(refresh, SELECTION_REFRESH_MS)
		return () => clearInterval(timer)
	}, [])

	// Selects a search result as a click would; a minor body is first drawn at its position now.
	function handleSearchSelect(result: SkySearchResult, minorBody?: MinorBody) {
		selectSkyObject(skyState, { ref: result.ref, source: 'search', name: result.name, category: result.category, minorBody }, observer)
		map.syncSelection()
		if (result.ref.kind === 'minorBody') void map.locateMinorBody(result.ref, minorBody)
	}

	// Shows the observer settings in the panel.
	function openObserver() {
		skyState.panel = 'observer'
		setPanelOpen(profileState, 'sky', true)
	}

	const location = observer ? `${observer.name ? `${observer.name} · ` : ''}${observer.latitude.toFixed(4)}°, ${observer.longitude.toFixed(4)}°` : 'No location'

	const panel = sky.panel === 'observer' ? { title: 'Observer', content: <ObserverPanel key={key} observer={observer} onDone={() => (skyState.panel = 'inspector')} /> } : { title: 'Object Inspector', content: <ObjectInspector hasObserver={!!observer} onSetObserver={openObserver} /> }

	return (
		<WorkspaceLayout workspace="sky" title="Sky" context={<span className="truncate text-xs text-ink-300 max-sm:hidden">{location}</span>} panel={panel}>
			<div className="flex h-full flex-col bg-base-000">
				<div className="flex h-11 flex-none items-center gap-2 border-b border-line-100 bg-base-100 px-2">
					<SkySearch onSelect={handleSearchSelect} />
					<Button variant="secondary" size="sm" onClick={openObserver} className="ml-auto max-w-56 truncate">
						{observer ? (observer.name ?? 'Location') : 'Set Location'}
					</Button>
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
									<Button variant="secondary" size="sm" onClick={() => map.load()}>
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
