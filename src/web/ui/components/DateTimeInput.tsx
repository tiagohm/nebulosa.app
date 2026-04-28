import type * as React from 'react'
import { Fragment, useEffect, useEffectEvent, useRef, useState } from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { clamp, tw } from '@/shared/util'
import { Icons } from '../Icon'
import { Calendar, type CalendarProps } from './Calendar'
import { DEFAULT_FLOATING_OFFSET, Floating, type FloatingPlacement } from './Floating'

const DATE_INPUT_PARTS = 'YMD'
const TIME_INPUT_PARTS = 'hms'

const dateTimeInputStyles = tv({
	slots: {
		base: 'relative inline-flex min-w-0 align-top',
		surface: 'flex w-full min-w-0 items-stretch overflow-hidden rounded-lg transition',
		field: 'relative min-w-0 flex-1',
		segments: 'flex h-full min-w-0 items-center font-mono tabular-nums',
		segment: 'h-full border-none bg-transparent px-0 text-center outline-none transition',
		separator: 'flex h-full shrink-0 items-center justify-center select-none w-[1ch]',
		label: 'pointer-events-none absolute right-3 top-1.5 origin-left truncate text-xs leading-none transition-all duration-150 ease-out',
		content: 'flex shrink-0 items-center gap-1 whitespace-nowrap',
		calendarButton: 'flex shrink-0 items-center justify-center rounded-md outline-none transition',
		calendarIcon: '',
		popover: 'max-w-none rounded-lg bg-transparent p-0 text-neutral-100 shadow-lg shadow-black/40',
		calendar: 'shadow-none',
		Y: 'w-[4ch]',
		M: 'w-[2ch]',
		D: 'w-[2ch]',
		h: 'w-[2ch]',
		m: 'w-[2ch]',
		s: 'w-[2ch]',
	},
	variants: {
		size: {
			md: {
				segments: 'h-10 px-3 text-sm',
				label: 'left-3',
				content: 'px-2 text-sm',
				calendarButton: 'size-7',
				calendarIcon: 'size-[1.25em]',
			},
			lg: {
				segments: 'h-11 px-4 text-base',
				label: 'left-4',
				content: 'px-3 text-base',
				calendarButton: 'size-8',
				calendarIcon: 'size-[1.35em]',
			},
		},
		color: {
			default: {
				base: '[--color-variant:var(--color-neutral-500)]',
			},
			primary: {
				base: '[--color-variant:var(--primary)]',
			},
			secondary: {
				base: '[--color-variant:var(--secondary)]',
			},
			success: {
				base: '[--color-variant:var(--success)]',
			},
			danger: {
				base: '[--color-variant:var(--danger)]',
			},
			warning: {
				base: '[--color-variant:var(--warning)]',
			},
		},
		hasLabel: {
			true: {},
			false: {
				label: 'hidden',
			},
		},
		fullWidth: {
			true: {
				base: 'w-full',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		hasLabel: false,
		color: 'default',
	},
})

const dateTimeInputSizeStyles = {
	md: {
		segmentsWithLabel: 'pt-5 pb-1.5',
		segmentsWithoutLabel: 'py-2.5',
	},
	lg: {
		segmentsWithLabel: 'pt-5 pb-1.5',
		segmentsWithoutLabel: 'py-2.5',
	},
} as const

type DateTimeInputVariants = VariantProps<typeof dateTimeInputStyles>
type DateTimeInputTimePart = 'h' | 'm' | 's'
type DateTimeInputSegmentPart = DateTimeInputFormatPart | DateTimeInputTimePart
type DateTimeInputDrafts = Partial<Record<DateTimeInputSegmentPart, string>>

export type DateTimeInputFormatPart = 'Y' | 'M' | 'D'
export type DateTimeInputGranularity = 'none' | 'hour' | 'minute' | 'second'

export interface DateTimeInputClassNames {
	readonly base?: ClassValue
	readonly surface?: ClassValue
	readonly field?: ClassValue
	readonly segments?: ClassValue
	readonly segment?: ClassValue
	readonly separator?: ClassValue
	readonly label?: ClassValue
	readonly startContent?: ClassValue
	readonly endContent?: ClassValue
	readonly calendarButton?: ClassValue
	readonly calendarIcon?: ClassValue
	readonly popover?: ClassValue
	readonly calendar?: ClassValue
}

export interface DateTimeInputProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'defaultValue' | 'color'>, Omit<DateTimeInputVariants, 'hasLabel'>, Pick<CalendarProps, 'minDate' | 'maxDate' | 'showWeekNumber'> {
	readonly autoFlip?: boolean
	readonly classNames?: DateTimeInputClassNames
	readonly defaultValue?: Temporal.PlainDateTime
	readonly disabled?: boolean
	readonly endContent?: React.ReactNode
	readonly fireOnEnter?: boolean
	readonly format?: `${DateTimeInputFormatPart}${DateTimeInputFormatPart}${DateTimeInputFormatPart}`
	readonly granularity?: DateTimeInputGranularity
	readonly label?: React.ReactNode
	readonly onEnter?: () => void
	readonly onValueChange?: (value: Temporal.PlainDateTime) => void
	readonly placement?: FloatingPlacement
	readonly portalContainer?: Element
	readonly readOnly?: boolean
	readonly startContent?: React.ReactNode
	readonly value?: Temporal.PlainDateTime
}

// Reads a timezone-free current date-time from native Temporal.
function now() {
	return Temporal.Now.plainDateTimeISO()
}

// Compares two plain dates using Temporal's native ordering.
function compareDates(left: Temporal.PlainDate, right: Temporal.PlainDate) {
	return Temporal.PlainDate.compare(left, right)
}

// Normalizes optional date bounds into ascending order.
function normalizeDateBounds(minDate?: Temporal.PlainDate, maxDate?: Temporal.PlainDate) {
	if (minDate && maxDate && compareDates(minDate, maxDate) > 0) return [maxDate, minDate] as const
	return [minDate, maxDate] as const
}

// Checks whether a format part belongs to the editable date group.
function isDatePart(part: DateTimeInputSegmentPart): part is DateTimeInputFormatPart {
	return part === 'Y' || part === 'M' || part === 'D'
}

// Checks whether a format part belongs to the editable time group.
function isTimePart(part: DateTimeInputSegmentPart): part is DateTimeInputTimePart {
	return part === 'h' || part === 'm' || part === 's'
}

// Keeps the configured format valid, ordered, and duplicate-free.
function normalizeFormat(format: DateTimeInputProps['format']) {
	let normalized = ''
	const source = format && format.length > 0 ? format : DATE_INPUT_PARTS

	for (const part of source) {
		if (DATE_INPUT_PARTS.includes(part) && !normalized.includes(part)) {
			normalized += part
		}
	}

	return normalized.length > 0 ? normalized : DATE_INPUT_PARTS
}

// Resolves which time segments are visible for the requested granularity.
function timePartsForGranularity(granularity: DateTimeInputGranularity | undefined) {
	if (granularity === 'hour') return 'h'
	if (granularity === 'minute') return 'hm'
	if (granularity === 'second') return TIME_INPUT_PARTS
	return ''
}

// Returns the fixed editable width for each segment.
function partWidth(part: DateTimeInputSegmentPart) {
	return part === 'Y' ? 4 : 2
}

// Formats a number with leading zeroes for a fixed-width segment.
function padPart(value: number, width: number) {
	return value.toFixed(0).padStart(width, '0')
}

// Formats one segment from the committed Temporal value.
function formatPart(value: Temporal.PlainDateTime, part: DateTimeInputSegmentPart) {
	if (part === 'Y') return padPart(value.year, 4)
	if (part === 'M') return padPart(value.month, 2)
	if (part === 'D') return padPart(value.day, 2)
	if (part === 'h') return padPart(value.hour, 2)
	if (part === 'm') return padPart(value.minute, 2)
	return padPart(value.second, 2)
}

// Builds the editable draft strings for the active format.
function draftsFromValue(value: Temporal.PlainDateTime, format: string): DateTimeInputDrafts {
	const drafts = Object.create(null) as DateTimeInputDrafts
	for (const part of format) drafts[part as keyof DateTimeInputDrafts] = formatPart(value, part as keyof DateTimeInputDrafts)
	return drafts
}

// Removes non-digits and enforces the segment width.
function sanitizeDraft(value: string, part: DateTimeInputSegmentPart) {
	return value.replaceAll(/\D/g, '').slice(0, partWidth(part))
}

// Computes the separator between two neighboring editable segments.
function separatorBetween(left: DateTimeInputSegmentPart, right: DateTimeInputSegmentPart) {
	if (isDatePart(left) && isDatePart(right)) return '-'
	if (isTimePart(left) && isTimePart(right)) return ':'
	return ' '
}

// Returns the number of days available in the target year and month.
function daysInMonth(year: number, month: number) {
	return Temporal.PlainDate.from({ year, month, day: 1 }).daysInMonth
}

// Normalizes numeric input into an integer range.
function clampInteger(value: number, minValue: number, maxValue: number) {
	if (!Number.isFinite(value)) return minValue
	return Math.trunc(clamp(value, minValue, maxValue))
}

// Replaces one date segment while keeping the resulting date valid.
function replaceDatePart(value: Temporal.PlainDateTime, part: DateTimeInputFormatPart, nextPartValue: number) {
	const year = part === 'Y' ? clampInteger(nextPartValue, 0, 9999) : value.year
	const month = part === 'M' ? clampInteger(nextPartValue, 1, 12) : value.month
	const dayLimit = daysInMonth(year, month)
	const day = part === 'D' ? clampInteger(nextPartValue, 1, dayLimit) : Math.min(value.day, dayLimit)

	return value.with({ year, month, day })
}

// Replaces one time segment while preserving the rest of the date-time.
function replaceTimePart(value: Temporal.PlainDateTime, part: DateTimeInputTimePart, nextPartValue: number) {
	if (part === 'h') return value.with({ hour: clampInteger(nextPartValue, 0, 23) })
	if (part === 'm') return value.with({ minute: clampInteger(nextPartValue, 0, 59) })
	return value.with({ second: clampInteger(nextPartValue, 0, 59) })
}

// Replaces a single segment on the current Temporal value.
function replacePart(value: Temporal.PlainDateTime, part: DateTimeInputSegmentPart, nextPartValue: number) {
	return isDatePart(part) ? replaceDatePart(value, part, nextPartValue) : replaceTimePart(value, part, nextPartValue)
}

// Applies one keyboard step to a segment using Temporal arithmetic.
function stepPart(value: Temporal.PlainDateTime, part: DateTimeInputSegmentPart, direction: -1 | 1) {
	if (part === 'Y') return direction > 0 ? value.add({ years: 1 }) : value.subtract({ years: 1 })
	if (part === 'M') return direction > 0 ? value.add({ months: 1 }) : value.subtract({ months: 1 })
	if (part === 'D') return direction > 0 ? value.add({ days: 1 }) : value.subtract({ days: 1 })
	if (part === 'h') return direction > 0 ? value.add({ hours: 1 }) : value.subtract({ hours: 1 })
	if (part === 'm') return direction > 0 ? value.add({ minutes: 1 }) : value.subtract({ minutes: 1 })
	return direction > 0 ? value.add({ seconds: 1 }) : value.subtract({ seconds: 1 })
}

function mapDisplayParts<T>(displayParts: string, action: (part: DateTimeInputSegmentPart, index: number) => T) {
	const res = new Array<T>(displayParts.length)
	for (let i = 0; i < displayParts.length; i++) res[i] = action(displayParts[i] as DateTimeInputSegmentPart, i)
	return res
}

// Keeps keyboard stepping inside the four-digit year display range.
function clampDateTimeYear(value: Temporal.PlainDateTime) {
	return replaceDatePart(value, 'Y', value.year)
}

// Checks whether two Temporal values are exactly equal.
function isSameDateTime(left: Temporal.PlainDateTime, right: Temporal.PlainDateTime) {
	return Temporal.PlainDateTime.compare(left, right) === 0
}

// Replaces the date portion from the selected calendar day.
function withCalendarDate(value: Temporal.PlainDateTime, date: Temporal.PlainDate) {
	return value.with({ year: date.year, month: date.month, day: date.day })
}

// Clamps only the date portion while preserving the timezone-free time fields.
function clampDateTimeDate(value: Temporal.PlainDateTime, minDate?: Temporal.PlainDate, maxDate?: Temporal.PlainDate) {
	const date = value.toPlainDate()

	if (minDate && compareDates(date, minDate) < 0) return withCalendarDate(value, minDate)
	if (maxDate && compareDates(date, maxDate) > 0) return withCalendarDate(value, maxDate)
	return value
}

// Renders a segmented date-time input with a Temporal-backed calendar picker.
export function DateTimeInput({
	autoFlip = true,
	autoFocus,
	className,
	classNames,
	defaultValue,
	disabled = false,
	endContent,
	fireOnEnter = false,
	format,
	granularity = 'none',
	fullWidth,
	label,
	maxDate,
	minDate,
	showWeekNumber,
	onEnter,
	onValueChange,
	placement = 'bottom',
	portalContainer,
	readOnly = false,
	ref,
	size = 'md',
	color,
	startContent,
	value,
	...props
}: DateTimeInputProps) {
	const [minimumDate, maximumDate] = normalizeDateBounds(minDate, maxDate)
	const normalizedFormat = normalizeFormat(format)
	const displayParts = `${normalizedFormat}${timePartsForGranularity(granularity)}`
	const isControlled = value !== undefined
	const initialValueRef = useRef(clampDateTimeDate(value ?? defaultValue ?? now(), minimumDate, maximumDate))
	const [uncontrolledValue, setUncontrolledValue] = useState(initialValueRef.current)
	const [calendarOpen, setCalendarOpen] = useState(false)
	const [calendarTriggerElement, setCalendarTriggerElement] = useState<HTMLButtonElement | null>(null)
	const currentValue = clampDateTimeDate(value ?? uncontrolledValue, minimumDate, maximumDate)
	const currentValueKey = currentValue.toString()
	const lastCommittedValueRef = useRef(currentValue)
	const activePartRef = useRef<DateTimeInputSegmentPart | null>(null)
	const inputRefs = useRef<Partial<Record<DateTimeInputSegmentPart, HTMLInputElement | null>>>({})
	const [drafts, setDrafts] = useState(() => draftsFromValue(currentValue, displayParts))
	const styles = dateTimeInputStyles({ size, color, hasLabel: !!label, fullWidth })
	const sizeStyles = dateTimeInputSizeStyles[size]
	const hasStartContent = startContent !== undefined && startContent !== null
	const hasEndContent = endContent !== undefined && endContent !== null
	const hasColorVariant = color !== undefined && color !== null && color !== 'default'
	const calendarVisible = calendarOpen && !disabled && !readOnly
	const surfaceClassName = disabled
		? 'bg-neutral-900/35 text-neutral-500'
		: readOnly
			? 'bg-neutral-900/55 text-neutral-300'
			: hasColorVariant
				? 'bg-(--color-variant)/15 text-lighter-(--color-variant)/85 hover:bg-(--color-variant)/20 focus-within:bg-(--color-variant)/25'
				: 'bg-neutral-900/70 text-neutral-100 hover:bg-neutral-800 focus-within:bg-neutral-800'
	const segmentClassName = disabled ? 'cursor-not-allowed text-neutral-500' : readOnly ? 'cursor-default text-neutral-200' : hasColorVariant ? 'text-lighter-(--color-variant)/85' : 'text-neutral-100'
	const contentClassName = disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : hasColorVariant ? 'text-lighter-(--color-variant)/60' : 'text-neutral-400'
	const labelClassName = disabled ? 'text-neutral-600' : readOnly ? 'text-neutral-400' : hasColorVariant ? 'text-lighter-(--color-variant)/65' : 'text-neutral-400'
	const calendarButtonClassName = disabled
		? 'cursor-not-allowed text-neutral-500'
		: readOnly
			? 'cursor-default text-neutral-300'
			: hasColorVariant
				? 'cursor-pointer text-lighter-(--color-variant)/70 hover:bg-(--color-variant)/20 hover:text-lighter-(--color-variant)/90 active:bg-(--color-variant)/25'
				: 'cursor-pointer text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 active:bg-neutral-600'

	// Keeps the draft synchronized while no segment is actively edited.
	useEffect(() => {
		lastCommittedValueRef.current = currentValue

		if (!isControlled && !isSameDateTime(uncontrolledValue, currentValue)) {
			setUncontrolledValue(currentValue)
		}

		if (activePartRef.current === null || !displayParts.includes(activePartRef.current)) {
			setDrafts(draftsFromValue(currentValue, displayParts))
		}
	}, [currentValueKey, displayParts, isControlled, uncontrolledValue])

	// Closes the calendar when the field becomes non-interactive.
	useEffect(() => {
		if ((disabled || readOnly) && calendarOpen) {
			setCalendarOpen(false)
		}
	}, [calendarOpen, disabled, readOnly])

	// Commits the next Temporal value in controlled or uncontrolled mode.
	const commitValue = useEffectEvent((nextValue: Temporal.PlainDateTime) => {
		nextValue = clampDateTimeDate(nextValue, minimumDate, maximumDate)
		const previousValue = lastCommittedValueRef.current
		lastCommittedValueRef.current = nextValue

		if (!isControlled) {
			setUncontrolledValue(nextValue)
		}

		if (!isSameDateTime(previousValue, nextValue)) {
			onValueChange?.(nextValue)
		}

		return nextValue
	})

	// Moves focus to the next editable segment when one exists.
	function focusNextPart(part: DateTimeInputSegmentPart) {
		const currentIndex = displayParts.indexOf(part)
		const nextPart = displayParts[currentIndex + 1] as DateTimeInputSegmentPart | undefined
		if (nextPart) inputRefs.current[nextPart]?.focus()
	}

	// Commits a segment draft into the Temporal value.
	function commitPart(part: DateTimeInputSegmentPart, rawDraft: string, allowPadding: boolean) {
		const sanitizedDraft = sanitizeDraft(rawDraft, part)
		const width = partWidth(part)

		if (sanitizedDraft.length === 0 || (part === 'Y' && sanitizedDraft.length !== width) || (!allowPadding && sanitizedDraft.length !== width)) {
			setDrafts((currentDrafts) => ({ ...currentDrafts, [part]: formatPart(lastCommittedValueRef.current, part) }))
			return false
		}

		const paddedDraft = part === 'Y' ? sanitizedDraft : sanitizedDraft.padStart(width, '0')
		const parsedValue = Number(paddedDraft)

		if (!Number.isFinite(parsedValue)) {
			setDrafts((currentDrafts) => ({ ...currentDrafts, [part]: formatPart(lastCommittedValueRef.current, part) }))
			return false
		}

		const nextValue = commitValue(replacePart(lastCommittedValueRef.current, part, parsedValue))
		setDrafts((currentDrafts) => ({ ...currentDrafts, [part]: formatPart(nextValue, part) }))
		return true
	}

	// Stores a segment input by its format part.
	function handleSegmentRef(part: DateTimeInputSegmentPart, element: HTMLInputElement | null) {
		inputRefs.current[part] = element
	}

	// Tracks and selects the active segment for direct replacement.
	function handleSegmentFocus(part: DateTimeInputSegmentPart, event: React.FocusEvent<HTMLInputElement>) {
		activePartRef.current = part
		event.currentTarget.select()
	}

	// Commits or restores a segment when focus leaves it.
	function handleSegmentBlur(part: DateTimeInputSegmentPart, event: React.FocusEvent<HTMLInputElement>) {
		activePartRef.current = null
		commitPart(part, event.currentTarget.value, true)
	}

	// Keeps one segment draft numeric while the user types.
	function handleSegmentChange(part: DateTimeInputSegmentPart, event: React.ChangeEvent<HTMLInputElement>) {
		const nextDraft = sanitizeDraft(event.currentTarget.value, part)
		setDrafts((currentDrafts) => ({ ...currentDrafts, [part]: nextDraft }))

		if (nextDraft.length === partWidth(part) && commitPart(part, nextDraft, false)) {
			focusNextPart(part)
		}
	}

	// Applies keyboard behavior for one focused segment.
	function handleSegmentKeyDown(part: DateTimeInputSegmentPart, event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.defaultPrevented) return

		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault()
			const nextValue = commitValue(clampDateTimeYear(stepPart(lastCommittedValueRef.current, part, event.key === 'ArrowUp' ? 1 : -1)))
			setDrafts(draftsFromValue(nextValue, displayParts))
			return
		}

		if (event.key === 'ArrowRight' && event.currentTarget.selectionStart === event.currentTarget.value.length) {
			const currentIndex = displayParts.indexOf(part)
			const nextPart = displayParts[currentIndex + 1] as DateTimeInputSegmentPart | undefined
			if (nextPart) inputRefs.current[nextPart]?.focus()
			return
		}

		if (event.key === 'ArrowLeft' && event.currentTarget.selectionStart === 0) {
			const currentIndex = displayParts.indexOf(part)
			const previousPart = displayParts[currentIndex - 1] as DateTimeInputSegmentPart | undefined
			if (previousPart) inputRefs.current[previousPart]?.focus()
			return
		}

		if (event.key === 'Escape') {
			event.preventDefault()
			setDrafts((currentDrafts) => ({ ...currentDrafts, [part]: formatPart(lastCommittedValueRef.current, part) }))
			event.currentTarget.select()
			return
		}

		if (fireOnEnter && event.key === 'Enter') {
			commitPart(part, event.currentTarget.value, true)
			onEnter?.()
		}
	}

	function handleSegmentWheel(part: DateTimeInputSegmentPart, event: React.WheelEvent<HTMLInputElement>) {
		if (event.defaultPrevented) return

		const delta = event.deltaY || event.deltaX
		const direction = -Math.sign(delta)

		if (direction === 1 || direction === -1) {
			// Unable to preventDefault inside passive event listener invocation
			// event.preventDefault()
			const nextValue = commitValue(clampDateTimeYear(stepPart(lastCommittedValueRef.current, part, direction)))
			setDrafts(draftsFromValue(nextValue, displayParts))
		}
	}

	// Toggles the calendar picker from the end-content button.
	function handleCalendarPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
		if (event.defaultPrevented || disabled || readOnly) return
		if (event.pointerType === 'mouse' && event.button !== 0) return
		setCalendarOpen((open) => !open)
	}

	// Applies a selected calendar day while preserving the time fields.
	function handleCalendarValueChange(nextDate: Temporal.PlainDate) {
		const nextValue = commitValue(withCalendarDate(lastCommittedValueRef.current, nextDate))
		setDrafts(draftsFromValue(nextValue, displayParts))
		setCalendarOpen(false)
	}

	const EndContent = (
		<>
			{hasEndContent && endContent}
			<button className={tw(styles.calendarButton(), calendarButtonClassName, classNames?.calendarButton)} disabled={disabled || readOnly} onPointerDown={handleCalendarPointerDown} ref={setCalendarTriggerElement} tabIndex={-1} type="button">
				<Icons.Calendar className={tw(styles.calendarIcon(), classNames?.calendarIcon)} />
			</button>
		</>
	)

	const CalendarContent = <Calendar className={tw(styles.calendar(), classNames?.calendar)} color={color ?? 'default'} disabled={disabled} maxDate={maximumDate} minDate={minimumDate} onValueChange={handleCalendarValueChange} readOnly={readOnly} showWeekNumber={showWeekNumber} value={currentValue.toPlainDate()} />

	return (
		<>
			<div {...props} className={tw(styles.base(), className, disabled && 'opacity-40 cursor-not-allowed', readOnly && !disabled && 'opacity-90 pointer-events-none', classNames?.base)} ref={ref}>
				<div className={tw(styles.surface(), surfaceClassName, classNames?.surface)}>
					{hasStartContent && <div className={tw(styles.content(), contentClassName, classNames?.startContent)}>{startContent}</div>}
					<div className={tw(styles.field(), classNames?.field)}>
						<div className={tw(styles.segments(), label ? sizeStyles.segmentsWithLabel : sizeStyles.segmentsWithoutLabel, hasStartContent && 'pl-0', contentClassName, classNames?.segments)}>
							{mapDisplayParts(displayParts, (part, index) => (
								<Fragment key={part}>
									{index > 0 && <span className={tw(styles.separator(), contentClassName, classNames?.separator)}>{separatorBetween(displayParts[index - 1] as DateTimeInputSegmentPart, part)}</span>}
									<input
										autoFocus={autoFocus && index === 0}
										className={tw(styles.segment(), styles[part](), segmentClassName, classNames?.segment)}
										disabled={disabled}
										inputMode="numeric"
										maxLength={partWidth(part)}
										onBlur={(event) => handleSegmentBlur(part, event)}
										onChange={(event) => handleSegmentChange(part, event)}
										onFocus={(event) => handleSegmentFocus(part, event)}
										onKeyDown={(event) => handleSegmentKeyDown(part, event)}
										onWheel={(event) => handleSegmentWheel(part, event)}
										readOnly={readOnly}
										ref={(element) => handleSegmentRef(part, element)}
										spellCheck={false}
										type="text"
										value={drafts[part] ?? formatPart(lastCommittedValueRef.current, part)}
									/>
								</Fragment>
							))}
						</div>
						{label && <label className={tw(styles.label(), hasStartContent && 'left-0', labelClassName, classNames?.label)}>{label}</label>}
					</div>
					<div className={tw(styles.content(), contentClassName, classNames?.endContent)}>{EndContent}</div>
				</div>
			</div>
			<Floating
				autoFlip={autoFlip}
				classNames={{ content: tw(styles.popover(), classNames?.popover) }}
				closeOnEscape
				closeOnPointerDownOutside
				content={CalendarContent}
				hideArrow
				interactive
				offset={DEFAULT_FLOATING_OFFSET / 2}
				onOpenChange={setCalendarOpen}
				open={calendarVisible}
				placement={placement}
				portalContainer={portalContainer}
				triggerElement={calendarTriggerElement}
			/>
		</>
	)
}
