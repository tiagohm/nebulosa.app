import type { SaturnEvent, SaturnEvents } from 'api'
import { DataList, DataRow } from '../../ui/DataRow'
import { ContactRows, EventTable, VisibilityRows } from '../planetary/EventTable'
import { describeSource, EVENT_VISIBILITY_LABELS, KIND_DEFINITIONS, phenomenonName, REASON_LABELS } from './saturn'

// Phenomena of the period: a chronological table of the transits, shadow transits, occultations, eclipses and mutual
// events, when they happen, and whether the site can watch them, and the inspector of the selected one with its reached
// contacts in the display zone and in UTC, its definition, what overlaps it, whether the rings may hide it, and where its
// numbers came from. Every contact is the server's; the rings are geometric only, never an exact occultation.

export interface PhenomenaTableProps {
	// Phenomena listed, chronologically.
	readonly events: readonly SaturnEvent[]
	// Id of the selected phenomenon.
	readonly selected?: string
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Receives the phenomenon chosen.
	readonly onSelect: (event: SaturnEvent) => void
}

// Chronological table of the phenomena.
export function PhenomenaTable({ events, selected, timeZone, onSelect }: PhenomenaTableProps) {
	return <EventTable events={events} selected={selected} timeZone={timeZone} name={phenomenonName} definition={(event) => KIND_DEFINITIONS[event.kind]} status={(event) => EVENT_VISIBILITY_LABELS[event.visibility.status]} onSelect={onSelect} />
}

export interface PhenomenonInspectorProps {
	readonly event: SaturnEvent
	// Every phenomenon of the answer, to name the overlapping ones.
	readonly all: readonly SaturnEvent[]
	readonly answer: SaturnEvents
	// IANA zone the times are shown in.
	readonly timeZone: string
}

// Inspector of the selected phenomenon.
export function PhenomenonInspector({ event, all, answer, timeZone }: PhenomenonInspectorProps) {
	const overlapping = all.filter((e) => event.overlaps.includes(e.id))

	return (
		<div className="flex flex-col gap-3">
			<p className="m-0 text-sm text-ink-200">{KIND_DEFINITIONS[event.kind]}</p>
			<DataList>
				<ContactRows event={event} timeZone={timeZone} />
				{event.startsBeforeRange && <DataRow label="Starts">Before the period</DataRow>}
				{event.endsAfterRange && <DataRow label="Ends">After the period</DataRow>}
				{event.ringInterference && <DataRow label="Rings">A moon or the shadow lies behind the projected rings for part of it; how much they hide is not predicted.</DataRow>}
				<VisibilityRows visibility={event.visibility} status={EVENT_VISIBILITY_LABELS[event.visibility.status].label} planet="Saturn" reason={(reason) => REASON_LABELS[reason]} timeZone={timeZone} />
				{overlapping.map((other) => (
					<DataRow key={other.id} label="Overlaps">
						{phenomenonName(other)}
					</DataRow>
				))}
				<DataRow label="Ephemeris">{describeSource(answer.signature)}</DataRow>
			</DataList>
		</div>
	)
}
