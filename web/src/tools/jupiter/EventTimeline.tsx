import type { JupiterEvent, JupiterEvents } from 'api'
import { formatDegrees, formatFixed, formatLongDateTime } from '../../format'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { StatusBadge } from '../../ui/StatusBadge'
import { ContactRows, EventTable, type EventTableOrder, VisibilityRows } from '../planetary/EventTable'
import { VISIBILITY_LABELS } from '../planetary/planetary'
import { describeSource, eventNight, KIND_DEFINITIONS, KIND_LABELS, MOON_LABELS, REASON_LABELS } from './jupiter'

// Events of the period: a table of what happens, when, and whether the site can watch it, headed by night while it
// reads chronologically, and the inspector of the selected event, named and with its status at the top, then its
// contacts in the display zone and in UTC, its definition, what overlaps it, and where its numbers came from. The table
// and the contact and visibility rows are the shared planetary ones; Great Red Spot transits show their viewing window
// instead of contacts. Every contact is the server's; a contact is listed only when it was reached.

// Name of an event: its kind and the moons taking part.
export function eventName(event: Pick<JupiterEvent, 'kind' | 'moons'>) {
	if (event.kind === 'grsTransit') return KIND_LABELS.grsTransit
	if (event.moons.length === 2) return `${KIND_LABELS[event.kind]}: ${MOON_LABELS[event.moons[0]]} ${event.kind === 'mutualOccultation' ? 'in front of' : 'shadowing'} ${MOON_LABELS[event.moons[1]]}`
	return `${MOON_LABELS[event.moons[0]]} ${KIND_LABELS[event.kind].toLowerCase()}`
}

export interface EventTimelineProps {
	// Events listed, in the order chosen.
	readonly events: readonly JupiterEvent[]
	// Id of the selected event.
	readonly selected?: string
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Order of the list; the nights head it only in time order.
	readonly order: EventTableOrder
	// Receives the order chosen on a header.
	readonly onOrder: (order: EventTableOrder) => void
	// Receives the event chosen.
	readonly onSelect: (event: JupiterEvent) => void
	// Classes of the table's scrolling frame.
	readonly className?: string
}

// Table of the events.
export function EventTimeline({ events, selected, timeZone, order, onOrder, onSelect, className }: EventTimelineProps) {
	return (
		<EventTable
			events={events}
			selected={selected}
			timeZone={timeZone}
			name={eventName}
			definition={(event) => KIND_DEFINITIONS[event.kind]}
			status={(event) => VISIBILITY_LABELS[event.visibility.status]}
			onSelect={onSelect}
			group={order === 'time' ? (event) => `Night of ${eventNight(event, timeZone)}` : undefined}
			order={order}
			onOrder={onOrder}
			className={className}
		/>
	)
}

export interface EventInspectorProps {
	readonly event: JupiterEvent
	// Every event of the answer, to name the overlapping ones.
	readonly all: readonly JupiterEvent[]
	readonly answer: JupiterEvents
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Brings the viewer, which shows the event at its maximum, into sight.
	readonly onShowViewer: () => void
}

// Inspector of the selected event.
export function EventInspector({ event, all, answer, timeZone, onShowViewer }: EventInspectorProps) {
	const overlapping = all.filter((e) => event.overlaps.includes(e.id))
	const status = VISIBILITY_LABELS[event.visibility.status]

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-2">
				<h3 className="m-0 text-sm font-semibold text-ink-100">{eventName(event)}</h3>
				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge {...status} />
					<Button variant="secondary" className="ml-auto" title="Scrolls to the viewer, which shows the event at its maximum with its moons ringed" onClick={onShowViewer}>
						Show in Viewer
					</Button>
				</div>
				<p className="m-0 text-sm text-ink-200">{KIND_DEFINITIONS[event.kind]}</p>
			</div>
			<DataList>
				{event.kind === 'grsTransit' ? (
					<>
						<DataRow label="Viewing window starts">{formatLongDateTime(event.start, timeZone)}</DataRow>
						<DataRow label="On the central meridian">{formatLongDateTime(event.maximum, timeZone)}</DataRow>
						<DataRow label="Viewing window ends">{formatLongDateTime(event.end, timeZone)}</DataRow>
						{event.grs && <DataRow label="Spot longitude (System II)">{formatDegrees(event.grs.longitude, 1)}</DataRow>}
						{event.grs && <DataRow label="Model reference age">{`${formatFixed(event.grs.referenceAgeDays, 1)} days`}</DataRow>}
					</>
				) : (
					<ContactRows event={event} timeZone={timeZone} />
				)}
				{event.startsBeforeRange && <DataRow label="Starts">Before the period</DataRow>}
				{event.endsAfterRange && <DataRow label="Ends">After the period</DataRow>}
				<VisibilityRows visibility={event.visibility} status={status.label} planet="Jupiter" reason={(reason) => REASON_LABELS[reason]} timeZone={timeZone} />
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
