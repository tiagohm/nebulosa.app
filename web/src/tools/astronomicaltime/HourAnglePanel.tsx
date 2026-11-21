import { formatRA } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import { formatHourAngle, formatZonedDateTime } from '../../format'
import { useActiveTimeZone } from '../../location/useLocation'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { skyState } from '../../sky/sky'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { TextInput } from '../../ui/TextInput'
import { astronomicalTimeState } from './astronomicaltime'

// Hour angle input of the Astronomical Time Converter. Local apparent sidereal time is referred to the true equator and
// equinox of date, so the right ascension must be too: a J2000 value would be off by the precession since then, and is
// not offered. The Sky selection is copied by value, at the instant of its position. A right ascension that cannot be read
// is reported under its field and only costs the hour angle: the instant is still converted.

// Returns the one-line summary of the collapsed section: the hour angle when there is one, else the state of the field.
function hourAngleSummary(rightAscension: string, error: string | undefined, hourAngle: number | undefined) {
	if (error) return 'Right ascension unreadable'
	if (hourAngle !== undefined && rightAscension.trim()) return `HA ${formatHourAngle(hourAngle)}`
	return rightAscension || 'No target'
}

// Hour angle section of the tool.
export function HourAnglePanel() {
	const timeZone = useActiveTimeZone()
	const { rightAscension, rightAscensionError, result } = useSnapshot(astronomicalTimeState)
	const position = useSnapshot(skyState).selection?.position

	return (
		<CollapsibleSection id="tools.astronomicalTime.hourAngle" title="Hour Angle" summary={hourAngleSummary(rightAscension, rightAscensionError, result?.hourAngle)} defaultOpen={false}>
			<TextInput label="Apparent RA of Date" suffix="h" placeholder="05 30 00" value={rightAscension} onChange={(e) => (astronomicalTimeState.rightAscension = e.target.value)} />
			{rightAscensionError && <Notice error>{rightAscensionError}</Notice>}
			<Button variant="secondary" disabled={!position} title={position ? 'Copies the apparent right ascension of date of the Sky selection' : 'Select an object in the Sky first'} onClick={() => position && (astronomicalTimeState.rightAscension = formatRA(position.rightAscension, 2))}>
				Use Sky Selection
			</Button>
			{position && <Notice>The Sky selection was computed for {formatZonedDateTime(position.time, timeZone)}.</Notice>}
			<Notice>Hours as 5.5 or 05 30 00, referred to the true equinox of date, not J2000.</Notice>
		</CollapsibleSection>
	)
}
