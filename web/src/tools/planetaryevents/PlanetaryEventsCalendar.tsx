import type { PlanetaryEvent } from 'api'
import { cn } from 'cn'
import { formatDate } from '../../format'
import { Button } from '../../ui/Button'
import { calendarWeeks, shiftMonth } from './planetaryevents'
import { BODY_LABELS, eventTitle } from './planetaryevents.format'

// Month view of the events of the range: a Monday-first grid of the civil dates of the display zone, each with its
// events from the same answer as the list, so no instant is computed here. A month outside the range shows no event.

// Names of the weekdays, Monday first.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Name of a month, YYYY-MM, such as "February 2027".
function monthName(month: string) {
	const [year, value] = month.split('-').map(Number)
	return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(year, value - 1, 1))
}

// Calendar of a month.
export function PlanetaryEventsCalendar({
	month,
	events,
	selected,
	timeZone,
	first,
	last,
	onMonth,
	onSelect,
}: {
	readonly month: string
	readonly events: readonly PlanetaryEvent[]
	readonly selected?: string
	readonly timeZone: string
	readonly first: string
	readonly last: string
	readonly onMonth: (month: string) => void
	readonly onSelect: (id: string) => void
}) {
	const weeks = calendarWeeks(month, events, timeZone)
	const now = formatDate(Date.now(), timeZone)

	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<Button variant="secondary" disabled={month <= first} onClick={() => onMonth(shiftMonth(month, -1))}>
					Previous
				</Button>
				<h3 className="m-0 flex-1 text-center text-sm font-semibold text-ink-100">{monthName(month)}</h3>
				<Button variant="secondary" disabled={month >= last} onClick={() => onMonth(shiftMonth(month, 1))}>
					Next
				</Button>
			</div>
			<div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-line-100 bg-line-100 text-xs">
				{WEEKDAYS.map((day) => (
					<div key={day} className="bg-base-100 px-1 py-1 text-center font-medium text-ink-300">
						{day}
					</div>
				))}
				{weeks.flat().map((day) => (
					<div key={day.date} className={cn('flex min-h-16 min-w-0 flex-col gap-0.5 bg-base-000 p-1', !day.inMonth && 'bg-base-100 text-ink-300', day.date === now && 'bg-green-950')}>
						<div className="flex items-center justify-between">
							<span className={cn('tabular-nums', day.inMonth ? 'text-ink-200' : 'text-ink-300')}>{day.day}</span>
							{day.events.length > 0 && <span className="rounded-full bg-accent-subtle px-1.5 text-accent tabular-nums">{day.events.length}</span>}
						</div>
						{day.inMonth &&
							day.events.map((event) => (
								<button
									key={event.id}
									type="button"
									title={`${eventTitle(event)}: ${event.bodies.map((code) => BODY_LABELS[code]).join(' and ')}`}
									onClick={() => onSelect(event.id)}
									className={cn('cursor-pointer truncate rounded-sm px-1 text-left text-ink-100 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-accent', event.id === selected && 'bg-accent-subtle text-accent')}
								>
									{event.bodies.map((code) => BODY_LABELS[code]).join('–')} · {eventTitle(event)}
								</button>
							))}
					</div>
				))}
			</div>
		</section>
	)
}
