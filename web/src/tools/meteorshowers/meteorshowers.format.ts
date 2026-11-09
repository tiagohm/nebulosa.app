import type { MeteorActivityState, MeteorDataBasis, MeteorNoWindowReason, MeteorShowerGap, MeteorShowerOccurrence, MeteorShowerStatus, MeteorShowerSummary, MeteorSolutionSelection } from 'api'
import { AU_KM, DAYSEC } from 'nebulosa/src/core/constants'
import { formatDate, formatDateTime } from '../../format'
import type { StatusTone } from '../../ui/StatusBadge'

// Labels and formatting of the Meteor Showers tool: the names of the states, sources, and reasons the server answers,
// and the instant of a published maximum shown no more precisely than its published solar longitude allows. Pure.

// Name of each status of an IAU record.
export const STATUS_LABELS: Readonly<Record<MeteorShowerStatus, string>> = { established: 'Established', working: 'Working list', toBeEstablished: 'To be established', removed: 'Removed', unknown: 'Unknown status' }

// Name of each kind of activity of the preferred solution.
export const ACTIVITY_KIND_LABELS: Readonly<Record<MeteorShowerSummary['activityKind'], string>> = { annual: 'Annual', yearSpecific: 'Observed in given years', outburst: 'Outburst', variable: 'Variable', irregular: 'Irregular', unknown: 'Unknown activity' }

// Name and tone of each activity state.
export const ACTIVITY_LABELS: Readonly<Record<MeteorActivityState, { readonly label: string; readonly tone: StatusTone }>> = {
	active: { label: 'Active', tone: 'success' },
	inactive: { label: 'Not active', tone: 'neutral' },
	unknown: { label: 'Activity unknown', tone: 'warning' },
}

// Name of each source of a datum.
export const BASIS_LABELS: Readonly<Record<MeteorDataBasis, string>> = { iauScientific: 'IAU MDC', imoVisual: 'IMO visual', publishedActivityModel: 'Published activity model', publishedAnnualPrediction: 'Published prediction', nebulosaModel: 'Nebulosa model', observerGeometry: 'Observer geometry' }

// What each gap of the preferred solution means for the shower.
export const GAP_LABELS: Readonly<Record<MeteorShowerGap, string>> = {
	usableSolution: 'No solution with a radiant that is not removed: the shower is listed but cannot be located or planned.',
	radiant: 'No radiant position.',
	activityInterval: 'No published activity period: the activity is unknown outside the curated data.',
	drift: 'No radiant drift: the radiant is kept at its catalog position.',
	referenceSolarLongitude: 'No reference solar longitude.',
}

// How the preferred solution was chosen.
export const SELECTION_LABELS: Readonly<Record<MeteorSolutionSelection, string>> = {
	ranked: 'Chosen among several: annual first, then with an activity period, then with a drift, then the largest sample.',
	only: 'The only solution with a radiant that is not removed.',
	none: 'No solution has a radiant and is not removed.',
}

// Why a night has no window.
export const REASON_LABELS: Readonly<Record<MeteorNoWindowReason, string>> = {
	missingRadiant: 'The catalog gives no radiant for this shower.',
	noSupportedActivity: 'The shower is not active this night.',
	sunTooHigh: 'The Sun never goes as low as the darkness asked for.',
	radiantBelowThreshold: 'The radiant never rises above the lowest altitude while it is dark.',
	moonConstraint: 'Only the Moon constraint leaves no window.',
	noWindow: 'No stretch of the night is dark enough with the radiant high enough.',
	insufficientData: 'No window, for a reason the samples cannot tell.',
}

// Decimals of the published maximum below which only the date is meaningful.
const DATE_ONLY_DECIMALS = 0

// Instant of a maximum published with `decimals` decimals of solar longitude, as precisely as they allow: the date with
// a ± day for whole degrees, else the date and time (to the hour for one decimal).
export function formatPeak(time: number, decimals: number, timeZone: string): string {
	if (decimals <= DATE_ONLY_DECIMALS) return `${formatDate(time, timeZone)} (± 1 day)`
	if (decimals === 1) return `${formatDateTime(time, timeZone, false).slice(0, -3)}h (± 2 h)`
	return formatDateTime(time, timeZone, false)
}

// Solar longitude, degrees with the given decimals and the sign λ☉.
export function formatSolarLongitude(radians: number, decimals: number = 1) {
	return `λ☉ ${((radians * 180) / Math.PI).toFixed(decimals)}°`
}

// Instant that stands for an occurrence when listing it: the visual maximum, else the IAU reference, else its start.
export function occurrenceInstant(occurrence: MeteorShowerOccurrence | undefined): number | undefined {
	return occurrence?.visual?.peak ?? occurrence?.iau?.reference ?? occurrence?.iau?.start
}

// Short text of the period of an occurrence: the visual one when there is one, else the IAU support, else the IAU
// reference only.
export function formatOccurrencePeriod(occurrence: MeteorShowerOccurrence | undefined, timeZone: string): string {
	// The IMO publishes its activity periods as calendar days, so they are shown as such, never shifted by a zone.
	if (occurrence?.visual) return `${formatDate(occurrence.visual.start, 'UTC')} to ${formatDate(occurrence.visual.end, 'UTC')}`
	const iau = occurrence?.iau
	if (iau?.start !== undefined && iau.end !== undefined) return `${formatDate(iau.start, timeZone)} to ${formatDate(iau.end, timeZone)}`
	if (iau?.reference !== undefined) return `around ${formatDate(iau.reference, timeZone)}`
	return '—'
}

// Short text of the maximum of an occurrence: the published visual maximum, else the IAU mean reference, named as such.
export function formatOccurrencePeak(occurrence: MeteorShowerOccurrence | undefined, timeZone: string): string {
	if (occurrence?.visual) return `Maximum ${formatPeak(occurrence.visual.peak, occurrence.visual.peakSolarLongitudeDecimals, timeZone)}`
	if (occurrence?.iau?.reference !== undefined) return `IAU reference ${formatDate(occurrence.iau.reference, timeZone)} (mean, not a maximum)`
	return 'Maximum unknown'
}

// Geocentric speed in km/s of an AU/day speed.
export function kilometersPerSecond(auPerDay: number) {
	return (auPerDay * AU_KM) / DAYSEC
}
