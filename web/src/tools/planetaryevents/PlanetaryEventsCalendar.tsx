import type { PlanetaryEvent } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, useState } from 'react'
import { formatClockTime, formatDate } from '../../format'
import { Button } from '../../ui/Button'
import { moveIndex } from '../../ui/navigation'
import { StatusBadge } from '../../ui/StatusBadge'
import { calendarWeeks, type SiteVisibility, shiftMonth, visibilityStatus } from './planetaryevents'
import { BODY_LABELS, eventName, SHORT_KIND_LABELS, STATUS_LABELS, STATUS_TONES, statusTitle } from './planetaryevents.format'

// Month view of the events of the range: a Monday-first grid of the civil dates of the display zone, each with its
// events from the same answer as the list, so no instant is computed here. A month outside the range shows no event.
// It fits the width of its container (`@container/list`): from 48 rem each day lists its events by kind and planets,
// those that cannot be watched from the site muted; below it a day is one button with a dot per event (filled when
// observable, hollow when not) and the events of the day chosen are listed under the grid with their visibility in words.
// Today is outlined and named. The arrow keys, Home, and End move between the buttons of the grid.

// Names of the weekdays, Monday first.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Most dots a day shows below 48 rem; the count says the rest.
const MAX_DOTS = 3

// Name of a month, YYYY-MM, such as "February 2027".
function monthName(month: string) {
	const [year, value] = month.split('-').map(Number)
	return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(year, value - 1, 1))
}

// Short name of an event in a day of the grid, kind first so a cut name keeps it: "Opposition · Mars".
function chipName(event: PlanetaryEvent) {
	return `${SHORT_KIND_LABELS[event.kind]} · ${event.bodies.map((code) => BODY_LABELS[code]).join('–')}`
}

// Moves the focus between the visible buttons of the grid on an arrow key, Home, or End.
function navigate(event: KeyboardEvent<HTMLDivElement>) {
	const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.offsetParent !== null)
	const next = moveIndex(buttons.indexOf(event.target as HTMLButtonElement), buttons.length, event.key)
	if (next === undefined) return
	event.preventDefault()
	buttons[next].focus()
}

