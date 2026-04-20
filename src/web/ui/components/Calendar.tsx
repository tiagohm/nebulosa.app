import type * as React from 'react'
import { useEffect, useState } from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { tw } from '@/shared/util'
import { Icons } from '../Icon'

const calendarMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const calendarWeekdayNames = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

const calendarStyles = tv({
	slots: {
		base: 'inline-flex flex-col gap-3 rounded-lg bg-neutral-900/70 p-3 align-top select-none',
		header: 'flex items-center justify-between gap-2',
		navGroup: 'flex items-center gap-2',
		navButton: 'flex size-8 items-center justify-center rounded-md text-neutral-300 outline-none transition disabled:opacity-40 cursor-pointer',
		navIconGroup: 'flex items-center justify-center -space-x-1',
		title: 'min-w-0 flex-1 text-center text-sm font-medium text-neutral-100',
		weekdays: 'grid gap-1',
		weekday: 'flex size-9 items-center justify-center text-xs text-neutral-400',
		weeks: 'flex flex-col gap-1',
		week: 'grid gap-1',
		weekNumber: 'flex w-8 items-center justify-center text-xs text-neutral-500',
		day: 'flex size-9 items-center justify-center rounded-md text-sm outline-none transition disabled:opacity-50 cursor-pointer',
	},
	variants: {
		color: {
			primary: '[--color-variant:var(--primary)]',
			secondary: '[--color-variant:var(--secondary)]',
			success: '[--color-variant:var(--success)]',
			danger: '[--color-variant:var(--danger)]',
			warning: '[--color-variant:var(--warning)]',
		},
		showWeekNumber: {
			true: {
				weekdays: 'grid-cols-[2rem_repeat(7,minmax(0,1fr))]',
				week: 'grid-cols-[2rem_repeat(7,minmax(0,1fr))]',
			},
			false: {
				weekdays: 'grid-cols-7',
				week: 'grid-cols-7',
			},
		},
	},
	defaultVariants: {
		color: 'primary',
		showWeekNumber: false,
	},
})

type CalendarVariants = VariantProps<typeof calendarStyles>

export interface CalendarClassNames {
	readonly base?: ClassValue
	readonly header?: ClassValue
	readonly navGroup?: ClassValue
	readonly navButton?: ClassValue
	readonly navIconGroup?: ClassValue
	readonly title?: ClassValue
	readonly weekdays?: ClassValue
	readonly weekday?: ClassValue
	readonly weeks?: ClassValue
	readonly week?: ClassValue
	readonly weekNumber?: ClassValue
	readonly day?: ClassValue
}

export interface CalendarProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'color'>, CalendarVariants {
	readonly classNames?: CalendarClassNames
	readonly value?: Temporal.PlainDate
	readonly onValueChange?: (value: Temporal.PlainDate) => void
	readonly minDate?: Temporal.PlainDate
	readonly maxDate?: Temporal.PlainDate
	readonly disabled?: boolean
	readonly readOnly?: boolean
	readonly showWeekNumber?: boolean
}

// Compares two plain dates using the native Temporal ordering rules.
function compareDates(left: Temporal.PlainDate, right: Temporal.PlainDate) {
	return Temporal.PlainDate.compare(left, right)
}

// Normalizes the optional date bounds into ascending order.
function normalizeBounds(minDate?: Temporal.PlainDate, maxDate?: Temporal.PlainDate) {
	if (minDate && maxDate && compareDates(minDate, maxDate) > 0) {
		return [maxDate, minDate] as const
	}

	return [minDate, maxDate] as const
}

// Moves a date to the first day of its month.
function startOfMonth(date: Temporal.PlainDate) {
	return date.with({ day: 1 })
}

// Moves a date to the Monday that starts its visible calendar week.
function startOfWeek(date: Temporal.PlainDate) {
	return date.subtract({ days: date.dayOfWeek - 1 })
}

// Checks whether two plain dates point to the same calendar day.
function isSameDay(left?: Temporal.PlainDate, right?: Temporal.PlainDate) {
	return !!left && !!right && compareDates(left, right) === 0
}

// Checks whether two plain dates belong to the same visible month.
function isSameMonth(left: Temporal.PlainDate, right: Temporal.PlainDate) {
	return left.year === right.year && left.month === right.month
}

// Reads the current day from the native Temporal API.
function todayDate() {
	return Temporal.Now.plainDateISO()
}

// Clamps a date into the configured optional bounds.
function clampDate(date: Temporal.PlainDate, minDate?: Temporal.PlainDate, maxDate?: Temporal.PlainDate) {
	if (minDate && compareDates(date, minDate) < 0) return minDate
	if (maxDate && compareDates(date, maxDate) > 0) return maxDate
	return date
}

