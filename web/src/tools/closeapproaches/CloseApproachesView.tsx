import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { useActiveSite, useDisplayZone } from '../../location/useLocation'
import { activeProfile, closeApproachPreferences, profileState } from '../../profile/profile'
import { useMediaQuery, WIDE_SCREEN } from '../../shell/useMediaQuery'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { type CloseApproachesState, closeApproachesState, openCloseApproaches } from './closeapproaches'
import { CloseApproachFilters } from './CloseApproachFilters'
import { CloseApproachInspector } from './CloseApproachInspector'
import { CloseApproachObservability, CloseApproachSkyActions } from './CloseApproachObservability'
import { CloseApproachTable } from './CloseApproachTable'

// Close Approaches tool: browses the close encounters of asteroids and comets that JPL publishes and opens the object
// behind one. It reads the server and commands nothing. The inspector is the contextual panel on wide screens and covers
// the results below them, since the shell keeps the state of its drawer to itself; Back to Results uncovers them as they
// were, the encounter still selected and focused. A close approach is not a measure of risk, and the tool never presents
// it as one. Times are shown in the profile's display zone against the active observing site, which the Observability
// section and the Sky handoff observe from.

// Close Approaches tool.
export function CloseApproaches() {
	const profiles = useSnapshot(profileState)
	const { selected } = useSnapshot(closeApproachesState) as CloseApproachesState
	const preferences = closeApproachPreferences(activeProfile(profiles).settings)
	const site = useActiveSite()
	const zone = useDisplayZone(site)
	const docked = useMediaQuery(WIDE_SCREEN)
	// Whether the results are uncovered below the wide breakpoint while an encounter stays selected.
	const [resultsShown, setResultsShown] = useState(false)
	const results = useRef<HTMLDivElement>(null)

	// Runs the first search of the tab.
	useEffect(() => void openCloseApproaches(closeApproachesState, preferences), [])

	// Covers the results again for each selection, the same encounter chosen again included, since it is a new snapshot.
	useEffect(() => setResultsShown(false), [selected])

	// Uncovers the results and returns the focus to the row of the encounter selected.
	function backToResults() {
		setResultsShown(true)
		requestAnimationFrame(() => results.current?.querySelector<HTMLElement>('tr[data-selected]')?.focus())
	}

	const inspector = selected && (
		<CloseApproachInspector
			approach={selected}
			zone={zone}
			distanceDisplay={preferences.distanceDisplay}
			actions={(body) => <CloseApproachSkyActions body={body} time={selected.time} site={site} />}
			observability={(body) => <CloseApproachObservability body={body} time={selected.time} site={site} timeZone={zone.zone} distanceDisplay={preferences.distanceDisplay} />}
		/>
	)

	const covered = !docked && !!selected && !resultsShown

	return (
		<WorkspaceLayout workspace="tools" title="Close Approaches" panel={docked ? { title: 'Encounter', content: inspector ?? <EmptyState title="No encounter selected" description="Select an encounter to see its object." /> } : undefined}>
			<div className="relative h-full min-h-0">
				<div ref={results} className={covered ? 'invisible flex h-full min-h-0 flex-col' : 'flex h-full min-h-0 flex-col'}>
					<CloseApproachFilters />
					<CloseApproachTable timeZone={zone.zone} preferences={preferences} />
				</div>
				{covered && (
					<div className="absolute inset-0 overflow-y-auto bg-base-000">
						<div className="border-b border-line-100 px-4 py-2">
							<Button variant="secondary" onClick={backToResults}>
								Back to Results
							</Button>
						</div>
						{inspector}
					</div>
				)}
			</div>
		</WorkspaceLayout>
	)
}
