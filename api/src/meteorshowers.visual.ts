// Curated visual data of the Meteor Showers tool: a small, attributed subset of the Working List of Visual Meteor Showers
// of the International Meteor Organization, reviewed by hand and released with the application, never downloaded,
// scraped, or edited at run time. It is an independent source beside the IAU Meteor Data Center catalog: an entry names
// its shower by IAU number and adds only what the IMO publishes for visual observers (the activity period, the solar
// longitude of the maximum, the typical ZHR, and the population index), with its edition. Nothing here is merged into an
// IAU solution, and a shower the subset does not list has no visual data, never a ZHR of 0. The IMO grants this use with
// credit and edition; the subset is deliberately not the full Working List, which is not republished.

// Kind of a datum, kept with it so a computed value never passes for an observed one.
export type MeteorDataBasis = 'iauScientific' | 'imoVisual' | 'publishedActivityModel' | 'publishedAnnualPrediction' | 'nebulosaModel' | 'observerGeometry'

// Publication a curated record comes from.
export interface MeteorVisualSource {
	// Stable id of the source.
	readonly id: MeteorVisualSourceId
	// Title of the publication and the part read.
	readonly title: string
	// Who publishes it.
	readonly publisher: string
	// Edition of the publication, such as 2026.
	readonly edition: string
	// Where it can be read.
	readonly url: string
}

// Ids of the curated sources.
export type MeteorVisualSourceId = 'imo2026' | 'imo2027' | 'moorhead2019'

// A day of the civil calendar, as the IMO publishes activity periods.
export interface MeteorCalendarDay {
	// Month, 1 to 12.
	readonly month: number
	// Day of the month, 1 to 31.
	readonly day: number
}

// One shower of the curated visual subset: the recurring values the IMO Working List gives for it.
export interface MeteorVisualEntry {
	// IAU number of the shower, which links the entry to the IAU catalog.
	readonly number: number
	// IAU three-letter code.
	readonly code: string
	// Name as the IMO lists it.
	readonly name: string
	// First day of the activity period, inclusive.
	readonly activityStart: MeteorCalendarDay
	// Last day of the activity period, inclusive; in the next year when it comes before the first day.
	readonly activityEnd: MeteorCalendarDay
	// Solar longitude of the maximum as published, degrees, equinox J2000.0.
	readonly peakSolarLongitude: number
	// Decimals the solar longitude of the maximum is published with: 0 is about a day, 1 about two hours, 2 about 15 minutes.
	readonly peakSolarLongitudeDecimals: number
	// Zenithal hourly rate at the maximum based on recent returns, meteors per hour; absent when the IMO gives it as variable.
	readonly typicalZhr?: number
	// Population index r.
	readonly populationIndex: number
	// Atmospheric entry speed V∞, km/s.
	readonly velocity: number
	// Source of the values.
	readonly sourceId: MeteorVisualSourceId
}

// The curated sources, by id.
export const METEOR_VISUAL_SOURCES: Readonly<Record<MeteorVisualSourceId, MeteorVisualSource>> = {
	imo2026: { id: 'imo2026', title: 'Meteor Shower Calendar 2026, Table 5: Working List of Visual Meteor Showers', publisher: 'International Meteor Organization', edition: '2026', url: 'https://www.imo.net/files/meteor-shower/cal2026.pdf' },
	imo2027: { id: 'imo2027', title: 'Meteor Shower Calendar 2027', publisher: 'International Meteor Organization', edition: '2027', url: 'https://www.imo.net/files/meteor-shower/cal2027.pdf' },
	moorhead2019: { id: 'moorhead2019', title: 'Meteor shower forecasting in near-Earth space, Table 5: activity parameters of the NASA Meteoroid Environment Office forecast', publisher: 'A. V. Moorhead, A. Egal, P. G. Brown, D. E. Moser, and W. J. Cooke', edition: '2019', url: 'https://arxiv.org/abs/1904.06370' },
}

// Revision of the curated data, raised by every release that changes it; part of every cache key built from it.
export const METEOR_VISUAL_REVISION = 1

