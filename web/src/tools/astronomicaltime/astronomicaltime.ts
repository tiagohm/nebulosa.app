import type { ApiError, AstronomicalTimeErrorCode, AstronomicalTimeInput, AstronomicalTimeQuality, AstronomicalTimeRequest, AstronomicalTimeResult, SkyObserver, TimeScaleName } from 'api'
import { type Angle, parseAngle } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { jsonInit, responseError } from '../../http'
import type { SkyObserverSettings } from '../../profile/schema'
import { navigate, routeState, type RouteState } from '../../shell/route'
import { BROWSER_TIME_ZONE, setSkyTime, skyClock, type SkyClock, skyTime } from '../../sky/clock'
import { createRequestGuard } from '../../sky/selection'
import { aborted, type EclipsePlace, errorMessage } from '../eclipse/eclipse'

// State of the Astronomical Time Converter and its requests to /api/astronomical-time: the instant being read, the
// location and time zone it is read for, and the answer of the server, which owns every astronomical value. This module
// only reads what is typed into the fields of a request and says what is wrong with it; the server assumes valid fields.
// The state lives as long as the tab, so leaving and reopening the tool keeps it, and nothing is persisted. The instant
// here is independent of the Sky simulation clock: it is read from it or written to it only by an explicit action.

// How the instant is decided: following the real current time, or as entered.
export type ConverterMode = 'now' | 'custom'

// Form the custom instant is entered in.
export type InputFormat = 'calendar' | 'iso' | 'jd' | 'mjd' | 'unix' | 'julianEpoch' | 'besselianEpoch'

// What a calendar entry is read in: the civil time of the zone shown, or the calendar of a timescale.
export type CalendarRead = 'zone' | TimeScaleName

// Occurrence of a local reading the clocks repeat.
export type LocalFold = 'earlier' | 'later'

// State of the tool in the tab.
export interface AstronomicalTimeState {
	// How the instant is decided.
	mode: ConverterMode
	// Form of the custom instant.
	format: InputFormat
	// Text of the custom instant.
	text: string
	// Timescale of a Julian date.
	scale: TimeScaleName
	// What a calendar entry is read in.
	read: CalendarRead
	// Occurrence chosen of a repeated local reading.
	fold?: LocalFold
	// Time zone chosen: UTC, an IANA zone, or empty for the browser's; undefined follows the observer, then the browser.
	timeZone?: string
	// Location chosen for the tool alone; undefined follows the Sky observer of the active profile.
	place?: EclipsePlace
	// Text of the apparent right ascension of date of the hour angle, in hours.
	rightAscension: string
	// Answer for the current inputs.
	result?: AstronomicalTimeResult
	// Why the inputs cannot be sent.
	inputError?: string
	// Why the server gave no answer.
	error?: string
	// Both instants of a repeated local reading, Unix milliseconds, until one is chosen.
	ambiguous?: { readonly earlier: number; readonly later: number }
}

// Browser services of the tool, replaced in tests.
export interface ConverterIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Whether the page is visible; a hidden page asks for nothing.
	readonly visible: () => boolean
}

// Browser implementation of ConverterIo.
const browserConverterIo: ConverterIo = {
	fetch: (input, init) => fetch(input, init),
	visible: () => document.visibilityState === 'visible',
}

// Timescales in display order.
export const TIME_SCALE_NAMES: readonly TimeScaleName[] = ['UTC', 'UT1', 'TAI', 'TT', 'TCG', 'TDB', 'TCB']

// Options of what a calendar entry is read in, in display order.
export const CALENDAR_READS: readonly CalendarRead[] = ['zone', ...TIME_SCALE_NAMES]

// Forms of the custom instant, in display order.
export const INPUT_FORMATS: readonly InputFormat[] = ['calendar', 'iso', 'jd', 'mjd', 'unix', 'julianEpoch', 'besselianEpoch']

