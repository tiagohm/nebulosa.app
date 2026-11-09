import { altitudeOf } from 'nebulosa/src/astronomy/events/horizon'
import { isMeteorShowerActive, meteorActivityZhr, meteorShowerActivityYearApplies } from 'nebulosa/src/astronomy/meteors/activity'
import { meteorLocalHourlyRate, meteorMoonDirection, meteorSunDirection } from 'nebulosa/src/astronomy/meteors/observation'
import { meteorGeometricObservingWindows, meteorObservingWindows } from 'nebulosa/src/astronomy/meteors/planner'
import { meteorSolarLongitude } from 'nebulosa/src/astronomy/meteors/solar'
import { meteorShowerComputationContext, meteorShowerState, meteorShowerStates } from 'nebulosa/src/astronomy/meteors/state'
import type { MeteorExponentialActivityProfile, MeteorGeometricObservingWindow, MeteorGeometricObservingWindowOptions, MeteorShowerSolution, MeteorSolarLongitudeInterval, MeteorVisualObservation } from 'nebulosa/src/astronomy/meteors/types'
import { type Time, timeToUnixMillis, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import type { Vec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { normalizeAngle } from 'nebulosa/src/math/units/angle'
import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import { type MeteorShowerRecord, preferredSolution } from './meteorshowers.catalog'
import type { MeteorSolarLongitudeTable } from './meteorshowers.solar'
import type { MeteorActivityProfileEntry, MeteorDataBasis, MeteorVisualEntry, MeteorVisualSourceId } from './meteorshowers.visual'
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
	// Whether the instant is more than MAX_DRIFT_DAYS from the reference longitude, so the radiant is the catalog position
	// at the reference, not moved by the drift.
	readonly radiantAtReference?: boolean
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

// Farthest a radiant is moved by its daily drift from its reference longitude, days: about the half-width of a long
// activity period (the Perseids span ±30 days). Beyond it, outside any activity, a linear drift no longer says where the
// radiant is, so the catalog position at the reference is given instead, said so.
export const MAX_DRIFT_DAYS = 30

// The state of a batch of showers at one instant: one toolkit context (the Sun, the Moon, the sidereal time) shared by
// every radiant through meteorShowerStates. Showers without a usable solution keep their activity and have no radiant.
export function meteorShowerStatesAt(records: readonly MeteorShowerRecord[], request: MeteorShowerStatesRequest, table: MeteorSolarLongitudeTable): MeteorShowerStates {
	const time = timeUnix(request.time / 1000, true)
	const observer = request.observer === undefined ? undefined : geographic(request.observer)
	const context = meteorShowerComputationContext(time, observer, { includeHorizontal: observer !== undefined, includeSun: observer !== undefined, includeMoon: true })
	const withSolution = records.filter((record) => preferredSolution(record) !== undefined)
	const options = { includeHorizontal: observer !== undefined, includeSun: observer !== undefined, includeMoon: true, includeRadiantOfDate: true, maxExtrapolationDays: MAX_DRIFT_DAYS }
	const states = meteorShowerStates(
		withSolution.map((record) => ({ solution: preferredSolution(record)! })),
		context,
		options,
	)
	const byId = new Map(withSolution.map((record, index) => [record.id, states[index]]))
	// A radiant beyond its drift falls back to its catalog position, the solution without the drift.
	const beyondDrift = withSolution.filter((record, index) => states[index].radiantJ2000 === undefined && preferredSolution(record)!.radiantDrift !== undefined)
	const atReference = meteorShowerStates(
		beyondDrift.map((record) => ({ solution: { ...preferredSolution(record)!, radiantDrift: undefined } })),
		context,
		options,
	)
	for (const [index, record] of beyondDrift.entries()) byId.set(record.id, atReference[index])
	const referenceIds = new Set(beyondDrift.map((record) => record.id))

	const showers = records.map((record): MeteorShowerStateEntry => {
		const { state: activity, basis: activityBasis } = activityAt(record, request.time, context.solarLongitude, table)
		const state = byId.get(record.id)
		return {
			id: record.id,
			activity,
			activityBasis,
			...(state?.radiantJ2000 && { radiantJ2000: state.radiantJ2000, radiantExtrapolated: state.radiantExtrapolated }),
			...(referenceIds.has(record.id) && { radiantAtReference: true }),
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
		const state = meteorShowerState(preferredSolution(record)!, context, { includeMoon: false, includeSun: false, includeHorizontal: false, includeRadiantOfDate: false, maxExtrapolationDays: MAX_DRIFT_DAYS })
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
	// Observing assumptions of the local rate; absent for the geometric night only. They are used only when the shower has
	// a published activity profile.
	readonly assumptions?: MeteorRateAssumptions
}

// Assumptions of a visual observer the local hourly rate is modelled for. None of them is known from the sky: they are
// stated by the operator and returned with every modelled value.
export interface MeteorRateAssumptions {
	// Limiting magnitude of the observer's sky.
	readonly limitingMagnitude: number
	// Fraction of the field of view obstructed (clouds, trees, buildings), [0, 1).
	readonly obstructedFraction: number
	// Population index r; absent to use the one the profile's source gives.
	readonly populationIndex?: number
}

// The rate model of a modelled night: its activity profile, the assumptions as applied, and the windows of the
// profile-based planner with their counts.
export interface MeteorRateModel {
	// Source of the activity profile.
	readonly sourceId: MeteorVisualSourceId
	// Kind of datum of the profile.
	readonly basis: 'publishedActivityModel'
	// Limiting magnitude assumed.
	readonly limitingMagnitude: number
	// Population index used, and whether it is the operator's or the profile's.
	readonly populationIndex: number
	readonly populationIndexSource: 'assumption' | 'profile'
	// Obstruction correction F = 1 / (1 − obstructed fraction).
	readonly obstructionCorrection: number
	// Exponent of the sine of the radiant altitude.
	readonly altitudeExponent: number
	// Windows of the profile-based planner, chronologically.
	readonly windows: readonly MeteorModelledWindow[]
}

// One window of the profile-based planner: the same constraints, bounded by the profile's support.
export interface MeteorModelledWindow {
	// First instant, Unix milliseconds.
	readonly start: number
	// Last instant, Unix milliseconds.
	readonly end: number
	// Expected count over the window under the assumptions, meteors: a model, never a forecast of what will be seen.
	readonly expectedCount: number
	// Instant of the highest modelled local hourly rate, Unix milliseconds.
	readonly bestTime: number
	// Highest modelled local hourly rate, meteors per hour.
	readonly bestLocalHourlyRate: number
	// Highest profile ZHR sampled in the window, meteors per hour.
	readonly maximumZhr?: number
}

// Why a night has no observing window.
export type MeteorNoWindowReason = 'missingRadiant' | 'noSupportedActivity' | 'sunTooHigh' | 'radiantBelowThreshold' | 'moonConstraint' | 'noWindow' | 'insufficientData'

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
	// ZHR of the activity profile at the sample, meteors per hour; only in a modelled night.
	readonly zhr?: number
	// Modelled local hourly rate at the sample under the assumptions, meteors per hour; only in a modelled night.
	readonly localRate?: number
}

// The observing night of one shower from a site. The geometric windows need no activity profile and say nothing about how
// many meteors appear; a modelled night adds the rate model of a published profile under stated assumptions.
export interface MeteorObservingNight {
	// Kind of answer: geometric windows only, or with the rate model.
	readonly kind: 'geometric' | 'modelled'
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
	// Rate model; only in a modelled night.
	readonly model?: MeteorRateModel
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

// The observing night of a shower: its geometric windows over the whole night (upper transit to upper transit) of the
// evening, the samples of the part shown, and, without a window, why. With assumptions and a published activity profile,
// the night is modelled too: the profile-based planner's windows with their expected counts, and the profile ZHR and the
// local rate at each sample.
export function observingNight(record: MeteorShowerRecord, request: MeteorObservingRequest, nights: (request: AstroWeatherNightRequest) => AstroWeatherNight, table: MeteorSolarLongitudeTable): MeteorObservingNight {
	const night = resolveNight(nights, request.site, request.eveningDate)
	const solution = preferredSolution(record)
	const located = solution !== undefined && solution.rightAscension !== undefined && solution.declination !== undefined
	const rate = located && request.assumptions !== undefined && record.profile !== undefined ? prepareRate(record.profile, request.assumptions) : undefined
	const samples = nightSamples(solution, request.site, night.display, rate)

	if (!located) return { kind: 'geometric', eveningDate: request.eveningDate, night, support: { basis: 'none' }, windows: [], reasons: ['missingRadiant'], samples }

	const support = observingSupport(record, solution, (night.sun.start + night.sun.end) / 2, table)
	const windows = geometricWindows(solution, request.site, night.sun, windowOptions(request, support))
	const reasons = windows.length > 0 ? [] : noWindowReasons(solution, request, support, night, samples)
	if (rate === undefined) return { kind: 'geometric', eveningDate: request.eveningDate, night, support, windows, reasons, samples }
	return { kind: 'modelled', eveningDate: request.eveningDate, night, support, windows, reasons, samples, model: { ...rateSummary(rate), windows: modelledWindows(solution, rate, request, night.sun) } }
}

// Lowest ZHR of a profile's support, meteors per hour: the profile is taken as zero where its model falls below one meteor
// an hour, which bounds the support of an exponential that never reaches zero.
const MINIMUM_PROFILE_ZHR = 1

// The toolkit profile of a published double exponential, its support where the model ZHR is at least MINIMUM_PROFILE_ZHR.
export function activityProfileOf(entry: MeteorActivityProfileEntry): MeteorExponentialActivityProfile {
	const peak = entry.peakSolarLongitude * DEG2RAD
	const decades = Math.log10(entry.zhr / MINIMUM_PROFILE_ZHR)
	return {
		type: 'exponential',
		support: { start: normalizeAngle(peak - (decades / entry.slopeBefore) * DEG2RAD), end: normalizeAngle(peak + (decades / entry.slopeAfter) * DEG2RAD) },
		solarLongitude: peak,
		zhr: entry.zhr,
		slopeBefore: entry.slopeBefore,
		slopeAfter: entry.slopeAfter,
	}
}

// A rate model ready to evaluate: the profile and the observation the assumptions describe.
interface PreparedRate {
	// Published parameters of the profile.
	readonly entry: MeteorActivityProfileEntry
	// Toolkit profile of the parameters.
	readonly profile: MeteorExponentialActivityProfile
	// The observation the assumptions describe; its count, effective time, and radiant altitude are unused.
	readonly observation: MeteorVisualObservation
	// Whether the population index is the operator's or the profile's.
	readonly populationIndexSource: 'assumption' | 'profile'
}

// Exponent of the sine of the radiant altitude in the local rate, the standard 1.
const ALTITUDE_EXPONENT = 1

// Largest obstructed fraction of the field, below which the correction F = 1 / (1 − fraction) stays finite.
const MAXIMUM_OBSTRUCTED_FRACTION = 0.99

// Prepares the rate model of a profile under the operator's assumptions.
function prepareRate(entry: MeteorActivityProfileEntry, assumptions: MeteorRateAssumptions): PreparedRate {
	const obstructed = Math.min(MAXIMUM_OBSTRUCTED_FRACTION, Math.max(0, assumptions.obstructedFraction))
	const observation: MeteorVisualObservation = { count: 0, effectiveTime: 1, limitingMagnitude: assumptions.limitingMagnitude, populationIndex: assumptions.populationIndex ?? entry.populationIndex, obstructionCorrection: 1 / (1 - obstructed), radiantAltitude: 0, altitudeExponent: ALTITUDE_EXPONENT }
	return { entry, profile: activityProfileOf(entry), observation, populationIndexSource: assumptions.populationIndex === undefined ? 'profile' : 'assumption' }
}

// The rate model as applied, without its windows.
function rateSummary(rate: PreparedRate): Omit<MeteorRateModel, 'windows'> {
	const { observation } = rate
	return { sourceId: rate.entry.sourceId, basis: 'publishedActivityModel', limitingMagnitude: observation.limitingMagnitude, populationIndex: observation.populationIndex, populationIndexSource: rate.populationIndexSource, obstructionCorrection: observation.obstructionCorrection, altitudeExponent: ALTITUDE_EXPONENT }
}

// The profile-based planner's windows of a span: the request's constraints, bounded by the profile's support alone (the
// catalog interval is left out, so the model decides where the shower is active), chronologically.
function modelledWindows(solution: MeteorShowerSolution, rate: PreparedRate, request: Omit<MeteorObservingRequest, 'eveningDate'>, span: TimeSpan): readonly MeteorModelledWindow[] {
	const { observation } = rate
	const windows = meteorObservingWindows({ ...solution, activityInterval: undefined }, rate.profile, geographic(request.site), toolkitTime(span.start), toolkitTime(span.end), {
		maximumSolarAltitude: request.maximumSolarAltitude,
		minimumRadiantAltitude: request.minimumRadiantAltitude,
		...(request.minimumMoonSeparation !== undefined && { minimumMoonRadiantSeparation: request.minimumMoonSeparation }),
		...(request.maximumMoonIllumination !== undefined && { maximumMoonIllumination: request.maximumMoonIllumination }),
		limitingMagnitude: observation.limitingMagnitude,
		populationIndex: observation.populationIndex,
		obstructionCorrection: observation.obstructionCorrection,
		altitudeExponent: ALTITUDE_EXPONENT,
	})

	return windows
		.map((window): MeteorModelledWindow => ({
			start: timeToUnixMillis(window.start),
			end: timeToUnixMillis(window.end),
			expectedCount: window.expectedCount,
			bestTime: timeToUnixMillis(window.bestTime ?? window.start),
			bestLocalHourlyRate: window.bestLocalHourlyRate,
			maximumZhr: window.maximumZhr,
		}))
		.sort((a, b) => a.start - b.start)
}

// Request of the activity curve of one shower.
export interface MeteorActivityRequest {
	// Civil UTC year of the maximum shown.
	readonly year: number
}

// One sample of an activity curve.
export interface MeteorActivitySample {
	// Instant, Unix milliseconds.
	readonly time: number
	// Solar longitude, radians.
	readonly solarLongitude: number
	// ZHR of the profile, meteors per hour.
	readonly zhr: number
}

// A published activity profile dated in a year, with its curve.
export interface MeteorActivityProfileCurve {
	// Source of the parameters.
	readonly sourceId: MeteorVisualSourceId
	// Kind of datum.
	readonly basis: 'publishedActivityModel'
	// Solar longitude of the maximum, radians, J2000.
	readonly peakSolarLongitude: number
	// Instant of the maximum in the year, Unix milliseconds.
	readonly peakTime: number
	// ZHR at the maximum, meteors per hour.
	readonly zhr: number
	// Rise exponent before the maximum, per degree.
	readonly slopeBefore: number
	// Decay exponent after the maximum, per degree.
	readonly slopeAfter: number
	// Population index the source gives.
	readonly populationIndex: number
	// Support where the model ZHR is at least one meteor an hour, radians.
	readonly support: MeteorSolarLongitudeInterval
	// Samples over the support, chronologically.
	readonly samples: readonly MeteorActivitySample[]
}

// The activity curve of one shower in a year: the published profile sampled over its support, and the published visual
// maximum apart. Without a profile there is no curve, and nothing is interpolated from the visual maximum alone.
export interface MeteorActivityCurve {
	// Civil UTC year.
	readonly year: number
	// The profile and its curve; absent when none is curated (reason noActivityProfile).
	readonly profile?: MeteorActivityProfileCurve
	// The published visual occurrence of the year, for its maximum and typical ZHR; absent without visual data.
	readonly visual?: MeteorVisualOccurrence
	// Why there is no curve.
	readonly reason?: 'noActivityProfile'
}

// Samples of an activity curve.
export const ACTIVITY_SAMPLES = 241

// Mean length of a year, milliseconds, to place a longitude on the turn of its maximum.
const YEAR_MS = 365.25 * 86400000

// The activity curve of a shower in a civil year: the profile's maximum nearest to the middle of the year's visual
// occurrence (else the middle of the year), and ACTIVITY_SAMPLES samples evenly spaced in solar longitude over the support,
// each dated by its crossing nearest to the maximum.
export function activityCurve(record: MeteorShowerRecord, request: MeteorActivityRequest, table: MeteorSolarLongitudeTable): MeteorActivityCurve {
	const visual = record.visual === undefined ? undefined : visualOccurrence(record.visual, request.year, table)
	if (record.profile === undefined) return { year: request.year, ...(visual && { visual }), reason: 'noActivityProfile' }

	const entry = record.profile
	const profile = activityProfileOf(entry)
	const anchor = visual === undefined ? Date.UTC(request.year, 6, 1) : (visual.start + visual.end) / 2
	const peakTime = table.nearest(anchor, profile.solarLongitude)
	const width = normalizeAngle(profile.support.end - profile.support.start)
	const before = normalizeAngle(profile.solarLongitude - profile.support.start)
	const samples: MeteorActivitySample[] = []

	for (let i = 0; i < ACTIVITY_SAMPLES; i++) {
		const offset = (width * i) / (ACTIVITY_SAMPLES - 1)
		const solarLongitude = normalizeAngle(profile.support.start + offset)
		const estimate = peakTime + ((offset - before) / (2 * Math.PI)) * YEAR_MS
		samples.push({ time: table.nearest(estimate, solarLongitude), solarLongitude, zhr: meteorActivityZhr(profile, solarLongitude) })
	}

	return {
		year: request.year,
		profile: { sourceId: entry.sourceId, basis: 'publishedActivityModel', peakSolarLongitude: profile.solarLongitude, peakTime, zhr: entry.zhr, slopeBefore: entry.slopeBefore, slopeAfter: entry.slopeAfter, populationIndex: entry.populationIndex, support: profile.support, samples },
		...(visual && { visual }),
	}
}

// Request of the ranking of the nights of a period.
export interface MeteorNightsRequest extends Omit<MeteorObservingRequest, 'eveningDate'> {
	// Civil date of the first evening in the site's zone, YYYY-MM-DD.
	readonly startEveningDate: string
	// Evenings ranked, 1 to MAX_RANKED_NIGHTS.
	readonly nights: number
}

// One night of a ranking.
export interface MeteorRankedNight {
	// Civil date of the evening.
	readonly eveningDate: string
	// Whether the night has a window.
	readonly eligible: boolean
	// Total length of the windows, hours.
	readonly windowHours: number
	// Integral of the sine of the radiant altitude over the windows, hours: the geometric suitability the ranking uses
	// without a model, never a count.
	readonly radiantSineHours: number
	// Highest radiant altitude in a window, radians; absent without a window.
	readonly maximumRadiantAltitude?: number
	// Illuminated fraction of the Moon in the middle of the night's display, [0, 1].
	readonly moonIllumination: number
	// Illuminated fraction of the Moon at the best instant of the longest window; absent without a window.
	readonly moonIlluminationAtBest?: number
	// Expected count over the night's modelled windows, meteors; only in a modelled ranking.
	readonly expectedCount?: number
	// Why the night has no window; empty when it has one.
	readonly reasons: readonly MeteorNoWindowReason[]
}

// Ranking of the nights of a period, best first.
export interface MeteorNightRanking {
	// Kind of ranking: by geometric suitability, or by modelled count.
	readonly kind: 'geometric' | 'modelled'
	// The nights, best first: eligible ones, then by modelled count (modelled) or geometric suitability, then by window
	// length, then by evening.
	readonly nights: readonly MeteorRankedNight[]
	// Rate model applied, without windows; only in a modelled ranking.
	readonly model?: Omit<MeteorRateModel, 'windows'>
}

// Most evenings one ranking may span.
export const MAX_RANKED_NIGHTS = 31

// Civil date `days` after a YYYY-MM-DD date.
function addDays(date: string, days: number) {
	const [year, month, day] = date.split('-').map(Number)
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

// Orders ranked nights, best first.
function compareNights(modelled: boolean) {
	return (a: MeteorRankedNight, b: MeteorRankedNight) => Number(b.eligible) - Number(a.eligible) || (modelled ? (b.expectedCount ?? 0) - (a.expectedCount ?? 0) : b.radiantSineHours - a.radiantSineHours) || b.windowHours - a.windowHours || a.eveningDate.localeCompare(b.eveningDate)
}

// Ranks the nights of a period from a site, one after the other, yielding to the event loop between nights and stopping
// when the request is aborted. A night whose support does not meet it is not searched. Returns undefined when aborted.
export async function rankNights(record: MeteorShowerRecord, request: MeteorNightsRequest, nights: (request: AstroWeatherNightRequest) => AstroWeatherNight, table: MeteorSolarLongitudeTable, signal?: AbortSignal): Promise<MeteorNightRanking | undefined> {
	const solution = preferredSolution(record)
	const located = solution !== undefined && solution.rightAscension !== undefined && solution.declination !== undefined
	const rate = located && request.assumptions !== undefined && record.profile !== undefined ? prepareRate(record.profile, request.assumptions) : undefined
	const count = Math.min(MAX_RANKED_NIGHTS, Math.max(1, Math.floor(request.nights)))
	const ranked: MeteorRankedNight[] = []

	for (let i = 0; i < count; i++) {
		if (signal?.aborted) return undefined
		const eveningDate = addDays(request.startEveningDate, i)
		const night = resolveNight(nights, request.site, eveningDate)
		const moonIllumination = night.moon.illuminatedFraction
		const unsearched = (reason: MeteorNoWindowReason): MeteorRankedNight => ({ eveningDate, eligible: false, windowHours: 0, radiantSineHours: 0, moonIllumination, reasons: [reason] })

		if (!located) {
			ranked.push(unsearched('missingRadiant'))
			continue
		}

		const support = observingSupport(record, solution, (night.sun.start + night.sun.end) / 2, table)
		const interval = support.interval

		if (interval !== undefined && !isMeteorShowerActive(interval, meteorSolarLongitude(toolkitTime(night.sun.start))) && !isMeteorShowerActive(interval, meteorSolarLongitude(toolkitTime(night.sun.end)))) {
			ranked.push(unsearched('noSupportedActivity'))
			continue
		}

		const windows = geometricWindows(solution, request.site, night.sun, windowOptions(request, support))
		let longest: MeteorObservingWindow | undefined
		for (const window of windows) if (longest === undefined || window.end - window.start > longest.end - longest.start) longest = window
		const modelled = rate === undefined ? undefined : modelledWindows(solution, rate, request, night.sun)

		let windowHours = 0
		let radiantSineHours = 0
		for (const window of windows) {
			windowHours += (window.end - window.start) / 3600000
			radiantSineHours += window.radiantSineHours
		}
		let expectedCount = 0
		for (const window of modelled ?? []) expectedCount += window.expectedCount

		ranked.push({
			eveningDate,
			eligible: windows.length > 0,
			windowHours,
			radiantSineHours,
			...(windows.length > 0 && { maximumRadiantAltitude: Math.max(...windows.map((window) => window.maximumRadiantAltitude)) }),
			moonIllumination,
			...(longest && { moonIlluminationAtBest: longest.moonIlluminationAtBest }),
			...(modelled && { expectedCount }),
			reasons: windows.length > 0 ? [] : ['noWindow'],
		})

		await Bun.sleep(0)
	}

	ranked.sort(compareNights(rate !== undefined))
	return { kind: rate === undefined ? 'geometric' : 'modelled', nights: ranked, ...(rate && { model: rateSummary(rate) }) }
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

// Samples of the radiant, the Sun, and the Moon every NIGHT_SAMPLE_MS over a span, with the profile ZHR and the modelled
// local rate when a rate model is given. The Sun and the Moon are the toolkit's geocentric J2000 vectors at whole hours,
// interpolated linearly; their altitudes are geometric and the Moon's geocentric.
function nightSamples(solution: MeteorShowerSolution | undefined, site: SkyObserver, span: TimeSpan, rate?: PreparedRate): readonly MeteorNightSample[] {
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
		const zhr = rate === undefined ? undefined : meteorActivityZhr(rate.profile, context.solarLongitude)
		const localRate = rate === undefined || zhr === undefined || altitude === undefined ? undefined : meteorLocalHourlyRate(zhr, { ...rate.observation, radiantAltitude: altitude })
		samples.push({ time, ...(altitude !== undefined && { radiantAltitude: altitude }), sunAltitude: altitudeOf(sun, instant, observer), moonAltitude: altitudeOf(moon, instant, observer), ...(zhr !== undefined && { zhr }), ...(localRate !== undefined && { localRate }) })
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