// Checks whether a specific day falls outside the allowed range.
function isDateUnavailable(date: Temporal.PlainDate, minDate?: Temporal.PlainDate, maxDate?: Temporal.PlainDate) {
	return !!((minDate && compareDates(date, minDate) < 0) || (maxDate && compareDates(date, maxDate) > 0))
}

// Checks whether a month has at least one visible selectable day inside the bounds.
function monthHasVisibleDays(month: Temporal.PlainDate, minDate?: Temporal.PlainDate, maxDate?: Temporal.PlainDate) {
	if (minDate === undefined && maxDate === undefined) return true
	const monthStart = startOfMonth(month)
	const monthEnd = monthStart.add({ months: 1 }).subtract({ days: 1 })
	return !((minDate && compareDates(monthEnd, minDate) < 0) || (maxDate && compareDates(monthStart, maxDate) > 0))
}

// Resolves the month that should be visible when the component renders or re-syncs.
function resolveVisibleMonth(value: Temporal.PlainDate | undefined, minDate?: Temporal.PlainDate, maxDate?: Temporal.PlainDate) {
	return startOfMonth(clampDate(value ?? todayDate(), minDate, maxDate))
}

const CACHED_WEEKS = new Map<number, readonly Temporal.PlainDate[][]>()

function computedWeeks(firstVisibleDay: Temporal.PlainDate) {
	return () => Array.from({ length: 6 }, (_, weekIndex) => Array.from({ length: 7 }, (_, dayIndex) => firstVisibleDay.add({ days: weekIndex * 7 + dayIndex })))
}

function stableKeyFromDate(date: Temporal.PlainDate) {
	return date.year * 1000 + date.dayOfYear
}

// Builds the six visible calendar weeks for the current month view.
function buildWeeks(month: Temporal.PlainDate) {
	const firstVisibleDay = startOfWeek(startOfMonth(month))
	return CACHED_WEEKS.getOrInsertComputed(stableKeyFromDate(firstVisibleDay), computedWeeks(firstVisibleDay))
}

// Reads the ISO week number from the first visible day of a week row.
function weekNumberFor(week: readonly Temporal.PlainDate[]) {
	return week[0]?.weekOfYear
}

