import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { ToolLocationSection } from '../../location/ToolLocationSection'
import { useDisplayZone, useToolLocation } from '../../location/useLocation'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { astronomicalTimeState, conversionRequest, followConversion, setConverterLocation } from './astronomicaltime'
import { HourAnglePanel } from './HourAnglePanel'
import { TimeConversionResults } from './TimeConversionResults'
import { TimeInputPanel } from './TimeInputPanel'

// Astronomical Time Converter tool: converts one instant between civil time, Unix time, Julian dates, epochs, and the
// timescales of the toolkit, with Greenwich and local sidereal times and an optional hour angle. The server computes every
// value and the tool shows them; it starts no operation and commands no device. The active profile's observing site is the
// default location, and neither a location chosen here nor the instant ever changes the profile, its site, or the Sky,
// except through the explicit Set Sky Time.

// Astronomical Time Converter tool.
export function AstronomicalTimeConverter() {
	const state = useSnapshot(astronomicalTimeState)
	const location = useToolLocation(state.location)
	const zone = useDisplayZone(location, state.zone)
	const inputs = conversionRequest(state, location, zone.zone)
	const key = JSON.stringify(inputs)
	const { result, error, inputError, ambiguous } = state

	// Follows the inputs while the tool is shown; the key holds everything the request depends on.
	useEffect(() => followConversion(astronomicalTimeState, inputs), [key])

	const panel = (
		<>
			<TimeInputPanel zone={zone.zone} location={location} />
			<ToolLocationSection value={state.location} location={location} onChange={(value) => setConverterLocation(astronomicalTimeState, value)} elevation />
			<HourAnglePanel />
		</>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Astronomical Time Converter" panel={{ title: 'Time and Location', content: panel }}>
			<div className="h-full overflow-y-auto">
				{result && <TimeConversionResults result={result} zone={zone} located={location !== undefined} />}
				{!result && <EmptyState title={ambiguous ? 'Choose an occurrence' : error || inputError ? 'No result' : 'Converting'} description={ambiguous ? 'The clocks repeat this reading: choose Earlier or Later in the panel.' : (error ?? inputError)} />}
			</div>
		</WorkspaceLayout>
	)
}
