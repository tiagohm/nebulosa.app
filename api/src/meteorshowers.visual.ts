// Curated visual data of the Meteor Showers tool: a small, attributed subset of the Working List of Visual Meteor Showers
// of the International Meteor Organization, reviewed by hand and released with the application, never downloaded,
// scraped, or edited at run time. It is an independent source beside the IAU Meteor Data Center catalog: an entry names
// its shower by IAU number and adds only what the IMO publishes for visual observers (the activity period, the solar
// longitude of the maximum, the typical ZHR, and the population index), with its edition. Nothing here is merged into an
// IAU solution, and a shower the subset does not list has no visual data, never a ZHR of 0. The IMO grants this use with
// credit and edition; the subset is deliberately not the full Working List, which is not republished.

// Kind of a datum, kept with it so a computed value never passes for an observed one.
export type MeteorDataBasis = 'iauScientific' | 'imoVisual' | 'publishedAnnualPrediction' | 'nebulosaModel' | 'observerGeometry'

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
export type MeteorVisualSourceId = 'imo2026' | 'imo2027'

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