// Renders an inline single-date calendar backed by native Temporal.PlainDate values.
export function Calendar({ className, classNames, color = 'primary', disabled = false, maxDate, minDate, onValueChange, readOnly = false, ref, showWeekNumber = false, style, value, ...props }: CalendarProps) {
	const [minimumDate, maximumDate] = normalizeBounds(minDate, maxDate)
	const selectedValue = value ? clampDate(value, minimumDate, maximumDate) : undefined
	const [visibleMonth, setVisibleMonth] = useState(() => resolveVisibleMonth(selectedValue, minimumDate, maximumDate))
	const today = todayDate()
	const styles = calendarStyles({ color, showWeekNumber })
	const weeks = buildWeeks(visibleMonth)
	const selectedValueKey = selectedValue === undefined ? undefined : stableKeyFromDate(selectedValue)
	const minimumDateKey = minimumDate === undefined ? undefined : stableKeyFromDate(minimumDate)
	const maximumDateKey = maximumDate === undefined ? undefined : stableKeyFromDate(maximumDate)
	const navigationLocked = disabled || readOnly
	const previousYearMonth = startOfMonth(visibleMonth.add({ years: -1 }))
	const previousMonth = startOfMonth(visibleMonth.add({ months: -1 }))
	const nextMonth = startOfMonth(visibleMonth.add({ months: 1 }))
	const nextYearMonth = startOfMonth(visibleMonth.add({ years: 1 }))
	const canGoPreviousYear = !navigationLocked && monthHasVisibleDays(previousYearMonth, minimumDate, maximumDate)
	const canGoPreviousMonth = !navigationLocked && monthHasVisibleDays(previousMonth, minimumDate, maximumDate)
	const canGoNextMonth = !navigationLocked && monthHasVisibleDays(nextMonth, minimumDate, maximumDate)
	const canGoNextYear = !navigationLocked && monthHasVisibleDays(nextYearMonth, minimumDate, maximumDate)

	// Keeps the visible month aligned with controlled value and updated bounds.
	useEffect(() => {
		if (selectedValue) {
			const nextVisibleMonth = startOfMonth(selectedValue)
			setVisibleMonth((currentVisibleMonth) => (isSameMonth(currentVisibleMonth, nextVisibleMonth) ? currentVisibleMonth : nextVisibleMonth))
			return
		}

		setVisibleMonth((currentVisibleMonth) => (monthHasVisibleDays(currentVisibleMonth, minimumDate, maximumDate) ? currentVisibleMonth : resolveVisibleMonth(undefined, minimumDate, maximumDate)))
	}, [selectedValueKey, minimumDateKey, maximumDateKey])

	// Applies a month or year navigation step when the target month is allowed.
	function navigateToMonth(targetMonth: Temporal.PlainDate) {
		if (!monthHasVisibleDays(targetMonth, minimumDate, maximumDate)) return
		setVisibleMonth(startOfMonth(targetMonth))
	}

	// Emits a new selected day when the day cell is interactive.
	function handleDayClick(day: Temporal.PlainDate) {
		if (disabled || readOnly || isDateUnavailable(day, minimumDate, maximumDate)) return
		if (isSameDay(selectedValue, day)) return
		setVisibleMonth(startOfMonth(day))
		onValueChange?.(day)
	}

	return (
		<div {...props} className={tw(styles.base(), disabled && 'opacity-40 cursor-not-allowed', readOnly && !disabled && 'opacity-90 pointer-events-none', className, classNames?.base)} ref={ref} style={style}>
			<div className={tw(styles.header(), classNames?.header)}>
				<div className={tw(styles.navGroup(), classNames?.navGroup)}>
					<button className={tw(styles.navButton(), !canGoPreviousMonth && 'pointer-events-none', canGoPreviousMonth && 'hover:bg-neutral-800 active:bg-neutral-700', classNames?.navButton)} disabled={!canGoPreviousMonth} onClick={() => navigateToMonth(previousMonth)} type='button'>
						<span className={tw(styles.navIconGroup(), classNames?.navIconGroup)}>
							<Icons.ChevronLeft />
						</span>
					</button>
					<div className={tw(styles.title(), classNames?.title)}>{calendarMonthNames[visibleMonth.month - 1]}</div>
					<button className={tw(styles.navButton(), !canGoNextMonth && 'pointer-events-none', canGoNextMonth && 'hover:bg-neutral-800 active:bg-neutral-700', classNames?.navButton)} disabled={!canGoNextMonth} onClick={() => navigateToMonth(nextMonth)} type='button'>
						<Icons.ChevronRight />
					</button>
				</div>
				<div className={tw(styles.navGroup(), classNames?.navGroup)}>
					<button className={tw(styles.navButton(), !canGoPreviousYear && 'pointer-events-none', canGoPreviousYear && 'hover:bg-neutral-800 active:bg-neutral-700', classNames?.navButton)} disabled={!canGoPreviousYear} onClick={() => navigateToMonth(previousYearMonth)} type='button'>
						<Icons.ChevronLeft />
					</button>
					<div className={tw(styles.title(), classNames?.title)}>{visibleMonth.year}</div>
					<button className={tw(styles.navButton(), !canGoNextYear && 'pointer-events-none', canGoNextYear && 'hover:bg-neutral-800 active:bg-neutral-700', classNames?.navButton)} disabled={!canGoNextYear} onClick={() => navigateToMonth(nextYearMonth)} type='button'>
						<span className={tw(styles.navIconGroup(), classNames?.navIconGroup)}>
							<Icons.ChevronRight />
						</span>
					</button>
				</div>
			</div>
			<div className={tw(styles.weekdays(), classNames?.weekdays)}>
				{showWeekNumber && <div className={tw(styles.weekNumber(), classNames?.weekNumber)}>W</div>}
				{calendarWeekdayNames.map((weekday, index) => (
					<div className={tw(styles.weekday(), classNames?.weekday)} key={`${weekday}-${index}`}>
						{weekday}
					</div>
				))}
			</div>
			<div className={tw(styles.weeks(), classNames?.weeks)}>
				{weeks.map((week) => (
					<div className={tw(styles.week(), classNames?.week)} key={`${week[0].year}-${week[0].dayOfYear}`}>
						{showWeekNumber && <div className={tw(styles.weekNumber(), classNames?.weekNumber)}>{weekNumberFor(week) ?? ''}</div>}
						{week.map((day) => {
							const selected = isSameDay(selectedValue, day)
							const todayHighlighted = !selected && isSameDay(today, day)
							const currentMonth = isSameMonth(visibleMonth, day)
							const unavailable = isDateUnavailable(day, minimumDate, maximumDate)

							return (
								<button
									className={tw(
										styles.day(),
										selected ? 'bg-(--color-variant) text-white' : todayHighlighted ? 'text-(--color-variant)' : currentMonth ? 'text-white' : 'text-neutral-500',
										!selected && !unavailable && !disabled && !readOnly && 'hover:bg-neutral-800 active:bg-neutral-700',
										unavailable && !selected && !todayHighlighted && 'text-neutral-700',
										disabled && 'cursor-not-allowed',
										classNames?.day,
									)}
									disabled={disabled || readOnly || unavailable}
									key={`${day.year}-${day.dayOfYear}`}
									onClick={() => handleDayClick(day)}
									type='button'>
									{day.day}
								</button>
							)
						})}
					</div>
				))}
			</div>
		</div>
	)
}
