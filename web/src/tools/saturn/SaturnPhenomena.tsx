import type { SaturnEvent, SaturnEvents } from 'api'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { StatusBadge } from '../../ui/StatusBadge'
import { ContactRows, EventTable, type EventTableOrder, VisibilityRows } from '../planetary/EventTable'
import { describeSource, EVENT_VISIBILITY_LABELS, KIND_DEFINITIONS, phenomenonName, phenomenonNight, REASON_LABELS } from './saturn'

// Phenomena of the period: a table of the transits, shadow transits, occultations, eclipses and mutual events, when they
// happen, and whether the site can watch them, headed by night while it reads chronologically and orderable by the
// server's rank, and the inspector of the selected one, named and with its status at the top, then its reached contacts
// in the display zone and in UTC, its definition, what overlaps it, whether the rings may hide it, and where its numbers
// came from. Every contact is the server's; the rings are geometric only, never an exact occultation.

export interface PhenomenaTableProps {
	// Phenomena listed, in the order chosen.
	readonly events: readonly SaturnEvent[]
	// Id of the selected phenomenon.
	readonly selected?: string
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Order of the list; the nights head it only in time order.
	readonly order: EventTableOrder
	// Receives the order chosen on a header.
	readonly onOrder: (order: EventTableOrder) => void
	// Receives the phenomenon chosen.
	readonly onSelect: (event: SaturnEvent) => void
	// Classes of the table's scrolling frame.
	readonly className?: string
}

// Table of the phenomena.
export function PhenomenaTable({ events, selected, timeZone, order, onOrder, onSelect, className }: PhenomenaTableProps) {
	return (
		<EventTable
			events={events}
			selected={selected}
			timeZone={timeZone}
			name={phenomenonName}
			definition={(event) => KIND_DEFINITIONS[event.kind]}
			status={(event) => EVENT_VISIBILITY_LABELS[event.visibility.status]}
			onSelect={onSelect}
			group={order === 'time' ? (event) => `Night of ${phenomenonNight(event, timeZone)}` : undefined}
			order={order}
			onOrder={onOrder}
			className={className}
		/>
	)
}

export interface PhenomenonInspectorProps {
	readonly event: SaturnEvent
	// Every phenomenon of the answer, to name the overlapping ones.
	readonly all: readonly SaturnEvent[]
	readonly answer: SaturnEvents
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Brings the viewer, which shows the phenomenon at its maximum, into sight.
	readonly onShowViewer: () => void
}

// Inspector of the selected phenomenon.
export function PhenomenonInspector({ event, all, answer, timeZone, onShowViewer }: PhenomenonInspectorProps) {
	const overlapping = all.filter((e) => event.overlaps.includes(e.id))
	const status = EVENT_VISIBILITY_LABELS[event.visibility.status]

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-2">
				<h3 className="m-0 text-sm font-semibold text-ink-100">{phenomenonName(event)}</h3>
				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge {...status} />
					<Button variant="secondary" className="ml-auto" title="Scrolls to the viewer, which shows the phenomenon at its maximum with its moons ringed" onClick={onShowViewer}>
						Show in Viewer
					</Button>
				</div>
				<p className="m-0 text-sm text-ink-200">{KIND_DEFINITIONS[event.kind]}</p>
			</div>
			<DataList>
				<ContactRows event={event} timeZone={timeZone} />
				{event.startsBeforeRange && <DataRow label="Starts">Before the period</DataRow>}
				{event.endsAfterRange && <DataRow label="Ends">After the period</DataRow>}
				{event.ringInterference && <DataRow label="Rings">A moon or the shadow lies behind the projected rings for part of it; how much they hide is not predicted.</DataRow>}
				<VisibilityRows visibility={event.visibility} status={status.label} planet="Saturn" reason={(reason) => REASON_LABELS[reason]} timeZone={timeZone} />
				{overlapping.length > 0 && (
					<DataRow label="Overlaps">
						<span className="whitespace-pre-line">{overlapping.map(phenomenonName).join('\n')}</span>
					</DataRow>
				)}
				<DataRow label="Ephemeris">{describeSource(answer.signature)}</DataRow>
			</DataList>
		</div>
	)
}
