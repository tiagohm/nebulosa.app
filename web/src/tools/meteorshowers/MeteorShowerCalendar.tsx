import type { MeteorShowersCalendar, MeteorShowersCalendarEntry } from 'api'
import { cn } from 'cn'
import type { KeyboardEvent } from 'react'
import { formatDate } from '../../format'
import { Button } from '../../ui/Button'
import { moveIndex } from '../../ui/navigation'
import { Notice } from '../../ui/Notice'
import { occurrenceInstant } from './meteorshowers.format'

// Month view of the showers: a Monday-first grid of the civil dates of the display zone, each listing the showers whose
// maximum (the published visual one, else the IAU mean reference, marked) falls on it and counting those active. The
// occurrences come from the server's calendar of the month; nothing is computed here but the grouping by date. Today is
// outlined and named, the count of active showers is a muted number, and a year-specific event is a drawn mark beside its
// shower's code. The arrow keys, Home, and End move between the buttons of the grid.

// Names of the weekdays, Monday first.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Moves the focus between the buttons of the grid on an arrow key, Home, or End.
function navigate(event: KeyboardEvent<HTMLDivElement>) {
	const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
	const next = moveIndex(buttons.indexOf(event.target as HTMLButtonElement), buttons.length, event.key)
	if (next === undefined) return
	event.preventDefault()
	buttons[next].focus()
}

// Mark of a year-specific event: a small downward triangle in Starlight Cream, the mark of the activity chart.
function EventMark() {
	return (
		<svg width={8} height={7} className="mr-1 inline-block flex-none align-baseline">
			<path d="M0,0 L8,0 L4,7 Z" fill="var(--color-ink-100)" />
		</svg>
	)
}

// Name of a month, YYYY-MM, such as "December 2026".
function monthName(month: string) {
	const [year, value] = month.split('-').map(Number)
	return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(year, value - 1, 1))
}

