import { useSnapshot } from 'valtio'
import type { ResolvedLocation } from '../../location/site'
import { TimeZoneSelect } from '../../location/TimeZoneSelect'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import {
	applyToSky,
	astronomicalTimeState,
	CALENDAR_READS,
	type CalendarRead,
	chooseFold,
	type ConverterMode,
	foldIn,
	INPUT_FORMAT_EXAMPLES,
	INPUT_FORMAT_LABELS,
	INPUT_FORMATS,
	setCalendarRead,
	setConverterMode,
	setConverterZone,
	setEntryText,
	setInputFormat,
	setInputScale,
	TIME_SCALE_NAMES,
	takeSkyTime,
} from './astronomicaltime'

// Input of the Astronomical Time Converter: the real current time or a custom instant in one of the forms the tool reads,
// the time zone of the local calendar, and the two explicit exchanges with the simulation clock of the Sky. Keeping the
// timescale of a value apart from the time zone is what lets a calendar be read in TT without naming any civil zone.

// Options of the mode, in control order.
const MODES: readonly ConverterMode[] = ['now', 'custom']

// Name of each mode.
const MODE_LABELS: Readonly<Record<ConverterMode, string>> = { now: 'Now', custom: 'Custom' }

// Returns the name of an option of what a calendar entry is read in.
function calendarReadLabel(read: CalendarRead) {
	return read === 'zone' ? 'Time Zone' : read
}

export interface TimeInputPanelProps {
	// Time zone of the local calendar in force, an IANA name.
	readonly zone: string
	// Place the tool observes from, whose zone the Site choice takes; absent when it has none.
	readonly location?: ResolvedLocation
}

// Input section of the tool.
export function TimeInputPanel({ zone, location }: TimeInputPanelProps) {
	const { mode, format, text, scale, read, fold, zone: override, result, inputError, ambiguous } = useSnapshot(astronomicalTimeState)
	const unixMillis = result?.civil.unixMillis
	const custom = mode === 'custom'
	const occurrence = foldIn(fold, zone)

	return (
		<CollapsibleSection id="tools.astronomicalTime.input" title="Instant">
			<SegmentedControl label="Mode" options={MODES} value={mode} format={(value) => MODE_LABELS[value]} onChange={(value) => setConverterMode(astronomicalTimeState, value)} />
			{custom && (
				<>
					<Select label="Format" options={INPUT_FORMATS} value={format} format={(value) => INPUT_FORMAT_LABELS[value]} onChange={(value) => setInputFormat(astronomicalTimeState, value)} />
					{format === 'calendar' && <Select label="Read In" options={CALENDAR_READS} value={read} format={calendarReadLabel} onChange={(value) => setCalendarRead(astronomicalTimeState, value)} />}
					{(format === 'jd' || format === 'mjd') && <Select label="Timescale" options={TIME_SCALE_NAMES} value={scale} onChange={(value) => setInputScale(astronomicalTimeState, value)} />}
					<TextInput label={INPUT_FORMAT_LABELS[format]} placeholder={INPUT_FORMAT_EXAMPLES[format]} spellCheck={false} value={text} onChange={(e) => setEntryText(astronomicalTimeState, e.target.value)} />
					{inputError && <Notice error>{inputError}</Notice>}
					{ambiguous && (
						<>
							<Notice>The clocks of {zone} show this reading twice. Choose one.</Notice>
							<div className="grid grid-cols-2 gap-2">
								<Button variant="secondary" onClick={() => chooseFold(astronomicalTimeState, 'earlier', zone)}>
									Earlier
								</Button>
								<Button variant="secondary" onClick={() => chooseFold(astronomicalTimeState, 'later', zone)}>
									Later
								</Button>
							</div>
						</>
					)}
					{occurrence && <Notice>Reading the {occurrence} of the two occurrences.</Notice>}
					{(format === 'julianEpoch' || format === 'besselianEpoch') && <Notice>Epochs are in TT.</Notice>}
					{format === 'unix' && <Notice>Unix time counts UTC days of 86400 s, so it has no timescale and no leap seconds.</Notice>}
				</>
			)}
			<TimeZoneSelect value={override} onChange={(value) => setConverterZone(astronomicalTimeState, value)} site={location} selectedSite={location !== undefined && location.source !== 'active'} />
			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" title="Copies the instant the Sky shows into a custom instant" onClick={() => takeSkyTime(astronomicalTimeState)}>
					Use Sky Time
				</Button>
				<Button variant="secondary" disabled={unixMillis === undefined} title={unixMillis === undefined ? 'A leap second or a missing result has no instant the Sky can show' : 'Sends the Sky simulation clock to this instant'} onClick={() => applyToSky(astronomicalTimeState)}>
					Set Sky Time
				</Button>
			</div>
		</CollapsibleSection>
	)
}
