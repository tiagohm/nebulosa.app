import { formatDateTime, formatDegrees, formatUtcDateTime } from '../../format'
import { Cell, Row, Table } from '../../ui/Table'
import { listedId, MOON_LABELS, RING_EVENT_DEFINITIONS, RING_EVENT_LABELS, type SaturnListedEvent } from './saturn'

// Events of the period: the ring-plane events found by search and the greatest separations of the moons drawn, with
// their instant in the display zone and in UTC and the value at that instant. A greatest separation is a true maximum of
// the moon's distance from Saturn, not an east-west elongation; a slow moon such as Iapetus may have none in a short
// period. Choosing an event moves only the tool's clock.

// Columns of the table.
const COLUMNS = ['When', 'Event', 'Value', 'UTC'] as const

// Arcseconds per radian.
const ARCSEC = (180 / Math.PI) * 3600

// Degrees per radian.
const DEGREES = 180 / Math.PI

// Name of a listed event.
export function listedName(event: SaturnListedEvent) {
	return event.type === 'ring' ? RING_EVENT_LABELS[event.kind] : `${MOON_LABELS[event.moon]} at greatest separation`
}

// Value of a listed event: the openings of a ring-plane event, the separation and position angle of a maximum.
function listedValue(event: SaturnListedEvent) {
	if (event.type === 'ring') return `B ${(event.earthOpening * DEGREES).toFixed(2)}° · B′ ${(event.solarOpening * DEGREES).toFixed(2)}°`
	return `${(event.separation * ARCSEC).toFixed(1)}″ at PA ${formatDegrees(((event.positionAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), 1)}`
}

export interface SaturnEventListProps {
	readonly events: readonly SaturnListedEvent[]
	// Id of the selected event.
	readonly selected?: string
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Receives the event chosen.
	readonly onSelect: (event: SaturnListedEvent) => void
}

// Chronological table of the events of the period.
export function SaturnEventList({ events, selected, timeZone, onSelect }: SaturnEventListProps) {
	return (
		<Table columns={COLUMNS}>
			{events.map((event) => (
				<Row key={listedId(event)} selected={listedId(event) === selected} onSelect={() => onSelect(event)} title={event.type === 'ring' ? RING_EVENT_DEFINITIONS[event.kind] : 'A local maximum of the apparent distance of the moon from the centre of Saturn.'}>
					<Cell>{formatDateTime(event.time, timeZone, false)}</Cell>
					<Cell>{listedName(event)}</Cell>
					<Cell>{listedValue(event)}</Cell>
					<Cell>{formatUtcDateTime(event.time)}</Cell>
				</Row>
			))}
		</Table>
	)
}
