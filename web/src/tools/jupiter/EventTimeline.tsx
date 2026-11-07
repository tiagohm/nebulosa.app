import type { JupiterEvent, JupiterEvents } from 'api'
import { formatClockTime, formatDateTime, formatDegrees, formatHours, formatLongDateTime, formatSpan, formatUtcDateTime } from '../../format'
import { DataList, DataRow } from '../../ui/DataRow'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { CONTACT_LABELS, CONTACT_ORDER, describeSource, KIND_DEFINITIONS, KIND_LABELS, MOON_LABELS, REASON_LABELS, VISIBILITY_LABELS } from './jupiter'

// Events of the period: a chronological table of what happens, when, and whether the site can watch it, and the inspector
// of the selected event with its contacts in the display zone and in UTC, its definition, what overlaps it, and where its
// numbers came from. Every contact is the server's; a contact is listed only when it was reached.

// Columns of the table.
const COLUMNS = ['When', 'Event', { key: 'maximum', label: 'Maximum' }, 'Here', { key: 'rank', label: 'Rank', numeric: true }] as const

// Name of an event: its kind and the moons taking part.
export function eventName(event: Pick<JupiterEvent, 'kind' | 'moons'>) {
	if (event.kind === 'grsTransit') return KIND_LABELS.grsTransit
	if (event.moons.length === 2) return `${KIND_LABELS[event.kind]}: ${MOON_LABELS[event.moons[0]]} ${event.kind === 'mutualOccultation' ? 'in front of' : 'shadowing'} ${MOON_LABELS[event.moons[1]]}`
	return `${MOON_LABELS[event.moons[0]]} ${KIND_LABELS[event.kind].toLowerCase()}`
}

export interface EventTimelineProps {
	// Events listed, chronologically.
	readonly events: readonly JupiterEvent[]
	// Id of the selected event.
	readonly selected?: string
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Receives the event chosen.
	readonly onSelect: (event: JupiterEvent) => void
}

// Chronological table of the events.
export function EventTimeline({ events, selected, timeZone, onSelect }: EventTimelineProps) {
	return (
		<Table columns={COLUMNS}>
			{events.map((event) => (
				<Row key={event.id} selected={event.id === selected} onSelect={() => onSelect(event)} title={KIND_DEFINITIONS[event.kind]}>
					<Cell>
						{formatDateTime(event.start, timeZone, false)}
						{event.end > event.start && `–${formatClockTime(event.end, timeZone)}`}
						{(event.startsBeforeRange || event.endsAfterRange) && <span className="text-ink-300"> (beyond the period)</span>}
					</Cell>
					<Cell>
						{eventName(event)}
						{event.overlaps.length > 0 && <span className="text-ink-300"> · overlaps {event.overlaps.length}</span>}
						{event.grazing && <span className="text-ink-300"> · grazing</span>}
					</Cell>
					<Cell>{formatClockTime(event.maximum, timeZone)}</Cell>
					<Cell>
						<StatusBadge {...VISIBILITY_LABELS[event.visibility.status]} />
					</Cell>
					<Cell numeric>{event.visibility.rank ?? ''}</Cell>
				</Row>
			))}
		</Table>
	)
}

export interface EventInspectorProps {
	readonly event: JupiterEvent
	// Every event of the answer, to name the overlapping ones.
	readonly all: readonly JupiterEvent[]
	readonly answer: JupiterEvents
	// IANA zone the times are shown in.
	readonly timeZone: string
}

// Inspector of the selected event.
export function EventInspector({ event, all, answer, timeZone }: EventInspectorProps) {
	const { visibility } = event
	const contacts = CONTACT_ORDER.filter((key) => event.contacts[key] !== undefined)
	const overlapping = all.filter((e) => event.overlaps.includes(e.id))

	return (
		<div className="flex flex-col gap-3">
			<p className="m-0 text-sm text-ink-200">{KIND_DEFINITIONS[event.kind]}</p>
			<DataList>
				{event.kind === 'grsTransit' ? (
					<>
						<DataRow label="Viewing window starts">{formatLongDateTime(event.start, timeZone)}</DataRow>
						<DataRow label="On the central meridian">{formatLongDateTime(event.maximum, timeZone)}</DataRow>
						<DataRow label="Viewing window ends">{formatLongDateTime(event.end, timeZone)}</DataRow>
						{event.grs && <DataRow label="Spot longitude (System II)">{formatDegrees(event.grs.longitude, 1)}</DataRow>}
						{event.grs && <DataRow label="Model reference age">{`${event.grs.referenceAgeDays.toFixed(1)} days`}</DataRow>}
					</>
				) : (
					<>
						{contacts.map((key) => (
							<DataRow key={key} label={CONTACT_LABELS[key]}>
								{`${formatLongDateTime(event.contacts[key]!, timeZone)} · ${formatUtcDateTime(event.contacts[key]!)}`}
							</DataRow>
						))}
						<DataRow label="Maximum">{`${formatLongDateTime(event.maximum, timeZone)} · ${formatUtcDateTime(event.maximum)}`}</DataRow>
						{event.impactParameter !== undefined && <DataRow label="Impact parameter">{event.impactParameter.toFixed(3)}</DataRow>}
						{contacts.length === 0 && <DataRow label="Contacts">None reached: a tangency or a contact outside the search.</DataRow>}
					</>
				)}
				{event.startsBeforeRange && <DataRow label="Starts">Before the period</DataRow>}
				{event.endsAfterRange && <DataRow label="Ends">After the period</DataRow>}
				<DataRow label="From the site">{VISIBILITY_LABELS[visibility.status].label}</DataRow>
				{visibility.eveningDate && <DataRow label="Night of">{visibility.eveningDate}</DataRow>}
				{visibility.longestMs > 0 && <DataRow label="Longest watchable part">{formatHours(visibility.longestMs)}</DataRow>}
				{visibility.peakAltitude !== undefined && <DataRow label="Jupiter's highest altitude">{formatDegrees(visibility.peakAltitude, 1)}</DataRow>}
				{visibility.peakAirmass !== undefined && <DataRow label="Airmass there">{visibility.peakAirmass.toFixed(2)}</DataRow>}
				{visibility.sunAltitude !== undefined && <DataRow label="Sun at the maximum">{formatDegrees(visibility.sunAltitude, 1)}</DataRow>}
				{visibility.windows.map((window) => (
					<DataRow key={window.start} label="Watchable">
						{formatSpan(window.start, window.end, timeZone)}
					</DataRow>
				))}
				{visibility.reasons.map((reason) => (
					<DataRow key={reason} label="Why not all of it">
						{REASON_LABELS[reason]}
					</DataRow>
				))}
				{overlapping.map((other) => (
					<DataRow key={other.id} label="Overlaps">
						{eventName(other)}
					</DataRow>
				))}
				<DataRow label="Ephemeris">{describeSource(answer.signature)}</DataRow>
			</DataList>
		</div>
	)
}
