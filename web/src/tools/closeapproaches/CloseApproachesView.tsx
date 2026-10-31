import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { activeProfile, closeApproachPreferences, profileState } from '../../profile/profile'
import { useMediaQuery, WIDE_SCREEN } from '../../shell/useMediaQuery'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { BROWSER_TIME_ZONE } from '../../sky/clock'
import { Button } from '../../ui/Button'
import { clearCloseApproachSelection, type CloseApproachesState, closeApproachesState, displayTimeZone, openCloseApproaches } from './closeapproaches'
import { CloseApproachFilters } from './CloseApproachFilters'
import { CloseApproachInspector } from './CloseApproachInspector'
import { CloseApproachObservability, CloseApproachSkyActions } from './CloseApproachObservability'
import { CloseApproachTable } from './CloseApproachTable'

// Close Approaches tool: browses the close encounters of asteroids and comets that JPL publishes and opens the object
// behind one. It reads the server and commands nothing. The inspector is the contextual panel on wide screens and takes
// the place of the table below them, since the shell keeps the state of its drawer to itself. A close approach is not a
// measure of risk, and the tool never presents it as one.

// Close Approaches tool.
export function CloseApproaches() {
	const profiles = useSnapshot(profileState)
	const { selected } = useSnapshot(closeApproachesState) as CloseApproachesState
	const { settings } = activeProfile(profiles)
	const preferences = closeApproachPreferences(settings)
	const { observer } = settings.sky
	const docked = useMediaQuery(WIDE_SCREEN)
	const timeZone = displayTimeZone(preferences.timeDisplay, observer?.timeZone, BROWSER_TIME_ZONE)

	// Runs the first search of the tab.
	useEffect(() => void openCloseApproaches(closeApproachesState, preferences), [])

	const inspector = selected && (
		<CloseApproachInspector
			approach={selected}
			timeZone={timeZone}
			distanceDisplay={preferences.distanceDisplay}
			actions={(body) => <CloseApproachSkyActions body={body} time={selected.time} observer={observer} />}
			observability={(body) => <CloseApproachObservability body={body} time={selected.time} observer={observer} timeZone={timeZone} />}
		/>
	)

	if (!docked && selected) {
		return (
			<WorkspaceLayout workspace="tools" title="Close Approaches">
				<div className="h-full overflow-y-auto">
					<div className="border-b border-line-100 px-4 py-2">
						<Button variant="secondary" onClick={() => clearCloseApproachSelection(closeApproachesState)}>
							Back to Results
						</Button>
					</div>
					{inspector}
				</div>
			</WorkspaceLayout>
		)
	}

	return (
		<WorkspaceLayout workspace="tools" title="Close Approaches" panel={docked ? { title: 'Encounter', content: inspector ?? <EmptyState title="No encounter selected" description="Select an encounter to see its object." /> } : undefined}>
			<div className="flex h-full min-h-0 flex-col overflow-y-auto lg:overflow-hidden">
				<CloseApproachFilters />
				<CloseApproachTable timeZone={timeZone} preferences={preferences} />
			</div>
		</WorkspaceLayout>
	)
}
