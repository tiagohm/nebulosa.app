import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { ToolLocationSection } from '../../location/ToolLocationSection'
import { useDisplayZone, useToolLocation } from '../../location/useLocation'
import { EmptyState, useWorkspacePanel, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { StatusBadge, type StatusTone } from '../../ui/StatusBadge'
import { answersInputs, astronomicalTimeState, type AstronomicalTimeState, conversionRequest, followConversion, setConverterLocation } from './astronomicaltime'
import { HourAnglePanel } from './HourAnglePanel'
import { TimeConversionResults } from './TimeConversionResults'
import { TimeInputPanel } from './TimeInputPanel'

// Astronomical Time Converter tool: converts one instant between civil time, Unix time, Julian dates, epochs, and the
// timescales of the toolkit, with Greenwich and local sidereal times and an optional hour angle. The server computes every
// value and the tool shows them; it starts no operation and commands no device. The active profile's observing site is the
// default location, and neither a location chosen here nor the instant ever changes the profile, its site, or the Sky,
// except through the explicit Set Sky Time. The header says in a word whether the values follow the real current time,
// are of the instant entered, or are kept from earlier inputs, and Edit Instant reaches the entry from anywhere.

// State of the values shown, in words.
interface ResultStatus {
	// Tone of the badge.
	readonly tone: StatusTone
	// The state, in a word or two.
	readonly label: string
	// The full reason, shown as the tooltip.
	readonly title: string
}

// Explanation closing the reason of every status whose values are of earlier inputs.
const KEPT = 'The values shown are of the last instant converted.'

// Returns the state of the values shown: live, of the instant entered, or kept from earlier inputs and why; undefined
// before any answer.
function resultStatus(state: Pick<AstronomicalTimeState, 'mode' | 'result' | 'inputError' | 'error' | 'ambiguous'>, current: boolean): ResultStatus | undefined {
	if (!state.result) return undefined
	if (current) return state.mode === 'now' ? { tone: 'success', label: 'Live', title: 'Following the real current time, converted every second' } : { tone: 'neutral', label: 'Custom instant', title: 'The values are of the instant entered' }
	if (state.ambiguous) return { tone: 'warning', label: 'Choose an occurrence', title: `The clocks repeat this reading: choose Earlier or Later in the panel. ${KEPT}` }
	if (state.inputError) return { tone: 'warning', label: 'Entry incomplete', title: `${state.inputError} ${KEPT}` }
	if (state.error) return { tone: 'danger', label: 'Not converted', title: `${state.error.replace(/\.?$/, '.')} ${KEPT}` }
	return { tone: 'muted', label: 'Converting', title: `Converting the new inputs. ${KEPT}` }
}

// Astronomical Time Converter tool.
export function AstronomicalTimeConverter() {
	const state = useSnapshot(astronomicalTimeState)
	const panelState = useWorkspacePanel('tools')
	const location = useToolLocation(state.location)
	const zone = useDisplayZone(location, state.zone)
	const inputs = conversionRequest(state, location, zone.zone)
	const key = JSON.stringify(inputs)
	const { result, error, inputError, ambiguous } = state
	const current = answersInputs(state, inputs)
	const status = resultStatus(state, current)

	// Follows the inputs while the tool is shown; the key holds everything the request depends on.
	useEffect(() => followConversion(astronomicalTimeState, inputs), [key])

	const panel = (
		<>
			<TimeInputPanel zone={zone.zone} location={location} current={current} />
			<ToolLocationSection id="tools.astronomicalTime.location" value={state.location} location={location} onChange={(value) => setConverterLocation(astronomicalTimeState, value)} elevation />
			<HourAnglePanel />
		</>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Astronomical Time Converter" context={status && <StatusBadge tone={status.tone} label={status.label} title={status.title} />} panel={{ title: 'Time and Location', content: panel }} panelState={panelState}>
			<div className="h-full overflow-y-auto">
				{result && <TimeConversionResults result={result} zone={zone} located={location !== undefined} current={current} rightAscensionError={state.rightAscensionError} />}
				{!result && <EmptyState title={ambiguous ? 'Choose an occurrence' : error || inputError ? 'No result' : 'Converting'} description={ambiguous ? 'The clocks repeat this reading: choose Earlier or Later in the panel.' : (error ?? inputError)} />}
			</div>
		</WorkspaceLayout>
	)
}
