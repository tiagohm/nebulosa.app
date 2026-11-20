import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { activeSite, locationKey, siteState } from '../../location/site'
import { useActiveSite, useDisplayZone } from '../../location/useLocation'
import { activeProfile, profileState, satelliteFavorites } from '../../profile/profile'
import { satelliteCatalogState } from '../../satellites/satellites'
import { routeState } from '../../shell/route'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { takesKeys } from '../../sky/shortcuts'
import { IconButton } from '../../ui/IconButton'
import { Popover } from '../../ui/Popover'
import { SegmentedControl } from '../../ui/SegmentedControl'
import {
	artificialSatellitesState,
	ensureSatelliteEphemeris,
	ensureSatelliteGroundTrack,
	ensureSatellitePasses,
	ensureTonight,
	followSatelliteObserver,
	loadNextVisiblePass,
	loadSatelliteDetails,
	loadSatelliteGroundTrack,
	loadSatellitePosition,
	POSITION_REFRESH_MS,
	SATELLITE_TAB_LABELS,
	SATELLITE_TABS,
	selectSatellite,
	tickNextVisiblePass,
	tickSatelliteGroundTrack,
	tonightKey,
} from './artificialsatellites'
import { SatelliteDetailsPanel } from './SatelliteDetailsPanel'
import { SatelliteEphemeris } from './SatelliteEphemeris'
import { SatelliteGroundTrack } from './SatelliteGroundTrack'
import { SatelliteImport } from './SatelliteImport'
import { SatellitePasses } from './SatellitePasses'
import { SatelliteSearch } from './SatelliteSearch'
import { SatelliteSettings } from './SatelliteSettings'
import { SatelliteTonight, tonightGroups } from './SatelliteTonight'

// Artificial Satellites tool: tonight's visible passes of the profile's favorites or of a downloaded group, the view it
// opens on, and the passes and ephemeris of the satellite selected for the observing site of the active profile (the
// tool has no place of its own), with its position now read again every 5 seconds, and its ground track on the world
// map, which follows the real time on the same tick. Each view computes its predictions when it is shown; their forms
// only refine them. Civil times are shown in the profile's display zone. A toolbar above the views holds the satellite
// search (the server's catalog and the profile's favorites, as the Sky's search; / focuses it), which selects a
// satellite in whatever view is shown, and the views, a segmented control that scrolls sideways when it does not fit.
// The workspace actions hold the Import Elements popover and the CelesTrak Groups, downloaded on request or
// automatically. It commands no device and changes the Sky only through Open in Sky and Show in Sky. The details of the
// satellite selected are the contextual panel, a drawer on narrow screens that choosing a satellite never opens, so any
// view stays one choice away.

// Interval between two checks of whether the night Tonight shows is over, in milliseconds.
const TONIGHT_CHECK_MS = 60_000

