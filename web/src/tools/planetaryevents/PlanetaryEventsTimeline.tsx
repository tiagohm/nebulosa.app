import type { PlanetaryEvent } from 'api'
import { cn } from 'cn'
import { formatClockTime } from '../../format'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table, type TableColumn } from '../../ui/Table'
import { groupByDay, type SiteVisibility, visibilityStatus } from './planetaryevents'
import { bodiesLabel, eventTitle, primaryValue, STATUS_LABELS, STATUS_TONES, statusTitle } from './planetaryevents.format'

// Chronological list of the events, grouped by the civil date of their instant in the display zone: every row names its
// date, muted after the first of its day, and the instants, never the dates, decide the order. The planets lead the
// event's name and the visibility follows its time, so a narrow list keeps both; the list fits the width of its
// container (`@container/list`): below 32 rem the date sits above the time and the badge under the name, and the primary
// value shows from 48 rem.

// Classes of the columns shown only from 32 rem of the list.
const WIDE = 'hidden @lg/list:table-cell'

// Classes of the value column, shown only from 48 rem of the list.
const VALUE = 'hidden @3xl/list:table-cell'

// Columns of the list, with or without the visibility from a site.
function columns(hasSite: boolean): TableColumn[] {
	return [
		{ key: 'date', label: 'Date', className: WIDE },
		{
			key: 'time',
			label: (
				<>
					<span className="@lg/list:hidden">Date, </span>Time
				</>
			),
		},
		'Event',
		...(hasSite ? [{ key: 'visibility', label: 'Visibility', className: WIDE }] : []),
		{ key: 'value', label: 'Value', className: VALUE },
	]
}

// List of the events.
export function PlanetaryEventsTimeline({
	events,
	visibility,
	hasSite,
	selected,
	timeZone,
	className,
	onSelect,
}: {
	readonly events: readonly PlanetaryEvent[]
	readonly visibility?: SiteVisibility
	readonly hasSite: boolean
	readonly selected?: string
	readonly timeZone: string
	readonly className?: string
	readonly onSelect: (id: string) => void
}) {
	return (
		<Table columns={columns(hasSite)} className={className}>
			{groupByDay(events, timeZone).flatMap(({ date, events: day }) =>
				day.map((event, i) => {
					const status = visibilityStatus(visibility, event.id)
					const badge = status !== 'unknownNoSite' && <StatusBadge tone={STATUS_TONES[status]} label={STATUS_LABELS[status]} title={statusTitle(status, event.bodies.length > 1)} />
					const tone = i === 0 ? 'text-ink-200' : 'text-ink-300'
					return (
						<Row key={event.id} selected={event.id === selected} onSelect={() => onSelect(event.id)}>
							<Cell className={cn(WIDE, tone)}>{date}</Cell>
							<Cell className="align-top @lg/list:align-middle">
								<span className={cn('block @lg/list:hidden', tone)}>{date}</span>
								{formatClockTime(event.time, timeZone)}
							</Cell>
							<Cell className="min-w-40 whitespace-normal">
								<span className="text-ink-100">{bodiesLabel(event)}</span> · {eventTitle(event)}
								{badge && <span className="mt-1 flex @lg/list:hidden">{badge}</span>}
							</Cell>
							{hasSite && <Cell className={WIDE}>{badge}</Cell>}
							<Cell className={VALUE}>{primaryValue(event)}</Cell>
						</Row>
					)
				}),
			)}
		</Table>
	)
}