// Civil years whose year-specific IMO notes were curated; any other year shows the recurring baseline only, said so.
export const METEOR_ANNUAL_PREDICTION_YEARS: readonly number[] = [2026, 2027]

// The recurring baseline, Table 5 of the IMO Meteor Shower Calendar 2026 (correct to June 2025): activity period, solar
// longitude of the maximum (equinox J2000.0), ZHR based on recent returns, population index, and entry speed. The dates of
// the maximum the table gives hold for 2026 only, so the maximum is kept as the solar longitude and dated for each year.
export const METEOR_VISUAL_ENTRIES: readonly MeteorVisualEntry[] = [
	{ number: 10, code: 'QUA', name: 'Quadrantids', activityStart: { month: 12, day: 28 }, activityEnd: { month: 1, day: 12 }, peakSolarLongitude: 283.15, peakSolarLongitudeDecimals: 2, typicalZhr: 80, populationIndex: 2.1, velocity: 41, sourceId: 'imo2026' },
	{ number: 6, code: 'LYR', name: 'April Lyrids', activityStart: { month: 4, day: 14 }, activityEnd: { month: 4, day: 30 }, peakSolarLongitude: 32.32, peakSolarLongitudeDecimals: 2, typicalZhr: 18, populationIndex: 2.1, velocity: 49, sourceId: 'imo2026' },
	{ number: 31, code: 'ETA', name: 'η-Aquariids', activityStart: { month: 4, day: 19 }, activityEnd: { month: 5, day: 28 }, peakSolarLongitude: 45.5, peakSolarLongitudeDecimals: 1, typicalZhr: 50, populationIndex: 2.4, velocity: 66, sourceId: 'imo2026' },
	{ number: 1, code: 'CAP', name: 'α-Capricornids', activityStart: { month: 7, day: 3 }, activityEnd: { month: 8, day: 15 }, peakSolarLongitude: 128, peakSolarLongitudeDecimals: 0, typicalZhr: 5, populationIndex: 2.5, velocity: 23, sourceId: 'imo2026' },
	{ number: 5, code: 'SDA', name: 'Southern δ-Aquariids', activityStart: { month: 7, day: 12 }, activityEnd: { month: 8, day: 23 }, peakSolarLongitude: 128, peakSolarLongitudeDecimals: 0, typicalZhr: 25, populationIndex: 2.5, velocity: 41, sourceId: 'imo2026' },
	{ number: 7, code: 'PER', name: 'Perseids', activityStart: { month: 7, day: 17 }, activityEnd: { month: 8, day: 24 }, peakSolarLongitude: 140, peakSolarLongitudeDecimals: 1, typicalZhr: 100, populationIndex: 2.2, velocity: 59, sourceId: 'imo2026' },
	{ number: 9, code: 'DRA', name: 'Draconids', activityStart: { month: 10, day: 6 }, activityEnd: { month: 10, day: 10 }, peakSolarLongitude: 195.4, peakSolarLongitudeDecimals: 1, typicalZhr: 5, populationIndex: 2.6, velocity: 20, sourceId: 'imo2026' },
	{ number: 8, code: 'ORI', name: 'Orionids', activityStart: { month: 10, day: 2 }, activityEnd: { month: 11, day: 7 }, peakSolarLongitude: 208, peakSolarLongitudeDecimals: 0, typicalZhr: 20, populationIndex: 2.5, velocity: 66, sourceId: 'imo2026' },
	{ number: 2, code: 'STA', name: 'Southern Taurids', activityStart: { month: 9, day: 20 }, activityEnd: { month: 11, day: 20 }, peakSolarLongitude: 223, peakSolarLongitudeDecimals: 0, typicalZhr: 7, populationIndex: 2.3, velocity: 27, sourceId: 'imo2026' },
	{ number: 17, code: 'NTA', name: 'Northern Taurids', activityStart: { month: 10, day: 20 }, activityEnd: { month: 12, day: 10 }, peakSolarLongitude: 230, peakSolarLongitudeDecimals: 0, typicalZhr: 5, populationIndex: 2.3, velocity: 29, sourceId: 'imo2026' },
	{ number: 13, code: 'LEO', name: 'Leonids', activityStart: { month: 11, day: 6 }, activityEnd: { month: 11, day: 30 }, peakSolarLongitude: 235.27, peakSolarLongitudeDecimals: 2, typicalZhr: 15, populationIndex: 2.5, velocity: 71, sourceId: 'imo2026' },
	{ number: 4, code: 'GEM', name: 'Geminids', activityStart: { month: 12, day: 4 }, activityEnd: { month: 12, day: 20 }, peakSolarLongitude: 262.2, peakSolarLongitudeDecimals: 1, typicalZhr: 150, populationIndex: 2.6, velocity: 35, sourceId: 'imo2026' },
	{ number: 15, code: 'URS', name: 'Ursids', activityStart: { month: 12, day: 17 }, activityEnd: { month: 12, day: 26 }, peakSolarLongitude: 270.7, peakSolarLongitudeDecimals: 1, typicalZhr: 10, populationIndex: 2.8, velocity: 33, sourceId: 'imo2026' },
]