// Name of each form of the custom instant.
export const INPUT_FORMAT_LABELS: Readonly<Record<InputFormat, string>> = { calendar: 'Calendar', iso: 'ISO 8601', jd: 'Julian Date', mjd: 'Modified Julian Date', unix: 'Unix Time', julianEpoch: 'Julian Epoch', besselianEpoch: 'Besselian Epoch' }

// Example shown in the empty field of each form.
export const INPUT_FORMAT_EXAMPLES: Readonly<Record<InputFormat, string>> = { calendar: '2026-10-31 21:30:00', iso: '2026-10-31T21:30:00-03:00', jd: '2461345.5', mjd: '61345', unix: '1793491200', julianEpoch: '2026.83', besselianEpoch: '2026.83' }

// Time between the last edit of a custom instant and its request, in milliseconds.
const EDIT_DEBOUNCE_MS = 250

// Time between the conversions of the real current time, in milliseconds.
const NOW_INTERVAL_MS = 1000

// Earliest and latest astronomical years the tool reads, within the range of the toolkit's calendar and of `Intl`.
const MINIMUM_YEAR = -4712
const MAXIMUM_YEAR = 9999

// Latest Julian date read, the end of MAXIMUM_YEAR in days.
const MAXIMUM_JD = 5373484.5

// Julian date of the origin of Modified Julian Dates, in days.
const MJD_ORIGIN = 2400000.5

// Latest Unix time read, the end of MAXIMUM_YEAR in seconds.
const MAXIMUM_UNIX = 253402300799

// Earliest Unix time read, the Julian date 0 in seconds.
const MINIMUM_UNIX = -210866760000

