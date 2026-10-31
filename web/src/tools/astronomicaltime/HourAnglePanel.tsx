import { formatRA } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { skyState } from '../../sky/sky'
import { Button } from '../../ui/Button'
import { TextInput } from '../../ui/TextInput'
import { Note } from '../eclipse/EclipsePanelParts'
import { astronomicalTimeState } from './astronomicaltime'

// Hour angle input of the Astronomical Time Converter. Local apparent sidereal time is referred to the true equator and
// equinox of date, so the right ascension must be too: a J2000 value would be off by the precession since then, and is
// not offered. The Sky selection is copied by value, at the instant of its position.

// Hour angle section of the tool.
export function HourAnglePanel() {
	const { rightAscension } = useSnapshot(astronomicalTimeState)
	const position = useSnapshot(skyState).selection?.position

	return (
		<CollapsibleSection id="tools.astronomicalTime.hourAngle" title="Hour Angle" summary={rightAscension || 'No target'} defaultOpen={false}>
			<TextInput label="Apparent RA of Date" suffix="h" placeholder="05 30 00" spellCheck={false} value={rightAscension} onChange={(e) => (astronomicalTimeState.rightAscension = e.target.value)} />
			<Button variant="secondary" disabled={!position} title={position ? 'Copies the apparent right ascension of date of the Sky selection' : 'Select an object in the Sky first'} onClick={() => position && (astronomicalTimeState.rightAscension = formatRA(position.rightAscension, 2))}>
				Use Sky Selection
			</Button>
			{position && <Note>The Sky selection was computed for {new Date(position.time).toISOString()}.</Note>}
			<Note>Hours as 5.5 or 05 30 00, referred to the true equinox of date, not J2000.</Note>
		</CollapsibleSection>
	)
}
