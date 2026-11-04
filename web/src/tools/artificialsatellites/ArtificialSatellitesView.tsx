import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { activeProfile, profileState, satelliteFavorites } from '../../profile/profile'
import { satelliteCatalogState } from '../../satellites/satellites'
import { routeState } from '../../shell/route'
import { useMediaQuery, WIDE_SCREEN } from '../../shell/useMediaQuery'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { observerPlace } from '../eclipse/eclipse'
import { artificialSatellitesState, loadSatelliteDetails, loadSatellitePosition, SATELLITE_TAB_LABELS, SATELLITE_TABS, searchSatellites, selectSatellite } from './artificialsatellites'
import { SatelliteCatalog } from './SatelliteCatalog'
import { SatelliteDetailsPanel } from './SatelliteDetailsPanel'
import { SatelliteEphemeris } from './SatelliteEphemeris'
import { SatellitePasses } from './SatellitePasses'

// Artificial Satellites tool: the satellite catalog of the server (search, groups downloaded from CelesTrak on request,
// imports, favorites of the profile), and the passes and ephemeris of the satellite selected for a place. It commands no
// device and changes the Sky only through Open in Sky. The details are the contextual panel on wide screens and take the
// place of the content below them, as in Close Approaches.

// Artificial Satellites tool.
export function ArtificialSatellites() {
	const profiles = useSnapshot(profileState)
	const state = useSnapshot(artificialSatellitesState)
	const { revision } = useSnapshot(satelliteCatalogState)
	const route = useSnapshot(routeState)
	const { settings } = activeProfile(profiles)
	const observer = settings.sky.observer
	const favorites = satelliteFavorites(settings)
	const docked = useMediaQuery(WIDE_SCREEN)
	const linked = route.route.workspace === 'tools' ? route.route.satellite : undefined

	// Takes the Sky observer as the place until one is chosen, and follows it while it is the place.
	useEffect(() => {
		const { place } = artificialSatellitesState
		if (observer && (!place || place.source === 'observer')) artificialSatellitesState.place = observerPlace(observer)
	}, [observer?.latitude, observer?.longitude, observer?.elevation, observer?.timeZone])

	// Searches once, and again after every change of the catalog.
	useEffect(() => void searchSatellites(artificialSatellitesState, favorites, artificialSatellitesState.offset), [revision])

	// Reads the details and the position again after a change of the catalog, such as a download of new elements.
	useEffect(() => {
		if (!revision) return
		void loadSatelliteDetails(artificialSatellitesState)
		void loadSatellitePosition(artificialSatellitesState, observer)
	}, [revision])

	// Selects the satellite the URL names.
	useEffect(() => {
		if (linked && linked !== artificialSatellitesState.selectedId) void selectSatellite(artificialSatellitesState, linked, observer)
	}, [linked])

	const panel = state.selectedId ? <SatelliteDetailsPanel observer={observer} /> : undefined
	const content = state.tab === 'catalog' ? <SatelliteCatalog /> : state.tab === 'passes' ? <SatellitePasses observer={observer} /> : <SatelliteEphemeris observer={observer} />
	const tabs = <SegmentedControl options={SATELLITE_TABS} value={state.tab} format={(tab) => SATELLITE_TAB_LABELS[tab]} onChange={(tab) => (artificialSatellitesState.tab = tab)} />

	if (!docked && panel && state.tab === 'catalog') {
		return (
			<WorkspaceLayout workspace="tools" title="Artificial Satellites">
				<div className="h-full overflow-y-auto">
					<div className="border-b border-line-100 px-4 py-2">
						<Button variant="secondary" onClick={() => (artificialSatellitesState.selectedId = undefined)}>
							Back to Catalog
						</Button>
					</div>
					{panel}
				</div>
			</WorkspaceLayout>
		)
	}

	return (
		<WorkspaceLayout workspace="tools" title="Artificial Satellites" panel={{ title: 'Satellite', content: panel ?? <EmptyState title="No satellite selected" description="Select a satellite of the catalog." /> }}>
			<div className="flex h-full min-h-0 flex-col">
				<div className="flex-none overflow-x-auto border-b border-line-100 px-4 py-2">{tabs}</div>
				<div className="min-h-0 flex-1">{content}</div>
			</div>
		</WorkspaceLayout>
	)
}