// Calendar of a month.
export function PlanetaryEventsCalendar({
	month,
	events,
	visibility,
	hasSite,
	selected,
	timeZone,
	first,
	last,
	onMonth,
	onSelect,
}: {
	readonly month: string
	readonly events: readonly PlanetaryEvent[]
	readonly visibility?: SiteVisibility
	readonly hasSite: boolean
	readonly selected?: string
	readonly timeZone: string
	readonly first: string
	readonly last: string
	readonly onMonth: (month: string) => void
	readonly onSelect: (id: string) => void
}) {
	const weeks = calendarWeeks(month, events, timeZone)
	const days = weeks.flat().filter((day) => day.inMonth)
	const now = formatDate(Date.now(), timeZone)
	const [chosen, setChosen] = useState<string>()
	const selectedEvent = events.find((e) => e.id === selected)
	// The day listed under a narrow grid: the one chosen, else the selected event's, else today, else the first with events.
	const listed = days.find((day) => day.date === chosen) ?? days.find((day) => selectedEvent && day.date === formatDate(selectedEvent.time, timeZone)) ?? days.find((day) => day.date === now) ?? days.find((day) => day.events.length > 0)
	// Whether an event cannot be watched from the site; without a site none is muted.
	const muted = (event: PlanetaryEvent) => hasSite && ['notObservable', 'notSuitable'].includes(visibilityStatus(visibility, event.id))

	const change = (value: string) => {
		setChosen(undefined)
		onMonth(value)
	}

	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<Button variant="secondary" disabled={month <= first} title={month <= first ? 'The range starts in this month' : undefined} onClick={() => change(shiftMonth(month, -1))}>
					Previous
				</Button>
				<h2 className="m-0 flex-1 text-center text-sm font-semibold text-ink-100">{monthName(month)}</h2>
				<Button variant="secondary" disabled={month >= last} title={month >= last ? 'The range ends in this month' : undefined} onClick={() => change(shiftMonth(month, 1))}>
					Next
				</Button>
			</div>
			<div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-line-100 bg-line-100 text-sm" onKeyDown={navigate}>
				{WEEKDAYS.map((day) => (
					<div key={day} className="bg-base-100 px-1 py-1 text-center text-xs font-medium tracking-[0.08em] text-ink-300 uppercase">
						{day}
					</div>
				))}
				{weeks.flat().map((day) => {
					const today = day.date === now
					const number = <span className={cn('rounded-sm px-0.5 tabular-nums', day.inMonth ? 'text-ink-200' : 'text-ink-300', today && 'text-ink-100 outline-1 outline-ink-200')}>{day.day}</span>
					const count = day.inMonth && day.events.length > 0 && <span className="text-xs text-ink-300 tabular-nums">{day.events.length}</span>

					return (
						<div key={day.date} className={cn('flex min-h-16 min-w-0 flex-col bg-base-000', !day.inMonth && 'bg-base-100')}>
							<div className="hidden min-w-0 flex-1 flex-col gap-0.5 p-1 @3xl/list:flex">
								<div className="flex items-center justify-between gap-1">
									<span className="flex items-center gap-1.5">
										{number}
										{today && <span className="text-xs text-ink-300">Today</span>}
									</span>
									{count}
								</div>
								{day.inMonth &&
									day.events.map((event) => (
										<button
											key={event.id}
											type="button"
											title={`${eventName(event)}, ${formatClockTime(event.time, timeZone)}${hasSite ? `: ${STATUS_LABELS[visibilityStatus(visibility, event.id)]}` : ''}`}
											onClick={() => onSelect(event.id)}
											className={cn(
												'line-clamp-4 min-h-6 cursor-pointer rounded-sm px-1 text-left text-xs leading-4 wrap-break-word hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-accent',
												muted(event) ? 'text-ink-300' : 'text-ink-100',
												event.id === selected && 'bg-accent-subtle text-accent hover:bg-accent-subtle',
											)}
										>
											{chipName(event)}
										</button>
									))}
							</div>
							<button
								type="button"
								disabled={!day.inMonth}
								title={today ? 'Today' : undefined}
								onClick={() => setChosen(day.date)}
								className={cn('flex min-h-14 flex-1 cursor-pointer flex-col items-center gap-1 p-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default @3xl/list:hidden', day.inMonth && day.date === listed?.date && 'bg-base-300')}
							>
								{number}
								{day.inMonth && day.events.length > 0 && (
									<span className="flex items-center gap-0.5">
										{day.events.slice(0, MAX_DOTS).map((event) => (
											<span key={event.id} className={cn('size-1.5 rounded-full', muted(event) ? 'border border-ink-300' : 'bg-ink-200')} />
										))}
										{day.events.length > MAX_DOTS && <span className="text-xs leading-none text-ink-300">+{day.events.length - MAX_DOTS}</span>}
									</span>
								)}
							</button>
						</div>
					)
				})}
			</div>
			{listed && (
				<div className="flex flex-col gap-1 @3xl/list:hidden">
					<h3 className="m-0 text-sm font-semibold text-ink-100">
						{listed.date}
						{listed.date === now && <span className="font-normal text-ink-300"> · Today</span>}
					</h3>
					{listed.events.length === 0 && <p className="m-0 text-sm text-ink-300">No event on this day.</p>}
					{listed.events.map((event) => {
						const status = visibilityStatus(visibility, event.id)
						return (
							<button
								key={event.id}
								type="button"
								onClick={() => onSelect(event.id)}
								className={cn(
									'flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-md border border-line-100 px-2 py-1.5 text-left text-sm text-ink-200 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
									event.id === selected && 'border-accent bg-accent-subtle hover:bg-accent-subtle',
								)}
							>
								<span>
									<span className="text-ink-300 tabular-nums">{formatClockTime(event.time, timeZone)}</span> <span className="text-ink-100">{eventName(event)}</span>
								</span>
								{status !== 'unknownNoSite' && <StatusBadge tone={STATUS_TONES[status]} label={STATUS_LABELS[status]} title={statusTitle(status, event.bodies.length > 1)} />}
							</button>
						)
					})}
				</div>
			)}
		</section>
	)
}