// Month, YYYY-MM, `delta` months after `month`.
export function shiftMonth(month: string, delta: number) {
	const [year, value] = month.split('-').map(Number)
	const date = new Date(Date.UTC(year, value - 1 + delta, 1))
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

// A day of the grid.
export interface MeteorCalendarDay {
	// Civil date, YYYY-MM-DD.
	readonly date: string
	// Day of the month.
	readonly day: number
	// Whether it belongs to the month shown.
	readonly inMonth: boolean
	// Showers whose maximum falls on it.
	readonly peaks: readonly MeteorShowersCalendarEntry[]
	// Showers active during some part of it.
	readonly active: number
	// Year-specific events whose instant falls on it.
	readonly events: MeteorShowersCalendar['annualEvents']
}

// Weeks of a month, Monday first, with the maxima and the active showers of each civil date of the zone. A date is active
// for a shower when its period (visual, else IAU) holds the date's noon UTC, a count good to a day.
export function meteorCalendarWeeks(month: string, entries: readonly MeteorShowersCalendarEntry[], timeZone: string, annualEvents: MeteorShowersCalendar['annualEvents'] = []): MeteorCalendarDay[][] {
	const [year, value] = month.split('-').map(Number)
	const peaks = new Map<string, MeteorShowersCalendarEntry[]>()

	for (const entry of entries) {
		const instant = occurrenceInstant(entry.occurrence)
		if (instant === undefined) continue
		const date = formatDate(instant, timeZone)
		peaks.set(date, [...(peaks.get(date) ?? []), entry])
	}

	const events = new Map<string, MeteorShowersCalendar['annualEvents'][number][]>()
	for (const event of annualEvents) {
		const date = formatDate(event.time, timeZone)
		events.set(date, [...(events.get(date) ?? []), event])
	}

	const first = new Date(Date.UTC(year, value - 1, 1))
	const offset = (first.getUTCDay() + 6) % 7
	const days = new Date(Date.UTC(year, value, 0)).getUTCDate()
	const weeks: MeteorCalendarDay[][] = []

	for (let index = -offset; index < days || (index + offset) % 7 !== 0; index++) {
		const date = new Date(Date.UTC(year, value - 1, 1 + index))
		const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
		const noon = date.getTime() + 12 * 3_600_000
		const active = entries.filter(({ occurrence }) => {
			const start = occurrence.visual?.start ?? occurrence.iau?.start
			const end = occurrence.visual?.end ?? occurrence.iau?.end
			return start !== undefined && end !== undefined && start <= noon && end >= noon
		}).length
		if ((index + offset) % 7 === 0) weeks.push([])
		weeks.at(-1)!.push({ date: iso, day: date.getUTCDate(), inMonth: index >= 0 && index < days, peaks: peaks.get(iso) ?? [], active, events: events.get(iso) ?? [] })
	}

	return weeks
}

// Calendar of a month.
export function MeteorShowerCalendar({
	month,
	entries,
	annualEvents,
	selected,
	timeZone,
	onMonth,
	onSelect,
}: {
	readonly month: string
	readonly entries: readonly MeteorShowersCalendarEntry[]
	readonly annualEvents: MeteorShowersCalendar['annualEvents']
	readonly selected?: string
	readonly timeZone: string
	readonly onMonth: (month: string) => void
	readonly onSelect: (id: string) => void
}) {
	const weeks = meteorCalendarWeeks(month, entries, timeZone, annualEvents)
	const codes = new Map(entries.map((entry) => [entry.id, entry.code ?? entry.name]))
	const today = formatDate(Date.now(), timeZone)

	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<Button variant="secondary" onClick={() => onMonth(shiftMonth(month, -1))}>
					Previous
				</Button>
				<h2 className="m-0 flex-1 text-center text-sm font-semibold text-ink-100">{monthName(month)}</h2>
				<Button variant="secondary" onClick={() => onMonth(shiftMonth(month, 1))}>
					Next
				</Button>
			</div>
			<div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-line-100 bg-line-100 text-xs" onKeyDown={navigate}>
				{WEEKDAYS.map((day) => (
					<div key={day} className="bg-base-100 px-1 py-1 text-center font-medium tracking-[0.08em] text-ink-300 uppercase">
						{day}
					</div>
				))}
				{weeks.flat().map((day) => (
					<div key={day.date} className={cn('flex min-h-16 min-w-0 flex-col gap-0.5 bg-base-000 p-1', !day.inMonth && 'bg-base-100 text-ink-300')}>
						<div className="flex items-center justify-between gap-1">
							<span className="flex min-w-0 items-center gap-1.5">
								<span className={cn('rounded-sm px-0.5 tabular-nums', day.inMonth ? 'text-ink-200' : 'text-ink-300', day.date === today && 'text-ink-100 outline-1 outline-ink-200')}>{day.day}</span>
								{day.date === today && <span className="truncate text-ink-300 max-sm:hidden">Today</span>}
							</span>
							{day.inMonth && day.active > 0 && (
								<span className="text-ink-300 tabular-nums" title={`${day.active} shower${day.active === 1 ? '' : 's'} active`}>
									{day.active}
								</span>
							)}
						</div>
						{day.inMonth &&
							day.peaks.map((entry) => (
								<button
									key={`${entry.id}-${occurrenceInstant(entry.occurrence)}`}
									type="button"
									title={entry.occurrence.visual ? `Published maximum of the ${entry.name}` : `IAU mean reference of the ${entry.name}, not a maximum`}
									onClick={() => onSelect(entry.id)}
									className={cn('cursor-pointer truncate rounded-sm px-1 text-left text-ink-100 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-accent', entry.id === selected && 'bg-accent-subtle text-accent', !entry.occurrence.visual && 'text-ink-300 italic')}
								>
									{entry.code ?? entry.name}
									{!entry.occurrence.visual && ' (ref.)'}
								</button>
							))}
						{day.inMonth &&
							day.events.map((event) => (
								<button
									key={event.id}
									type="button"
									title={`${event.attribution} (${event.confidence})`}
									onClick={() => onSelect(event.showerId)}
									className="flex cursor-pointer items-center truncate rounded-sm px-1 text-left text-ink-200 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-accent"
								>
									<EventMark />
									{codes.get(event.showerId) ?? event.showerId}
								</button>
							))}
					</div>
				))}
			</div>
			<Notice>A name marks the published maximum; "(ref.)" marks the IAU mean reference, which is not a maximum; a triangle marks a year-specific event of that year. The number in a corner counts the showers active that day.</Notice>
		</section>
	)
}