// Artificial Satellites tool.
export function ArtificialSatellites() {
	const profiles = useSnapshot(profileState)
	const state = useSnapshot(artificialSatellitesState)
	const { revision, snapshot } = useSnapshot(satelliteCatalogState)
	const route = useSnapshot(routeState)
	const { settings } = activeProfile(profiles)
	const observer = useActiveSite()
	const zone = useDisplayZone(observer)
	const observerKey = locationKey(observer)
	const favorites = satelliteFavorites(settings)
	const groups = tonightGroups(snapshot?.groups)
	// The group Tonight lists while the catalog has it, else the favorites.
	const source = !snapshot || groups.some((group) => group.key === state.tonightSource) ? state.tonightSource : ''
	const inputKey = tonightKey(source, favorites, observer, revision)
	const searchRef = useRef<HTMLInputElement>(null)
	const linked = route.route.workspace === 'tools' ? route.route.satellite : undefined
	const [importOpen, setImportOpen] = useState(false)
	const [settingsOpen, setSettingsOpen] = useState(false)

	// Follows the place of the observing site, which every prediction is for; its name and zone never ask again.
	useEffect(() => followSatelliteObserver(artificialSatellitesState, observer), [observerKey])

	// Reads the position now of the satellite selected again every POSITION_REFRESH_MS while the page is shown, when it
	// has elements to predict with, and advances a ground track shown that follows the real time.
	useEffect(() => {
		if (!state.selectedId) return undefined
		const timer = setInterval(() => {
			if (document.hidden || !artificialSatellitesState.details?.elements) return
			const site = activeSite(activeProfile(profileState), siteState.sites)
			void loadSatellitePosition(artificialSatellitesState, site)
			tickNextVisiblePass(artificialSatellitesState, site)
			if (artificialSatellitesState.tab === 'groundTrack') tickSatelliteGroundTrack(artificialSatellitesState)
		}, POSITION_REFRESH_MS)
		return () => clearInterval(timer)
	}, [state.selectedId])

	// Reads the ground track when its view is shown for a satellite with elements and none was read.
	useEffect(() => ensureSatelliteGroundTrack(artificialSatellitesState), [state.tab, state.selectedId, state.details, state.groundTrack])

	// Searches the passes, and computes the ephemeris, when their view is shown for a satellite with elements and none is
	// shown.
	useEffect(() => ensureSatellitePasses(artificialSatellitesState, observer), [state.tab, state.selectedId, state.details, state.passes, observerKey])
	useEffect(() => ensureSatelliteEphemeris(artificialSatellitesState, observer), [state.tab, state.selectedId, state.details, state.ephemeris, observerKey])

	// Searches tonight's passes when the view is shown and the favorites, the place of the site, or the catalog changed
	// since, or the night shown is over.
	useEffect(() => ensureTonight(artificialSatellitesState, source, favorites, observer, inputKey), [state.tab, inputKey])

	// Checks every TONIGHT_CHECK_MS while Tonight is shown whether its night is over, so a session left open through the
	// morning shows the next night.
	useEffect(() => {
		if (state.tab !== 'tonight') return undefined
		const timer = setInterval(() => {
			if (document.hidden) return
			const profile = activeProfile(profileState)
			const site = activeSite(profile, siteState.sites)
			const current = satelliteFavorites(profile.settings)
			const shown = artificialSatellitesState.tonight?.source ?? ''
			ensureTonight(artificialSatellitesState, shown, current, site, tonightKey(shown, current, site, satelliteCatalogState.revision))
		}, TONIGHT_CHECK_MS)
		return () => clearInterval(timer)
	}, [state.tab])

	// Focuses the search on /, unless a field, a list, or a dialog takes the key.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== '/' || event.ctrlKey || event.altKey || event.metaKey || takesKeys(event.target)) return
			event.preventDefault()
			searchRef.current?.focus()
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [])

	// Reads the details and the position again after a change of the catalog, such as a download of new elements.
	useEffect(() => {
		if (!revision) return
		void loadSatelliteDetails(artificialSatellitesState)
		void loadSatellitePosition(artificialSatellitesState, observer)
		void loadNextVisiblePass(artificialSatellitesState, observer)
		if (artificialSatellitesState.groundTrack) void loadSatelliteGroundTrack(artificialSatellitesState)
	}, [revision])

	// Selects the satellite the URL names.
	useEffect(() => {
		if (linked && linked !== artificialSatellitesState.selectedId) void selectSatellite(artificialSatellitesState, linked, observer)
	}, [linked])

	const panel = state.selectedId ? <SatelliteDetailsPanel observer={observer} zone={zone} /> : undefined
	const views = {
		tonight: <SatelliteTonight observer={observer} zone={zone} favorites={favorites} source={source} groups={groups} inputKey={inputKey} />,
		passes: <SatellitePasses observer={observer} zone={zone} />,
		groundTrack: <SatelliteGroundTrack observer={observer} zone={zone} />,
		ephemeris: <SatelliteEphemeris observer={observer} zone={zone} />,
	}
	// Toolbar of the views: the search on the left, as in the Sky, and the views on the right, which scroll sideways when
	// their row is wider than the room left.
	const toolbar = (
		<div className="flex flex-none items-center gap-2 border-b border-line-100 bg-base-100 px-2 max-sm:flex-wrap max-sm:gap-y-1 max-sm:py-1 sm:h-11">
			<SatelliteSearch observer={observer} inputRef={searchRef} onOpenGroups={() => setSettingsOpen(true)} />
			<div className="no-scrollbar ml-auto max-w-full min-w-0 overflow-x-auto max-sm:w-full">
				<SegmentedControl options={SATELLITE_TABS} value={state.tab} format={(tab) => SATELLITE_TAB_LABELS[tab]} onChange={(tab) => (artificialSatellitesState.tab = tab)} />
			</div>
		</div>
	)

	const settingsModal = <SatelliteSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} timeZone={zone.zone} />
	const actions = (
		<>
			<Popover icon="plus" label="Import Elements" open={importOpen} onOpenChange={setImportOpen}>
				<SatelliteImport />
			</Popover>
			<IconButton icon="database" label="CelesTrak Groups" pressed={settingsOpen} onClick={() => setSettingsOpen(true)} />
		</>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Artificial Satellites" actions={actions} panel={{ title: 'Satellite', content: panel ?? <EmptyState title="No satellite selected" description="Search for a satellite, or choose a pass tonight." /> }}>
			<div className="flex h-full min-h-0 flex-col">
				{toolbar}
				<div className="min-h-0 flex-1">{views[state.tab]}</div>
			</div>
			{settingsModal}
		</WorkspaceLayout>
	)
}
