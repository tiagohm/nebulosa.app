import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { activeSite, locationKey, siteState } from '../../location/site'
import { useActiveSite, useDisplayZone } from '../../location/useLocation'
import { activeProfile, profileState, satelliteFavorites } from '../../profile/profile'
import { satelliteCatalogState } from '../../satellites/satellites'
import { routeState } from '../../shell/route'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { IconButton } from '../../ui/IconButton'
import { Popover } from '../../ui/Popover'
import { Select } from '../../ui/Select'
import { artificialSatellitesState, ensureSatelliteGroundTrack, followSatelliteObserver, loadSatelliteDetails, loadSatelliteGroundTrack, loadSatellitePosition, POSITION_REFRESH_MS, SATELLITE_TAB_LABELS, SATELLITE_TABS, searchSatellites, selectSatellite, tickSatelliteGroundTrack } from './artificialsatellites'
import { SatelliteCatalog } from './SatelliteCatalog'
import { SatelliteDetailsPanel } from './SatelliteDetailsPanel'
import { SatelliteEphemeris } from './SatelliteEphemeris'
import { SatelliteGroundTrack } from './SatelliteGroundTrack'
import { SatelliteImport } from './SatelliteImport'
import { SatellitePasses } from './SatellitePasses'
import { SatelliteSettings } from './SatelliteSettings'

// Artificial Satellites tool: the satellite catalog of the server (search, favorites of the profile), the passes and
// ephemeris of the satellite selected for the observing site of the active profile (the tool has no place of its own),
// with its position now read again every 15 seconds, and its ground track on the world map, which follows the real
// time on the same tick. Civil times are shown in the profile's display zone. The view is chosen in the header, beside
// the title, as the Images tool is, and its workspace actions hold the Import Elements popover and the Settings of the
// tool, where the CelesTrak groups are downloaded on request or automatically. It commands no device and changes the
// Sky only through Open in Sky and Show in Sky. The details of the satellite selected are the contextual panel, a
// drawer on narrow screens that choosing a satellite never opens, so any view stays one choice away.

// Artificial Satellites tool.
export function ArtificialSatellites() {
	const profiles = useSnapshot(profileState)
	const state = useSnapshot(artificialSatellitesState)
	const { revision } = useSnapshot(satelliteCatalogState)
	const route = useSnapshot(routeState)
	const { settings } = activeProfile(profiles)
	const observer = useActiveSite()
	const zone = useDisplayZone(observer)
	const observerKey = locationKey(observer)
	const favorites = satelliteFavorites(settings)
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
			void loadSatellitePosition(artificialSatellitesState, activeSite(activeProfile(profileState), siteState.sites))
			if (artificialSatellitesState.tab === 'groundTrack') tickSatelliteGroundTrack(artificialSatellitesState)
		}, POSITION_REFRESH_MS)
		return () => clearInterval(timer)
	}, [state.selectedId])

	// Reads the ground track when its view is shown for a satellite with elements and none was read.
	useEffect(() => ensureSatelliteGroundTrack(artificialSatellitesState), [state.tab, state.selectedId, state.details, state.groundTrack])

	// Searches once, and again after every change of the catalog.
	useEffect(() => void searchSatellites(artificialSatellitesState, favorites, artificialSatellitesState.offset), [revision])

	// Reads the details and the position again after a change of the catalog, such as a download of new elements.
	useEffect(() => {
		if (!revision) return
		void loadSatelliteDetails(artificialSatellitesState)
		void loadSatellitePosition(artificialSatellitesState, observer)
		if (artificialSatellitesState.groundTrack) void loadSatelliteGroundTrack(artificialSatellitesState)
	}, [revision])

	// Selects the satellite the URL names.
	useEffect(() => {
		if (linked && linked !== artificialSatellitesState.selectedId) void selectSatellite(artificialSatellitesState, linked, observer)
	}, [linked])

	const panel = state.selectedId ? <SatelliteDetailsPanel observer={observer} zone={zone} /> : undefined
	const content = state.tab === 'catalog' ? <SatelliteCatalog /> : state.tab === 'passes' ? <SatellitePasses observer={observer} zone={zone} /> : state.tab === 'ephemeris' ? <SatelliteEphemeris observer={observer} zone={zone} /> : <SatelliteGroundTrack observer={observer} zone={zone} />
	const viewSelector = <Select options={SATELLITE_TABS} value={state.tab} format={(tab) => SATELLITE_TAB_LABELS[tab]} onChange={(tab) => (artificialSatellitesState.tab = tab)} className="w-40" />

	const settingsModal = <SatelliteSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} timeZone={zone.zone} />
	const actions = (
		<>
			<Popover icon="file" label="Import Elements" open={importOpen} onOpenChange={setImportOpen}>
				<SatelliteImport />
			</Popover>
			<IconButton icon="settings" label="Settings" pressed={settingsOpen} onClick={() => setSettingsOpen(true)} />
		</>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Artificial Satellites" context={viewSelector} actions={actions} panel={{ title: 'Satellite', content: panel ?? <EmptyState title="No satellite selected" description="Select a satellite of the catalog." /> }}>
			{content}
			{settingsModal}
		</WorkspaceLayout>
	)
}
