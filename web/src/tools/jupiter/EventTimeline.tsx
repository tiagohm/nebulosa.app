import type { JupiterEvent, JupiterEvents } from 'api'
import { formatDegrees, formatLongDateTime } from '../../format'
import { DataList, DataRow } from '../../ui/DataRow'
import { ContactRows, EventTable, VisibilityRows } from '../planetary/EventTable'
import { VISIBILITY_LABELS } from '../planetary/planetary'
import { describeSource, KIND_DEFINITIONS, KIND_LABELS, MOON_LABELS, REASON_LABELS } from './jupiter'

// Events of the period: a chronological table of what happens, when, and whether the site can watch it, and the inspector
// of the selected event with its contacts in the display zone and in UTC, its definition, what overlaps it, and where its
// numbers came from. The table and the contact and visibility rows are the shared planetary ones; Great Red Spot transits
// show their viewing window instead of contacts. Every contact is the server's; a contact is listed only when it was reached.

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
	return <EventTable events={events} selected={selected} timeZone={timeZone} name={eventName} definition={(event) => KIND_DEFINITIONS[event.kind]} status={(event) => VISIBILITY_LABELS[event.visibility.status]} onSelect={onSelect} />
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
					<ContactRows event={event} timeZone={timeZone} />
				)}
				{event.startsBeforeRange && <DataRow label="Starts">Before the period</DataRow>}
				{event.endsAfterRange && <DataRow label="Ends">After the period</DataRow>}
				<VisibilityRows visibility={event.visibility} status={VISIBILITY_LABELS[event.visibility.status].label} planet="Jupiter" reason={(reason) => REASON_LABELS[reason]} timeZone={timeZone} />
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
