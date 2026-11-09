import { altitudeOf } from 'nebulosa/src/astronomy/events/horizon'
import { isMeteorShowerActive, meteorShowerActivityYearApplies } from 'nebulosa/src/astronomy/meteors/activity'
import { meteorMoonDirection, meteorSunDirection } from 'nebulosa/src/astronomy/meteors/observation'
import { meteorGeometricObservingWindows } from 'nebulosa/src/astronomy/meteors/planner'
import { meteorSolarLongitude } from 'nebulosa/src/astronomy/meteors/solar'
import { meteorShowerComputationContext, meteorShowerState, meteorShowerStates } from 'nebulosa/src/astronomy/meteors/state'
import type { MeteorGeometricObservingWindow, MeteorGeometricObservingWindowOptions, MeteorShowerSolution, MeteorSolarLongitudeInterval } from 'nebulosa/src/astronomy/meteors/types'
import { type Time, timeToUnixMillis, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import type { Vec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import { type MeteorShowerRecord, preferredSolution } from './meteorshowers.catalog'
import type { MeteorSolarLongitudeTable } from './meteorshowers.solar'
import type { MeteorDataBasis, MeteorVisualEntry, MeteorVisualSourceId } from './meteorshowers.visual'
import { type PlanningSite, resolveNight } from './observingplanner.astronomy'
import { geographic, type SkyObserver } from './sky/ephemeris'
import type { TimeSpan } from './sky/sun'

// Astronomy of the Meteor Showers tool over the toolkit's meteor modules: the dates of a shower's occurrence from each
// source apart (the IAU support and mean reference longitude, the IMO activity period and maximum), the instantaneous
// state of a batch of radiants, the radiants the Sky draws, and the geometric observing night of a shower from a site.
// Solar longitudes are the toolkit's geometric J2000 ones; the IMO publishes its maxima for the equinox J2000.0, which
// differs from them only by the aberration (about 20″, under ten minutes of time), below the precision of a published
// maximum. Angles are radians, times Unix milliseconds (UTC); altitudes are geometric (airless) and the Moon's are
// geocentric, so they can differ from a topocentric altitude by up to about a degree.

// Activity of a shower at an instant: inside its support, outside it, or unknown because no support is published.
export type MeteorActivityState = 'active' | 'inactive' | 'unknown'

// The occurrence of a shower by the IAU catalog: its preferred solution's support and mean reference longitude (iauScientific).
export interface MeteorIauOccurrence {
	// Start of the support, Unix milliseconds; absent without a support.
	readonly start?: number
	// End of the support, Unix milliseconds; absent without a support.
	readonly end?: number
	// Crossing of the mean reference longitude LoS, nearest to the start: an average of the activity, never its maximum.
	readonly reference?: number
}

// The occurrence of a shower by the curated visual data (imoVisual): its recurring activity period and maximum.
export interface MeteorVisualOccurrence {
	// First instant of the first day of the activity period, Unix milliseconds.
	readonly start: number
	// Last instant of the last day of the activity period, Unix milliseconds.
	readonly end: number
	// Crossing of the published solar longitude of the maximum nearest to the period, Unix milliseconds; its precision is
	// that of peakSolarLongitudeDecimals.
	readonly peak: number
	// Published solar longitude of the maximum, radians, equinox J2000.0.
	readonly peakSolarLongitude: number
	// Decimals of the published solar longitude of the maximum, in degrees.
	readonly peakSolarLongitudeDecimals: number
	// Typical ZHR at the maximum, meteors per hour; absent when published as variable.
	readonly typicalZhr?: number
	// Source of the values.
	readonly sourceId: MeteorVisualSourceId
}

// One occurrence of a shower from each source, which are never merged.
export interface MeteorShowerOccurrence {
	// By the IAU catalog; absent when the preferred solution gives no date for it.
	readonly iau?: MeteorIauOccurrence
	// By the curated visual data; absent without visual data.
	readonly visual?: MeteorVisualOccurrence
}

// The occurrence of the IAU catalog that starts in a civil UTC year, as the toolkit's meteorShowerDates defines it
// (the start in the year, the end the first crossing after it, the reference the crossing nearest to it; a dated
// solution outside its years and a start the year never reaches give none), dated from the solar-longitude table.
export function iauOccurrence(solution: MeteorShowerSolution, year: number, table: MeteorSolarLongitudeTable): MeteorIauOccurrence | undefined {
	if (!meteorShowerActivityYearApplies(solution.activity, year)) return undefined
	const interval = solution.activityInterval

	if (interval === undefined) {
		const reference = solution.referenceSolarLongitude === undefined ? undefined : table.crossing(year, solution.referenceSolarLongitude)
		return reference === undefined ? undefined : { reference }
	}

	const start = table.crossing(year, interval.start)
	if (start === undefined) return undefined
	const end = table.after(start, interval.fullCircle ? interval.start : interval.end)
	const reference = solution.referenceSolarLongitude === undefined ? undefined : table.nearest(start, solution.referenceSolarLongitude)
	return { start, end, reference }
}

// The visual occurrence whose activity period starts in a civil UTC year.
export function visualOccurrence(entry: MeteorVisualEntry, year: number, table: MeteorSolarLongitudeTable): MeteorVisualOccurrence {
	const start = Date.UTC(year, entry.activityStart.month - 1, entry.activityStart.day)
	const crossesYear = entry.activityEnd.month < entry.activityStart.month
	const end = Date.UTC(crossesYear ? year + 1 : year, entry.activityEnd.month - 1, entry.activityEnd.day + 1) - 1
	const peakSolarLongitude = entry.peakSolarLongitude * DEG2RAD
	return { start, end, peak: table.nearest((start + end) / 2, peakSolarLongitude), peakSolarLongitude, peakSolarLongitudeDecimals: entry.peakSolarLongitudeDecimals, typicalZhr: entry.typicalZhr, sourceId: entry.sourceId }
}

// The occurrences of a shower overlapping [from, to), from each source apart, in chronological order of their start:
// those starting in the civil years of the span and in the year before, so one crossing the new year is kept.
export function occurrencesOverlapping(record: MeteorShowerRecord, from: number, to: number, table: MeteorSolarLongitudeTable): readonly MeteorShowerOccurrence[] {
	const solution = preferredSolution(record)
	const firstYear = new Date(from).getUTCFullYear() - 1
	const lastYear = new Date(to - 1).getUTCFullYear()
	const occurrences: MeteorShowerOccurrence[] = []

	for (let year = firstYear; year <= lastYear; year++) {
		const iau = solution === undefined ? undefined : iauOccurrence(solution, year, table)
		const iauOverlaps = iau !== undefined && overlaps(iau.start ?? iau.reference!, iau.end ?? iau.reference!, from, to)
		const visual = record.visual === undefined ? undefined : visualOccurrence(record.visual, year, table)
		const visualOverlaps = visual !== undefined && overlaps(visual.start, visual.end, from, to)
		if (iauOverlaps || visualOverlaps) occurrences.push({ ...(iauOverlaps && { iau }), ...(visualOverlaps && { visual }) })
	}

	return occurrences
}

// Whether [start, end] meets [from, to).
function overlaps(start: number, end: number, from: number, to: number) {
	return start < to && end >= from
}

// The instant that best stands for an occurrence when ordering showers: the visual maximum, else the IAU reference, else
// the start of the support.
export function occurrenceInstant(occurrence: MeteorShowerOccurrence): number | undefined {
	return occurrence.visual?.peak ?? occurrence.iau?.reference ?? occurrence.iau?.start
}

// Activity of a shower at an instant and which source decided it: the visual activity period when the shower has one,
// else the support of its preferred solution and the years it applies to, unknown without a support.
export function activityAt(record: MeteorShowerRecord, time: number, solarLongitude: number, table: MeteorSolarLongitudeTable): { readonly state: MeteorActivityState; readonly basis: MeteorDataBasis } {
	if (record.visual !== undefined) {
		const year = new Date(time).getUTCFullYear()
		for (const candidate of [year - 1, year]) {
			const visual = visualOccurrence(record.visual, candidate, table)
			if (time >= visual.start && time <= visual.end) return { state: 'active', basis: 'imoVisual' }
		}
		return { state: 'inactive', basis: 'imoVisual' }
	}

	const solution = preferredSolution(record)
	if (solution === undefined) return { state: 'unknown', basis: 'iauScientific' }
	if (!meteorShowerActivityYearApplies(solution.activity, timeUnix(time / 1000, true))) return { state: 'inactive', basis: 'iauScientific' }
	const active = isMeteorShowerActive(solution.activityInterval, solarLongitude)
	return { state: active === undefined ? 'unknown' : active ? 'active' : 'inactive', basis: 'iauScientific' }
}

// A radiant direction, radians.
export interface MeteorRadiantDirection {
	// Right ascension, radians in [0, 2π).
	readonly rightAscension: number
	// Declination, radians.
	readonly declination: number
}

// Request of the instantaneous state of a batch of showers.
export interface MeteorShowerStatesRequest {
	// Ids of the showers, at most MAX_STATE_IDS.
	readonly ids: readonly string[]
	// Instant, Unix milliseconds (UTC).
	readonly time: number
	// Observer; without one the states are geocentric, with no horizontal coordinates or altitudes.
	readonly observer?: SkyObserver
}

// State of one shower at an instant.
export interface MeteorShowerStateEntry {
	// Id of the shower.
	readonly id: string
	// Activity at the instant.
	readonly activity: MeteorActivityState
	// Source that decided the activity.
	readonly activityBasis: MeteorDataBasis
	// Radiant of the preferred solution at the instant, geocentric, ICRS/J2000 frame; absent without a radiant or beyond its drift.
	readonly radiantJ2000?: MeteorRadiantDirection
	// The same radiant on the true equator and equinox of date.
	readonly radiantOfDate?: MeteorRadiantDirection
	// Whether the radiant was moved by its drift away from the reference longitude.
	readonly radiantExtrapolated?: boolean
	// Geometric altitude of the radiant, radians; absent without an observer or a radiant.
	readonly altitude?: number
	// Azimuth of the radiant, radians from north through east; absent without an observer or a radiant.
	readonly azimuth?: number
	// Geocentric angle between the radiant and the Moon, radians; absent without a radiant.
	readonly moonSeparation?: number
}

// State of a batch of showers at one instant, sharing the Sun and the Moon.
export interface MeteorShowerStates {
	// Instant, Unix milliseconds (UTC).
	readonly time: number
	// Geometric geocentric solar longitude, radians, J2000 ecliptic.
	readonly solarLongitude: number
	// Geometric altitude of the Sun, radians; absent without an observer.
	readonly sunAltitude?: number
	// Geometric, geocentric altitude of the Moon, radians; absent without an observer.
	readonly moonAltitude?: number
	// Illuminated fraction of the Moon, [0, 1].
	readonly moonIllumination?: number
	// The showers asked for that the catalog knows, in the order asked.
	readonly showers: readonly MeteorShowerStateEntry[]
}

// Most showers one state request may name.
export const MAX_STATE_IDS = 100

// The state of a batch of showers at one instant: one toolkit context (the Sun, the Moon, the sidereal time) shared by
// every radiant through meteorShowerStates. Showers without a usable solution keep their activity and have no radiant.
export function meteorShowerStatesAt(records: readonly MeteorShowerRecord[], request: MeteorShowerStatesRequest, table: MeteorSolarLongitudeTable): MeteorShowerStates {
	const time = timeUnix(request.time / 1000, true)
	const observer = request.observer === undefined ? undefined : geographic(request.observer)
	const context = meteorShowerComputationContext(time, observer, { includeHorizontal: observer !== undefined, includeSun: observer !== undefined, includeMoon: true })
	const withSolution = records.filter((record) => preferredSolution(record) !== undefined)
	const states = meteorShowerStates(
		withSolution.map((record) => ({ solution: preferredSolution(record)! })),
		context,
		{ includeHorizontal: observer !== undefined, includeSun: observer !== undefined, includeMoon: true, includeRadiantOfDate: true },
	)
	const byId = new Map(withSolution.map((record, index) => [record.id, states[index]]))

	const showers = records.map((record): MeteorShowerStateEntry => {
		const { state: activity, basis: activityBasis } = activityAt(record, request.time, context.solarLongitude, table)
		const state = byId.get(record.id)
		return {
			id: record.id,
			activity,
			activityBasis,
			...(state?.radiantJ2000 && { radiantJ2000: state.radiantJ2000, radiantExtrapolated: state.radiantExtrapolated }),
			...(state?.radiantOfDate && { radiantOfDate: state.radiantOfDate }),
			...(state?.horizontal && { altitude: state.horizontal.altitude, azimuth: state.horizontal.azimuth }),
			...(state?.moonSeparation !== undefined && { moonSeparation: state.moonSeparation }),
		}
	})

	return { time: request.time, solarLongitude: context.solarLongitude, sunAltitude: context.sunAltitude, moonAltitude: context.moonAltitude, moonIllumination: context.moonIllumination, showers }
}

// One radiant the Sky draws.
export interface MeteorSkyRadiant extends MeteorRadiantDirection {
	// Id of the shower.
	readonly id: string
	// IAU code; absent when the shower has none.
	readonly code?: string
	// Name shown.
	readonly name: string
	// Whether the shower has curated visual data.
	readonly visual: boolean
}

// Radiants the Sky draws at one instant.
export interface MeteorSkyRadiants {
	// Instant, Unix milliseconds (UTC).
	readonly time: number
	// The radiants, geocentric, ICRS/J2000 frame; the Sky converts them to the equator of date of its map.
	readonly radiants: readonly MeteorSkyRadiant[]
}

// Most radiants the Sky draws at once.
export const MAX_SKY_RADIANTS = 100

// The radiants of the showers active at an instant that the Sky draws by default: every curated visual shower inside its
// activity period, and every established IAU shower whose annual preferred solution is inside its support; never a
// removed, working, or year-limited record, nor one without a radiant. At most MAX_SKY_RADIANTS, visual ones first.
export function skyRadiantsAt(records: readonly MeteorShowerRecord[], time: number, table: MeteorSolarLongitudeTable): MeteorSkyRadiants {
	const instant = timeUnix(time / 1000, true)
	const context = meteorShowerComputationContext(instant, undefined, { includeMoon: false, includeSun: false, includeHorizontal: false })
	const candidates = records.filter((record) => {
		const solution = preferredSolution(record)
		if (solution === undefined || record.status === 'removed') return false
		if (record.visual === undefined && (record.status !== 'established' || solution.activity.kind !== 'annual')) return false
		return activityAt(record, time, context.solarLongitude, table).state === 'active'
	})
	candidates.sort((a, b) => Number(b.visual !== undefined) - Number(a.visual !== undefined))

	const radiants: MeteorSkyRadiant[] = []
	for (const record of candidates) {
		if (radiants.length >= MAX_SKY_RADIANTS) break
		const state = meteorShowerState(preferredSolution(record)!, context, { includeMoon: false, includeSun: false, includeHorizontal: false, includeRadiantOfDate: false })
		if (state.radiantJ2000 === undefined) continue
		radiants.push({ id: record.id, ...(record.code && { code: record.code }), name: record.name, visual: record.visual !== undefined, ...state.radiantJ2000 })
	}

	return { time, radiants }
}

// Request of the geometric observing night of one shower.
export interface MeteorObservingRequest {
	// Site of the night.
	readonly site: PlanningSite
	// Civil date of the evening in the site's zone, YYYY-MM-DD.
	readonly eveningDate: string
	// Highest geometric solar altitude counted as dark enough, radians (−18° for astronomical darkness).
	readonly maximumSolarAltitude: number
	// Lowest geometric radiant altitude, radians.
	readonly minimumRadiantAltitude: number
	// Smallest Moon–radiant separation while the Moon is up, radians; absent to apply none.
	readonly minimumMoonSeparation?: number
	// Largest illuminated fraction of the Moon while it is up, [0, 1]; absent to apply none.
	readonly maximumMoonIllumination?: number
}

// Why a night has no observing window.
export type MeteorNoWindowReason = 'missingRadiant' | 'noSupportedActivity' | 'sunTooHigh' | 'radiantBelowThreshold' | 'moonConstraint' | 'insufficientData'

// Support the windows were judged against: the curated visual activity period, the IAU support, or none known.
export interface MeteorObservingSupport {
	// Source of the support; none when the windows only satisfy the geometry.
	readonly basis: 'imoVisual' | 'iauScientific' | 'none'
	// Solar longitudes of the support, radians; absent for none.
	readonly interval?: MeteorSolarLongitudeInterval
}

// One geometric observing window, with its instants in Unix milliseconds.
export interface MeteorObservingWindow {
	// First instant, Unix milliseconds.
	readonly start: number
	// Last instant, Unix milliseconds.
	readonly end: number
	// Instant of the highest radiant, Unix milliseconds.
	readonly bestTime: number
	// Geometric radiant altitude at bestTime, radians.
	readonly maximumRadiantAltitude: number
	// Integral of the sine of the radiant altitude over the window, hours: an opportunity measure, never a count.
	readonly radiantSineHours: number
	// Geometric solar altitude at bestTime, radians.
	readonly sunAltitudeAtBest: number
	// Geometric, geocentric lunar altitude at bestTime, radians.
	readonly moonAltitudeAtBest: number
	// Illuminated fraction of the Moon at bestTime, [0, 1].
	readonly moonIlluminationAtBest: number
	// Geocentric Moon–radiant separation at bestTime, radians.
	readonly moonRadiantSeparationAtBest: number
	// Whether the window lies inside a known support.
	readonly support: 'activity' | 'geometryOnly'
}

// One sample of the night chart.
export interface MeteorNightSample {
	// Instant, Unix milliseconds.
	readonly time: number
	// Geometric radiant altitude, radians; absent without a radiant.
	readonly radiantAltitude?: number
	// Geometric solar altitude, radians.
	readonly sunAltitude: number
	// Geometric, geocentric lunar altitude, radians.
	readonly moonAltitude: number
}

// The geometric observing night of one shower from a site. It carries no rate or count: the geometric windows need no
// activity profile and say nothing about how many meteors appear.
export interface MeteorObservingNight {
	// Kind of answer: geometric windows only.
	readonly kind: 'geometric'
	// Civil date of the evening.
	readonly eveningDate: string
	// The Astro Weather night: the Sun, the part shown, and the Moon.
	readonly night: AstroWeatherNight
	// Support the windows were judged against.
	readonly support: MeteorObservingSupport
	// Windows in chronological order.
	readonly windows: readonly MeteorObservingWindow[]
	// Why there is no window; empty when there are windows.
	readonly reasons: readonly MeteorNoWindowReason[]
	// Samples every NIGHT_SAMPLE_MS over the part of the night shown.
	readonly samples: readonly MeteorNightSample[]
}

// Spacing of the night chart's samples, milliseconds.
const NIGHT_SAMPLE_MS = 10 * 60000

// The support a shower's windows are judged against for the occurrence nearest to an instant: the visual activity period
// converted to solar longitudes when the shower has curated data, else its preferred solution's interval.
export function observingSupport(record: MeteorShowerRecord, solution: MeteorShowerSolution, time: number, table: MeteorSolarLongitudeTable): MeteorObservingSupport {
	if (record.visual !== undefined) {
		const year = new Date(time).getUTCFullYear()
		const occurrences = [year - 1, year, year + 1].map((candidate) => visualOccurrence(record.visual!, candidate, table))
		let nearest = occurrences[0]
		for (const occurrence of occurrences) if (distanceTo(occurrence, time) < distanceTo(nearest, time)) nearest = occurrence
		return { basis: 'imoVisual', interval: { start: meteorSolarLongitude(timeUnix(nearest.start / 1000, true)), end: meteorSolarLongitude(timeUnix(nearest.end / 1000, true)) } }
	}

	return solution.activityInterval === undefined ? { basis: 'none' } : { basis: 'iauScientific', interval: solution.activityInterval }
}

// Distance from an instant to a visual occurrence's period, milliseconds; 0 inside it.
function distanceTo(occurrence: MeteorVisualOccurrence, time: number) {
	return time < occurrence.start ? occurrence.start - time : time > occurrence.end ? time - occurrence.end : 0
}

// Converts a toolkit window to milliseconds.
function windowAnswer(window: MeteorGeometricObservingWindow): MeteorObservingWindow {
	return {
		start: timeToUnixMillis(window.start),
		end: timeToUnixMillis(window.end),
		bestTime: timeToUnixMillis(window.bestTime),
		maximumRadiantAltitude: window.maximumRadiantAltitude,
		radiantSineHours: window.radiantSineHours,
		sunAltitudeAtBest: window.sunAltitudeAtBest,
		moonAltitudeAtBest: window.moonAltitudeAtBest,
		moonIlluminationAtBest: window.moonIlluminationAtBest,
		moonRadiantSeparationAtBest: window.moonRadiantSeparationAtBest,
		support: window.support,
	}
}

// Geometric windows of a solution over a span, chronological.
export function geometricWindows(solution: MeteorShowerSolution, observer: SkyObserver, span: TimeSpan, options: MeteorGeometricObservingWindowOptions): readonly MeteorObservingWindow[] {
	return meteorGeometricObservingWindows(solution, geographic(observer), toolkitTime(span.start), toolkitTime(span.end), options).map(windowAnswer)
}

// Toolkit options of a request, with a support.
export function windowOptions(request: Omit<MeteorObservingRequest, 'site' | 'eveningDate'>, support: MeteorObservingSupport, moon = true): MeteorGeometricObservingWindowOptions {
	return {
		support: support.interval,
		maximumSolarAltitude: request.maximumSolarAltitude,
		minimumRadiantAltitude: request.minimumRadiantAltitude,
		...(moon && request.minimumMoonSeparation !== undefined && { minimumMoonRadiantSeparation: request.minimumMoonSeparation }),
		...(moon && request.maximumMoonIllumination !== undefined && { maximumMoonIllumination: request.maximumMoonIllumination }),
	}
}

// The geometric observing night of a shower: its windows over the whole night (upper transit to upper transit) of the
// evening, the samples of the part shown, and, without a window, why.
export function observingNight(record: MeteorShowerRecord, request: MeteorObservingRequest, nights: (request: AstroWeatherNightRequest) => AstroWeatherNight, table: MeteorSolarLongitudeTable): MeteorObservingNight {
	const night = resolveNight(nights, request.site, request.eveningDate)
	const solution = preferredSolution(record)
	const samples = nightSamples(solution, request.site, night.display)

	if (solution === undefined || solution.rightAscension === undefined || solution.declination === undefined) {
		return { kind: 'geometric', eveningDate: request.eveningDate, night, support: { basis: 'none' }, windows: [], reasons: ['missingRadiant'], samples }
	}

	const support = observingSupport(record, solution, (night.sun.start + night.sun.end) / 2, table)
	const windows = geometricWindows(solution, request.site, night.sun, windowOptions(request, support))
	const reasons = windows.length > 0 ? [] : noWindowReasons(solution, request, support, night, samples)
	return { kind: 'geometric', eveningDate: request.eveningDate, night, support, windows, reasons, samples }
}

// Why a night has no window: no radiant, no darkness, no support overlapping it, a radiant never high enough in the dark,
// or only the lunar constraints; else the samples could not tell.
function noWindowReasons(solution: MeteorShowerSolution, request: MeteorObservingRequest, support: MeteorObservingSupport, night: AstroWeatherNight, samples: readonly MeteorNightSample[]): readonly MeteorNoWindowReason[] {
	const reasons: MeteorNoWindowReason[] = []
	const dark = samples.filter((sample) => sample.sunAltitude <= request.maximumSolarAltitude)
	if (dark.length === 0) reasons.push('sunTooHigh')

	if (support.interval !== undefined) {
		const start = meteorSolarLongitude(toolkitTime(night.sun.start))
		const end = meteorSolarLongitude(toolkitTime(night.sun.end))
		if (!isMeteorShowerActive(support.interval, start) && !isMeteorShowerActive(support.interval, end)) reasons.push('noSupportedActivity')
	}

	if (dark.length > 0 && !dark.some((sample) => sample.radiantAltitude !== undefined && sample.radiantAltitude >= request.minimumRadiantAltitude)) reasons.push('radiantBelowThreshold')

	if (reasons.length === 0 && (request.minimumMoonSeparation !== undefined || request.maximumMoonIllumination !== undefined)) {
		if (geometricWindows(solution, request.site, night.sun, windowOptions(request, support, false)).length > 0) reasons.push('moonConstraint')
	}

	if (reasons.length === 0) reasons.push('insufficientData')
	return reasons
}

// Spacing of the Sun and Moon vectors interpolated for the night chart, milliseconds. The Moon moves about 0.55° an hour,
// so the chord between hourly geocentric vectors departs from its arc by under 0.001°, while one ELPMPP02 evaluation
// costs about 9 ms, far more than a sample of the chart can.
const EPHEMERIS_SPACING_MS = 3600000

// Samples of the radiant, the Sun, and the Moon every NIGHT_SAMPLE_MS over a span. The Sun and the Moon are the toolkit's
// geocentric J2000 vectors at whole hours, interpolated linearly; their altitudes are geometric and the Moon's geocentric.
function nightSamples(solution: MeteorShowerSolution | undefined, site: SkyObserver, span: TimeSpan): readonly MeteorNightSample[] {
	const observer = geographic(site)
	const firstHour = Math.floor(span.start / EPHEMERIS_SPACING_MS) * EPHEMERIS_SPACING_MS
	const hours: { readonly sun: Vec3; readonly moon: Vec3 }[] = []
	for (let hour = firstHour; hour <= span.end + EPHEMERIS_SPACING_MS; hour += EPHEMERIS_SPACING_MS) hours.push({ sun: meteorSunDirection(toolkitTime(hour)), moon: meteorMoonDirection(toolkitTime(hour)) })

	const samples: MeteorNightSample[] = []
	for (let time = span.start; time <= span.end; time += NIGHT_SAMPLE_MS) {
		const index = Math.floor((time - firstHour) / EPHEMERIS_SPACING_MS)
		const fraction = (time - firstHour - index * EPHEMERIS_SPACING_MS) / EPHEMERIS_SPACING_MS
		const instant = toolkitTime(time)
		const [before, after] = [hours[index], hours[index + 1]]
		const sun = vecLerp(before.sun, after.sun, fraction)
		const moon = vecLerp(before.moon, after.moon, fraction)
		const context = meteorShowerComputationContext(instant, observer, { includeHorizontal: true, includeSun: false, includeMoon: false })
		const altitude = solution === undefined ? undefined : meteorShowerState(solution, context, { includeHorizontal: true, includeSun: false, includeMoon: false, includeRadiantOfDate: false }).horizontal?.altitude
		samples.push({ time, ...(altitude !== undefined && { radiantAltitude: altitude }), sunAltitude: altitudeOf(sun, instant, observer), moonAltitude: altitudeOf(moon, instant, observer) })
	}
	return samples
}

// Linear interpolation between two vectors.
function vecLerp(a: Vec3, b: Vec3, fraction: number): Vec3 {
	return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, a[2] + (b[2] - a[2]) * fraction]
}

// Toolkit time of a Unix instant in milliseconds.
function toolkitTime(time: number): Time {
	return timeUnix(time / 1000, true)
}
