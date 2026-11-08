import type { PlanetaryEvent } from 'api'
import { formatClockTime } from '../../format'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { groupByDay, type SiteVisibility, visibilityStatus } from './planetaryevents'
import { bodiesLabel, eventTitle, primaryValue, STATUS_LABELS, STATUS_TONES } from './planetaryevents.format'

// Chronological list of the events, grouped by the civil date of their instant in the display zone: the date heads the
// first event of each day, and the instants, never the dates, decide the order.

// Columns of the list.
const COLUMNS = ['Date', 'Time', 'Event', 'Planets', 'Value', 'Visibility']

// List of the events.
export function PlanetaryEventsTimeline({ events, visibility, selected, timeZone, onSelect }: { readonly events: readonly PlanetaryEvent[]; readonly visibility?: SiteVisibility; readonly selected?: string; readonly timeZone: string; readonly onSelect: (id: string) => void }) {
	return (
		<Table columns={COLUMNS} className="max-h-[37vh]">
			{groupByDay(events, timeZone).flatMap(({ date, events: day }) =>
				day.map((event, i) => {
					const status = visibilityStatus(visibility, event.id)
					return (
						<Row key={event.id} selected={event.id === selected} onSelect={() => onSelect(event.id)}>
							<Cell className="whitespace-nowrap">{i === 0 ? date : ''}</Cell>
							<Cell numeric>{formatClockTime(event.time, timeZone)}</Cell>
							<Cell>{eventTitle(event)}</Cell>
							<Cell>{bodiesLabel(event)}</Cell>
							<Cell>{primaryValue(event)}</Cell>
							<Cell>{status === 'unknownNoSite' ? '' : <StatusBadge tone={STATUS_TONES[status]} label={STATUS_LABELS[status]} />}</Cell>
						</Row>
					)
				}),
			)}
		</Table>
	)
}
