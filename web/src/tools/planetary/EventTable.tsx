import type { PlanetEventVisibility } from 'api'
import type { ReactNode } from 'react'
import { formatClockTime, formatDateTime, formatDegrees, formatHours, formatLongDateTime, formatSpan, formatUtcDateTime } from '../../format'
import { DataRow } from '../../ui/DataRow'
import { StatusBadge, type StatusTone } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { CONTACT_LABELS, CONTACT_ORDER } from './planetary'

// Events of a planetary planner: a chronological table of what happens, when, and whether the site can watch it, and
// the rows an inspector shows for an event's contacts and visibility. The planner supplies the names, definitions, and
// labels of its own event kinds and reasons. Every contact is the server's; a contact is listed only when it was reached.

// What the table and the inspector rows read of an event.
export interface PlanetEventRow {
	readonly id: string
	readonly start: number
	readonly maximum: number
	readonly end: number
	readonly startsBeforeRange: boolean
	readonly endsAfterRange: boolean
	readonly grazing: boolean
	readonly overlaps: readonly string[]
	readonly contacts: Readonly<Partial<Record<(typeof CONTACT_ORDER)[number], number>>>
	readonly impactParameter?: number
	// Position among the watchable events, 1 the best.
	readonly visibility: { readonly rank?: number }
}

// Label and tone of a visibility status.
export interface StatusLabel {
	readonly label: string
	readonly tone: StatusTone
}

// Columns of the table.
const COLUMNS = ['When', 'Event', { key: 'maximum', label: 'Maximum' }, 'Here', { key: 'rank', label: 'Rank', numeric: true }] as const

export interface EventTableProps<E extends PlanetEventRow> {
	// Events listed, chronologically.
	readonly events: readonly E[]
	// Id of the selected event.
	readonly selected?: string
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Name of an event.
	readonly name: (event: E) => string
	// One-sentence definition of an event's kind, shown as the row's title.
	readonly definition: (event: E) => string
	// Label and tone of an event's visibility.
	readonly status: (event: E) => StatusLabel
	// Receives the event chosen.
	readonly onSelect: (event: E) => void
}

// Chronological table of the events.
export function EventTable<E extends PlanetEventRow>({ events, selected, timeZone, name, definition, status, onSelect }: EventTableProps<E>) {
	return (
		<Table columns={COLUMNS}>
			{events.map((event) => (
				<Row key={event.id} selected={event.id === selected} onSelect={() => onSelect(event)} title={definition(event)}>
					<Cell>
						{formatDateTime(event.start, timeZone, false)}
						{event.end > event.start && `–${formatClockTime(event.end, timeZone)}`}
						{(event.startsBeforeRange || event.endsAfterRange) && <span className="text-ink-300"> (beyond the period)</span>}
					</Cell>
					<Cell>
						{name(event)}
						{event.overlaps.length > 0 && <span className="text-ink-300"> · overlaps {event.overlaps.length}</span>}
						{event.grazing && <span className="text-ink-300"> · grazing</span>}
					</Cell>
					<Cell>{formatClockTime(event.maximum, timeZone)}</Cell>
					<Cell>
						<StatusBadge {...status(event)} />
					</Cell>
					<Cell numeric>{event.visibility.rank ?? ''}</Cell>
				</Row>
			))}
		</Table>
	)
}

export interface ContactRowsProps {
	readonly event: PlanetEventRow
	// IANA zone the times are shown in.
	readonly timeZone: string
}

// Rows of an event's reached contacts and maximum, in the display zone and in UTC, with the impact parameter of a mutual
// event.
export function ContactRows({ event, timeZone }: ContactRowsProps) {
	const contacts = CONTACT_ORDER.filter((key) => event.contacts[key] !== undefined)

	return (
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
	)
}

export interface VisibilityRowsProps<R extends string> {
	// The visibility; its status is labelled by the planner.
	readonly visibility: Omit<PlanetEventVisibility<R>, 'status'>
	// Label of the visibility status.
	readonly status: string
	// Name of the planet, for its altitude row.
	readonly planet: string
	// Sentence of a reason code.
	readonly reason: (reason: R) => ReactNode
	// IANA zone the times are shown in.
	readonly timeZone: string
}

// Rows of an event's visibility from the site: the status, the night, the watchable parts, the planet's and the Sun's
// altitudes, and why part of it cannot be watched.
export function VisibilityRows<R extends string>({ visibility, status, planet, reason, timeZone }: VisibilityRowsProps<R>) {
	return (
		<>
			<DataRow label="From the site">{status}</DataRow>
			{visibility.eveningDate && <DataRow label="Night of">{visibility.eveningDate}</DataRow>}
			{visibility.longestMs > 0 && <DataRow label="Longest watchable part">{formatHours(visibility.longestMs)}</DataRow>}
			{visibility.peakAltitude !== undefined && <DataRow label={`${planet}'s highest altitude`}>{formatDegrees(visibility.peakAltitude, 1)}</DataRow>}
			{visibility.peakAirmass !== undefined && <DataRow label="Airmass there">{visibility.peakAirmass.toFixed(2)}</DataRow>}
			{visibility.sunAltitude !== undefined && <DataRow label="Sun at the maximum">{formatDegrees(visibility.sunAltitude, 1)}</DataRow>}
			{visibility.windows.map((window) => (
				<DataRow key={window.start} label="Watchable">
					{formatSpan(window.start, window.end, timeZone)}
				</DataRow>
			))}
			{visibility.reasons.map((code) => (
				<DataRow key={code} label="Why not all of it">
					{reason(code)}
				</DataRow>
			))}
		</>
	)
}