// Civil reading: year (astronomical numbering), month, day, hour, minute, and an optional fractional second.
const CIVIL_PATTERN = /^(-?\d{1,4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/

// Offset closing an ISO 8601 reading: Z, or its sign, hours, and optional minutes.
const OFFSET_PATTERN = /(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/

// Plain decimal number, with no exponent.
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/

// Fields of a civil reading.
interface CivilFields {
	readonly year: number
	readonly month: number
	readonly day: number
	readonly hour: number
	readonly minute: number
	readonly second: number
}

// What the inputs ask of the server, or why they cannot be sent.
export type ConversionRequest = { readonly request: AstronomicalTimeRequest } | { readonly error: string }

// Initial state of the tool.
export function initialAstronomicalTimeState(): AstronomicalTimeState {
	return { mode: 'now', format: 'calendar', text: '', scale: 'UTC', read: 'zone', rightAscension: '' }
}

// Astronomical Time Converter state of the tab.
export const astronomicalTimeState = proxy<AstronomicalTimeState>(initialAstronomicalTimeState())

// Requests of the conversion; new inputs supersede them.
const conversionGuard = createRequestGuard()

// Returns the time zone of the local calendar: the one chosen, otherwise the observer's, otherwise the browser's.
export function effectiveTimeZone(state: Pick<AstronomicalTimeState, 'timeZone'>, observer: Pick<SkyObserverSettings, 'timeZone'> | undefined): string {
	return state.timeZone || (state.timeZone === undefined && observer?.timeZone) || BROWSER_TIME_ZONE
}

// Returns the observer of the conversion: the location chosen for the tool at sea level, otherwise the Sky observer.
export function effectiveObserver(state: Pick<AstronomicalTimeState, 'place'>, observer: SkyObserverSettings | undefined): SkyObserver | undefined {
	if (state.place) return { latitude: state.place.latitude, longitude: state.place.longitude, elevation: 0 }
	return observer && { latitude: observer.latitude, longitude: observer.longitude, elevation: observer.elevation }
}

// Returns the fields of a civil reading at the start of a text, or undefined when they name no calendar date and time.
function civilFields(text: string): CivilFields | undefined {
	const match = CIVIL_PATTERN.exec(text)
	if (!match) return undefined

	const [year, month, day, hour, minute] = match.slice(1, 6).map(Number)
	const second = match[6] === undefined ? 0 : Number(match[6])
	const lastDay = new Date(0)
	lastDay.setUTCFullYear(year, month, 0)

	if (!(year >= MINIMUM_YEAR && year <= MAXIMUM_YEAR && month >= 1 && month <= 12 && day >= 1 && day <= lastDay.getUTCDate() && hour <= 23 && minute <= 59 && second < 61)) return undefined
	return { year, month, day, hour, minute, second }
}

// Returns the offset from UTC in minutes closing an ISO 8601 reading, or undefined without one.
function isoOffset(text: string): number | undefined {
	const match = OFFSET_PATTERN.exec(text)
	if (!match) return undefined
	if (match[0] === 'Z') return 0
	const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0)
	return match[1] === '-' ? -minutes : minutes
}

// Returns the instant of a custom entry, or what is wrong with it. `timeZone` names the zone of a calendar entry.
export function parseEntry(state: Pick<AstronomicalTimeState, 'format' | 'text' | 'scale' | 'read' | 'fold'>, timeZone: string): AstronomicalTimeInput | string {
	const { format, scale, read, fold } = state
	const text = state.text.trim()
	if (!text) return `Enter a ${INPUT_FORMAT_LABELS[format]}.`

	switch (format) {
		case 'calendar': {
			const fields = civilFields(text)
			if (!fields || text.length !== CIVIL_PATTERN.exec(text)?.[0].length) return `Enter a date and time such as ${INPUT_FORMAT_EXAMPLES.calendar}, from year ${MINIMUM_YEAR} to ${MAXIMUM_YEAR}.`
			return { kind: 'calendar', ...fields, reference: read === 'zone' ? { kind: 'zone', timeZone, fold } : { kind: 'scale', scale: read } }
		}
		case 'iso': {
			const fields = civilFields(text)
			const minutes = isoOffset(text)
			if (!fields) return `Enter a date and time such as ${INPUT_FORMAT_EXAMPLES.iso}, from year ${MINIMUM_YEAR} to ${MAXIMUM_YEAR}.`
			if (minutes === undefined) return 'An ISO 8601 time needs Z or an offset such as -03:00 to name an instant.'
			return { kind: 'calendar', ...fields, reference: { kind: 'offset', minutes } }
		}
		case 'jd':
		case 'mjd': {
			const jd = DECIMAL_PATTERN.test(text) ? Number(text) + (format === 'mjd' ? MJD_ORIGIN : 0) : Number.NaN
			if (!(jd >= 0 && jd <= MAXIMUM_JD)) return `Enter a decimal number from ${format === 'jd' ? 0 : -MJD_ORIGIN} to ${format === 'jd' ? MAXIMUM_JD : MAXIMUM_JD - MJD_ORIGIN}.`
			return { kind: format, value: text, scale }
		}
		case 'unix': {
			const seconds = DECIMAL_PATTERN.test(text) ? Number(text) : Number.NaN
			if (!(seconds >= MINIMUM_UNIX && seconds <= MAXIMUM_UNIX)) return `Enter the seconds since 1970-01-01 UTC, from ${MINIMUM_UNIX} to ${MAXIMUM_UNIX}.`
			return { kind: 'unix', seconds }
		}
		case 'julianEpoch':
		case 'besselianEpoch': {
			const value = DECIMAL_PATTERN.test(text) ? Number(text) : Number.NaN
			if (!(value >= MINIMUM_YEAR && value <= MAXIMUM_YEAR)) return `Enter a year from ${MINIMUM_YEAR} to ${MAXIMUM_YEAR}.`
			return { kind: format, value }
		}
	}
}

// Returns a right ascension typed in hours, as decimal hours or hours, minutes, and seconds, within a full turn in radians;
// undefined for anything else.
export function parseRightAscension(text: string): Angle | undefined {
	const value = parseAngle(text.trim(), { isHour: true })
	return value !== undefined && value >= 0 && value <= 2 * Math.PI ? value : undefined
}

// Returns what the inputs ask of the server, or why they cannot be sent.
export function conversionRequest(state: Omit<AstronomicalTimeState, 'result' | 'inputError' | 'error' | 'ambiguous'>, observerSettings: SkyObserverSettings | undefined): ConversionRequest {
	const timeZone = effectiveTimeZone(state, observerSettings)
	const observer = effectiveObserver(state, observerSettings)
	const input = state.mode === 'now' ? ({ kind: 'now' } as const) : parseEntry(state, timeZone)
	if (typeof input === 'string') return { error: input }

	const typed = state.rightAscension.trim()
	if (!typed) return { request: { input, observer, timeZone } }

	const rightAscension = parseRightAscension(typed)
	if (rightAscension === undefined) return { error: 'Enter the right ascension in hours, such as 5.5 or 05 30 00.' }
	return { request: { input, observer, timeZone, rightAscension } }
}

// Asks for a conversion and shows its answer. No answer leaves no result, so an old value never stands for new inputs.
async function convert(state: AstronomicalTimeState, request: AstronomicalTimeRequest, io: ConverterIo) {
	const own = conversionGuard.begin()

	try {
		const response = await io.fetch('/api/astronomical-time/convert', jsonInit('POST', request, own.signal))

		if (response.ok) {
			const result = (await response.json()) as AstronomicalTimeResult
			if (!own.current()) return
			state.result = result
			state.error = undefined
			state.ambiguous = undefined
			return
		}

		const failure = response.clone()
		const body = (await response.json().catch(() => undefined)) as (ApiError<AstronomicalTimeErrorCode> & { readonly earlier: number; readonly later: number }) | undefined
		if (!own.current()) return
		state.result = undefined
		state.ambiguous = body?.code === 'ambiguousLocalTime' ? { earlier: body.earlier, later: body.later } : undefined
		state.error = state.ambiguous ? undefined : (body?.error ?? (await responseError(failure)))
	} catch (error) {
		if (aborted(error) || !own.current()) return
		state.result = undefined
		state.ambiguous = undefined
		state.error = errorMessage(error)
	}
}

// Follows the inputs: asks for a custom instant once, after the edits settle, or for the real current time every
// NOW_INTERVAL_MS while the page is visible, one request at a time. Inputs that cannot be sent clear the result. Returns
// the function that stops it.
export function followConversion(state: AstronomicalTimeState, inputs: ConversionRequest, io: ConverterIo = browserConverterIo): () => void {
	state.inputError = 'error' in inputs ? inputs.error : undefined

	if ('error' in inputs) {
		conversionGuard.cancel()
		state.result = undefined
		state.error = undefined
		state.ambiguous = undefined
		return () => {}
	}

	const { request } = inputs
	const live = request.input.kind === 'now'
	let stopped = false
	let timer: ReturnType<typeof setTimeout>

	async function step() {
		if (!live || io.visible()) await convert(state, request, io)
		if (live && !stopped) timer = setTimeout(() => void step(), NOW_INTERVAL_MS)
	}

	timer = setTimeout(() => void step(), live ? 0 : EDIT_DEBOUNCE_MS)

	return () => {
		stopped = true
		clearTimeout(timer)
		conversionGuard.cancel()
	}
}

// Returns the text of an entry form for the instant of a result, so changing form keeps the instant; empty when the
// form cannot represent it.
export function entryText(state: Pick<AstronomicalTimeState, 'format' | 'scale' | 'read'>, result: AstronomicalTimeResult): string {
	const { scales, civil, epochs } = result

	switch (state.format) {
		case 'calendar':
			return state.read === 'zone' ? civil.local : scales[state.read].calendar
		case 'iso':
			return `${scales.UTC.calendar}Z`
		case 'jd':
			return scales[state.scale].jd
		case 'mjd':
			return scales[state.scale].mjd
		case 'unix':
			return civil.unixMillis === undefined ? '' : `${civil.unixMillis / 1000}`
		case 'julianEpoch':
			return epochs.julian.toFixed(9)
		case 'besselianEpoch':
			return epochs.besselian.toFixed(9)
	}
}

// Rewrites the entry for the instant shown, when there is one.
function refreshEntry(state: AstronomicalTimeState) {
	if (state.result) state.text = entryText(state, state.result)
	state.fold = undefined
}

// Switches between following the real current time and a custom instant, which starts at the instant shown.
export function setConverterMode(state: AstronomicalTimeState, mode: ConverterMode) {
	state.mode = mode
	if (mode === 'custom') refreshEntry(state)
}

// Changes the form of the custom instant, keeping the instant shown.
export function setInputFormat(state: AstronomicalTimeState, format: InputFormat) {
	state.format = format
	refreshEntry(state)
}

// Changes the timescale of a Julian date, keeping the instant shown.
export function setInputScale(state: AstronomicalTimeState, scale: TimeScaleName) {
	state.scale = scale
	refreshEntry(state)
}

// Changes what a calendar entry is read in, keeping the instant shown.
export function setCalendarRead(state: AstronomicalTimeState, read: CalendarRead) {
	state.read = read
	refreshEntry(state)
}

// Replaces the text of the custom instant.
export function setEntryText(state: AstronomicalTimeState, text: string) {
	state.text = text
	state.fold = undefined
}

// Makes a value of the results the custom instant.
export function takeAsInput(state: AstronomicalTimeState, format: InputFormat, scale: TimeScaleName, text: string) {
	state.mode = 'custom'
	state.format = format
	state.scale = scale
	state.text = text
	state.fold = undefined
}

// Takes the instant the Sky shows now as a custom instant, once: the tool does not follow the Sky afterwards.
export function takeSkyTime(state: AstronomicalTimeState, clock: Readonly<SkyClock> = skyClock, now: number = Date.now()) {
	takeAsInput(state, 'unix', state.scale, `${skyTime(clock, now) / 1000}`)
}

// Sends the Sky to the instant shown; nothing else changes. A leap second has no Unix time, so it has no effect there.
export function applyToSky(state: Pick<AstronomicalTimeState, 'result'>, clock: SkyClock = skyClock) {
	const time = state.result?.civil.unixMillis
	if (time !== undefined) setSkyTime(clock, time)
}

// Opens the tool on the real current time at the active profile's observer, whatever instant it held.
export function openAstronomicalTimeConverter(state: AstronomicalTimeState = astronomicalTimeState, route: RouteState = routeState, history?: Pick<History, 'pushState'>) {
	state.mode = 'now'
	state.place = undefined
	navigate(route, { workspace: 'tools', tool: 'astronomical-time-converter' }, history)
}

// Name of each table of Earth orientation data.
const EOP_SOURCE_NAMES = { iersA: 'IERS Bulletin A', iersB: 'IERS EOP C04' } as const

// Returns what a reader must know about the accuracy of a result, one sentence each.
export function qualityNotes({ eop, leapSeconds }: AstronomicalTimeQuality): string[] {
	const notes: string[] = []

	if (eop.status === 'covered' && eop.source) notes.push(`Earth orientation from ${EOP_SOURCE_NAMES[eop.source]}.`)
	else if (eop.status === 'outsideTable') notes.push('No Earth orientation table reaches this date, so UT1 is taken as UTC: UT1 and sidereal times are approximate.')
	else notes.push('No Earth orientation data is loaded yet, so UT1 is taken as UTC: UT1 and sidereal times are approximate.')

	if (leapSeconds === 'beforeUtc') notes.push('UTC did not exist before 1960, so TAI−UTC is taken as 0.')
	else if (leapSeconds === 'assumed') notes.push('This date is in the future: it assumes no leap second is added after the last one known.')

	return notes
}