// A published double-exponential activity profile: ZHR(λ☉) = ZHR0 · 10^(−B·|λ☉ − λ0|), with B the rise exponent before the
// maximum and the decay exponent after it, per degree of solar longitude. It is a model of the activity of a typical
// year, not an observation of any one, and its parameters stay with their source, apart from the IMO visual values.
export interface MeteorActivityProfileEntry {
	// IAU number of the shower.
	readonly number: number
	// Solar longitude of the maximum, degrees, J2000.
	readonly peakSolarLongitude: number
	// ZHR at the maximum, meteors per hour.
	readonly zhr: number
	// Population index r the source gives with the profile.
	readonly populationIndex: number
	// Rise exponent before the maximum, per degree (base 10).
	readonly slopeBefore: number
	// Decay exponent after the maximum, per degree (base 10).
	readonly slopeAfter: number
	// Source of the parameters.
	readonly sourceId: MeteorVisualSourceId
}

// Revision of the activity model, raised by every change of the profiles; part of every cache key built from them.
export const METEOR_ACTIVITY_MODEL_REVISION = 1

// Activity profiles of Table 5 of Moorhead et al. (2019, arXiv:1904.06370), the standard parameters of the NASA Meteoroid
// Environment Office forecast, for the curated showers whose rise and decay exponents are both published as positive.
// Showers the table gives with a decay exponent of 0 (the Perseids, the Leonids, the Draconids, the Taurids), which the
// forecast completes otherwise, have no profile here rather than one that never decays.
export const METEOR_ACTIVITY_PROFILES: readonly MeteorActivityProfileEntry[] = [
	{ number: 10, peakSolarLongitude: 283.58, zhr: 120, populationIndex: 2.1, slopeBefore: 0.865, slopeAfter: 0.827, sourceId: 'moorhead2019' },
	{ number: 6, peakSolarLongitude: 33.15, zhr: 18, populationIndex: 2.1, slopeBefore: 1.229, slopeAfter: 4.62, sourceId: 'moorhead2019' },
	{ number: 31, peakSolarLongitude: 46, zhr: 60, populationIndex: 2.4, slopeBefore: 0.125, slopeAfter: 0.079, sourceId: 'moorhead2019' },
	{ number: 5, peakSolarLongitude: 124.93, zhr: 20, populationIndex: 3.2, slopeBefore: 0.109, slopeAfter: 0.071, sourceId: 'moorhead2019' },
	{ number: 1, peakSolarLongitude: 125.48, zhr: 4, populationIndex: 2.5, slopeBefore: 0.059, slopeAfter: 0.091, sourceId: 'moorhead2019' },
	{ number: 8, peakSolarLongitude: 209.18, zhr: 23, populationIndex: 2.5, slopeBefore: 0.12, slopeAfter: 0.119, sourceId: 'moorhead2019' },
	{ number: 4, peakSolarLongitude: 262.23, zhr: 118, populationIndex: 2.6, slopeBefore: 0.15, slopeAfter: 0.462, sourceId: 'moorhead2019' },
	{ number: 15, peakSolarLongitude: 270.96, zhr: 12, populationIndex: 3, slopeBefore: 2.292, slopeAfter: 1.258, sourceId: 'moorhead2019' },
]
