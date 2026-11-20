import type { PlanetEventVisibility } from 'api'
import { Fragment, type ReactNode } from 'react'
import { formatCivilDate, formatClockTime, formatDateTime, formatDegrees, formatHours, formatFixed, formatLongDateTime, formatSpan } from '../../format'
import { DataRow } from '../../ui/DataRow'
import { StatusBadge, type StatusTone } from '../../ui/StatusBadge'
import { Cell, GroupRow, Row, SortHeader, Table, type TableColumn } from '../../ui/Table'
import { CONTACT_LABELS, CONTACT_ORDER } from './planetary'

// Events of a planetary planner: a table of what happens, when, and whether the site can watch it, and the rows an
// inspector shows for an event's contacts and visibility. The planner supplies the names, definitions, and labels of its
// own event kinds and reasons, and the order of the events; it may head each night's events with a group row, and may let
// the When and Rank headers order the table. Every contact is the server's; a contact is listed only when it was reached.

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

// Order of an event table that the planner lets the headers change: by time, or by the rank of the watchable events.
export type EventTableOrder = 'time' | 'rank'

// Number of columns of the table.
const COLUMN_COUNT = 5

// Classes of the Maximum column, hidden below 640 px so the status fits a phone; the inspector lists the maximum.
const NARROW_HIDDEN = 'max-sm:hidden'

// Columns of the table, with the When and Rank headers ordering it when the planner gives `onOrder`.
function columns(order: EventTableOrder | undefined, onOrder: ((order: EventTableOrder) => void) | undefined): readonly TableColumn[] {
	const sortable = order !== undefined && onOrder !== undefined
	const when = sortable ? (
		<SortHeader direction={order === 'time' ? 'up' : undefined} title="Orders the events by their start" onClick={() => onOrder('time')}>
			When
		</SortHeader>
	) : (
		'When'
	)
	const rank = sortable ? (
		<SortHeader direction={order === 'rank' ? 'up' : undefined} title="Orders the watchable events from the best, by their longest watchable part, then the others by time" onClick={() => onOrder('rank')}>
			Rank
		</SortHeader>
	) : (
		'Rank'
	)
	return [{ key: 'when', label: when }, 'Event', { key: 'maximum', label: 'Maximum', className: NARROW_HIDDEN }, 'From the site', { key: 'rank', label: rank, numeric: true }]
}

export interface EventTableProps<E extends PlanetEventRow> {
	// Events listed, in the order the planner chose.
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
	// Heading of the group an event belongs to, such as its night; a group row starts wherever it changes. Absent for no
	// groups.
	readonly group?: (event: E) => string
	// Current order, shown on the When and Rank headers; with onOrder, those headers change it.
	readonly order?: EventTableOrder
	// Receives the order chosen on a header.
	readonly onOrder?: (order: EventTableOrder) => void
	// Classes of the table's scrolling frame, such as a largest height.
	readonly className?: string
}

// Table of the events.
export function EventTable<E extends PlanetEventRow>({ events, selected, timeZone, name, definition, status, onSelect, group, order, onOrder, className }: EventTableProps<E>) {
	return (
		<Table columns={columns(order, onOrder)} className={className}>
			{events.map((event, i) => (
				<Fragment key={event.id}>
					{group && (i === 0 || group(events[i - 1]) !== group(event)) && <GroupRow span={COLUMN_COUNT}>{group(event)}</GroupRow>}
					<EventRow event={event} selected={event.id === selected} timeZone={timeZone} name={name} definition={definition} status={status} onSelect={onSelect} />
				</Fragment>
			))}
		</Table>
	)
}

interface EventRowProps<E extends PlanetEventRow> extends Pick<EventTableProps<E>, 'timeZone' | 'name' | 'definition' | 'status' | 'onSelect'> {
	readonly event: E
	readonly selected: boolean
}

// Row of one event.
function EventRow<E extends PlanetEventRow>({ event, selected, timeZone, name, definition, status, onSelect }: EventRowProps<E>) {
	return (
		<Row selected={selected} onSelect={() => onSelect(event)} title={definition(event)}>
			<Cell>
				{formatDateTime(event.start, timeZone, false)}
				{event.end > event.start && `–${formatClockTime(event.end, timeZone)}`}
				{(event.startsBeforeRange || event.endsAfterRange) && <span className="text-ink-300"> (beyond the period)</span>}
			</Cell>
			<Cell>
				{name(event)}
				{event.overlaps.length > 0 && (
					<span className="text-ink-300" title={`Happens at the same time as ${event.overlaps.length} other event${event.overlaps.length === 1 ? '' : 's'} of the period; the inspector names them`}>
						{' '}
						· overlaps {event.overlaps.length}
					</span>
				)}
				{event.grazing && <span className="text-ink-300"> · grazing</span>}
			</Cell>
			<Cell className={NARROW_HIDDEN}>{formatClockTime(event.maximum, timeZone)}</Cell>
			<Cell>
				<StatusBadge {...status(event)} />
			</Cell>
			<Cell numeric>{event.visibility.rank ?? ''}</Cell>
		</Row>
	)
}

export interface ContactRowsProps {
	readonly event: PlanetEventRow
	// IANA zone the times are shown in.
	readonly timeZone: string
}

// Rows of an event's reached contacts and maximum, in the display zone, with the impact parameter of a mutual
// event.
export function ContactRows({ event, timeZone }: ContactRowsProps) {
	const contacts = CONTACT_ORDER.filter((key) => event.contacts[key] !== undefined)

	return (
		<>
			{contacts.map((key) => (
				<DataRow key={key} label={CONTACT_LABELS[key]}>
					{formatLongDateTime(event.contacts[key]!, timeZone)}
				</DataRow>
			))}
			<DataRow label="Maximum">{formatLongDateTime(event.maximum, timeZone)}</DataRow>
			{event.impactParameter !== undefined && <DataRow label="Impact parameter (0 central, 1 grazing)">{formatFixed(event.impactParameter, 3)}</DataRow>}
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
			{visibility.eveningDate && <DataRow label="Night of">{formatCivilDate(visibility.eveningDate)}</DataRow>}
			{visibility.longestMs > 0 && <DataRow label="Longest watchable part">{formatHours(visibility.longestMs)}</DataRow>}
			{visibility.peakAltitude !== undefined && <DataRow label={`${planet}'s highest altitude`}>{formatDegrees(visibility.peakAltitude, 1)}</DataRow>}
			{visibility.peakAirmass !== undefined && <DataRow label="Airmass there">{formatFixed(visibility.peakAirmass, 2)}</DataRow>}
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
