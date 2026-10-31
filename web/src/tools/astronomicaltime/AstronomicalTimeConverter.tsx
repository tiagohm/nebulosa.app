import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { activeProfile, profileState } from '../../profile/profile'
import { navigate, routeState } from '../../shell/route'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { skyState } from '../../sky/sky'
import { Button } from '../../ui/Button'
import { type EclipsePlace, observerPlace } from '../eclipse/eclipse'
import { LocationSection, Note } from '../eclipse/EclipsePanelParts'
import { astronomicalTimeState, conversionRequest, effectiveObserver, effectiveTimeZone, followConversion } from './astronomicaltime'
import { HourAnglePanel } from './HourAnglePanel'
import { TimeConversionResults } from './TimeConversionResults'
import { TimeInputPanel } from './TimeInputPanel'

// Astronomical Time Converter tool: converts one instant between civil time, Unix time, Julian dates, epochs, and the
// timescales of the toolkit, with Greenwich and local sidereal times and an optional hour angle. The server computes every
// value and the tool shows them; it starts no operation and commands no device. The active profile's Sky observer is the
// default location, and neither a location chosen here nor the instant ever changes the profile or the Sky, except through
// the explicit Set Sky Time.

// Opens the Observer panel of the Sky.
function openObserver() {
	skyState.panel = 'observer'
	navigate(routeState, { workspace: 'sky' })
}

// Takes a place of the Location section: the Sky observer is followed live, any other place is held for the tool alone.
function choosePlace(place: EclipsePlace) {
	astronomicalTimeState.place = place.source === 'observer' ? undefined : place
}

// Astronomical Time Converter tool.
export function AstronomicalTimeConverter() {
	const profiles = useSnapshot(profileState)
	const state = useSnapshot(astronomicalTimeState)
	const observer = activeProfile(profiles).settings.sky.observer
	const timeZone = effectiveTimeZone(state, observer)
	const located = effectiveObserver(state, observer) !== undefined
	const inputs = conversionRequest(state, observer)
	const key = JSON.stringify(inputs)
	const { result, error, inputError, ambiguous } = state

	// Follows the inputs while the tool is shown; the key holds everything the request depends on.
	useEffect(() => followConversion(astronomicalTimeState, inputs), [key])

	const panel = (
		<>
			<TimeInputPanel timeZone={timeZone} />
			<LocationSection place={state.place ?? (observer && observerPlace(observer))} observer={observer} onSelect={choosePlace} />
			{!observer && (
				<div className="flex flex-col gap-2 px-4 py-3">
					<Note>This profile has no Sky observer, so the tool has no default location.</Note>
					<Button variant="secondary" className="self-start" onClick={openObserver}>
						Set Sky Observer
					</Button>
				</div>
			)}
			<HourAnglePanel />
		</>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Astronomical Time Converter" panel={{ title: 'Time and Location', content: panel }}>
			<div className="h-full overflow-y-auto">
				{result && <TimeConversionResults result={result} timeZone={timeZone} located={located} />}
				{!result && <EmptyState title={ambiguous ? 'Choose an occurrence' : error || inputError ? 'No result' : 'Converting'} description={ambiguous ? 'The clocks repeat this reading: choose Earlier or Later in the panel.' : (error ?? inputError)} />}
			</div>
		</WorkspaceLayout>
	)
}
