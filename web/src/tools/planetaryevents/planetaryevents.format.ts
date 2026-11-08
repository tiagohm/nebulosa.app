import type { PlanetaryEvent, PlanetaryEventBody, PlanetaryEventKind, PlanetaryEventQuantity, PlanetaryEventsSignature, PlanetaryEventVisibility, PlanetaryFallbackReason, PlanetaryVisibilityReason, PlanetaryVisibilityStatus } from 'api'
import { csvField } from '../../download'
import { formatDegrees, formatFixed, formatPercent } from '../../format'
import type { StatusTone } from '../../ui/StatusBadge'

// Words and numbers of Planetary Events: the names of the planets and kinds, the one-sentence definition of each kind
// (so a conjunction is never read as an appulse), the primary value of an event, the visibility labels, the source in
// words, and the CSV export of the events listed. Angles arrive in radians and are shown in degrees; times are Unix
// milliseconds (UTC).

// Name of each planet.
export const BODY_LABELS: Readonly<Record<PlanetaryEventBody, string>> = { '199': 'Mercury', '299': 'Venus', '499': 'Mars', '599': 'Jupiter', '699': 'Saturn', '799': 'Uranus', '899': 'Neptune' }

// Name of each kind.
export const KIND_LABELS: Readonly<Record<PlanetaryEventKind, string>> = {
	solarConjunction: 'Conjunction with the Sun',
	opposition: 'Opposition',
	quadrature: 'Quadrature',
	greatestElongation: 'Greatest elongation',
	station: 'Station',
	planetaryConjunction: 'Planetary conjunction',
	planetaryAppulse: 'Closest approach in the sky (appulse)',
	closestEarthApproach: 'Closest to the Earth',
	greatestBrightness: 'Greatest brilliancy',
	halfIllumination: 'Half illuminated (dichotomy)',
}

// What each kind is, in one sentence, with its exact condition.
export const KIND_DEFINITIONS: Readonly<Record<PlanetaryEventKind, string>> = {
	solarConjunction: "The planet and the Sun have the same apparent ecliptic longitude. Inferior when the planet passes between the Earth and the Sun, superior when beyond it. The planet is lost in the Sun's glare.",
	opposition: "The planet's apparent ecliptic longitude differs from the Sun's by 180°: it rises at sunset and is up all night. The separation from the Sun need not reach 180°.",
	quadrature: "The planet's apparent ecliptic longitude differs from the Sun's by 90°: east in the evening sky, west in the morning sky.",
	greatestElongation: 'The largest angular distance of Mercury or Venus from the Sun, east in the evening sky or west in the morning sky.',
	station: "The planet's apparent ecliptic longitude stops changing as its motion turns retrograde or direct. The turn is only measurable over several nights.",
	planetaryConjunction: 'The two planets have the same apparent ecliptic longitude. They are not at their least separation, which is the appulse.',
	planetaryAppulse: 'The two planets are at their least angular separation in the sky, within the threshold chosen. Not the same instant as their conjunction in longitude.',
	closestEarthApproach: 'The least distance between the centres of the Earth and the planet. It can be days away from the opposition.',
	greatestBrightness: 'Venus at its brightest in the Mallama and Hilton (2018) magnitude model, a crescent about a month from inferior conjunction.',
	halfIllumination: 'Exactly half of the disk seen from the Earth is lit (dichotomy). Not the instant of the greatest elongation.',
}

// Name of each subtype.
export const SUBTYPE_LABELS: Readonly<Record<string, string>> = {
	inferior: 'inferior',
	superior: 'superior',
	east: 'east',
	west: 'west',
	directToRetrograde: 'turns retrograde',
	retrogradeToDirect: 'turns direct',
	increasing: 'waxing',
	decreasing: 'waning',
}

// Planets of an event in words: "Mars" or "Mars and Jupiter".
export function bodiesLabel(event: Pick<PlanetaryEvent, 'bodies'>) {
	return event.bodies.map((code) => BODY_LABELS[code]).join(' and ')
}

// Title of an event: its kind and subtype, with an outer planet's solar conjunction named plainly.
export function eventTitle(event: PlanetaryEvent) {
	if (event.kind === 'solarConjunction') {
		const outer = event.bodies[0] !== '199' && event.bodies[0] !== '299'
		return outer ? KIND_LABELS.solarConjunction : `${event.subtype === 'inferior' ? 'Inferior' : 'Superior'} conjunction`
	}

	if ('subtype' in event) return `${KIND_LABELS[event.kind]} (${SUBTYPE_LABELS[event.subtype]})`
	return KIND_LABELS[event.kind]
}

// Distance in AU and millions of kilometres.
export function formatDistance(au: number) {
	return `${formatFixed(au, 4)} AU (${formatFixed((au * 149_597_870.7) / 1e6, 1)} million km)`
}

// The number that best describes an event: a separation, an elongation, a distance, a magnitude, or a longitude.
export function primaryValue(event: PlanetaryEvent) {
	const body = event.circumstances[0]

	switch (event.kind) {
		case 'solarConjunction':
		case 'opposition':
			return `${formatDegrees(event.separation, 2)} from the Sun`
		case 'quadrature':
			return `${formatDegrees(body.elongation, 1)} from the Sun`
		case 'greatestElongation':
			return formatDegrees(event.elongation, 1)
		case 'station':
			return `λ ${formatDegrees(body.longitude, 2)}`
		case 'planetaryConjunction':
			return `${formatDegrees(event.separation, 2)} apart, ${BODY_LABELS[event.northBody]} north`
		case 'planetaryAppulse':
			return `${formatDegrees(event.separation, 2)} apart`
		case 'closestEarthApproach':
			return `${formatFixed(event.earthDistance, 4)} AU`
		case 'greatestBrightness':
			return `magnitude ${formatFixed(event.magnitude, 2)}`
		case 'halfIllumination':
			return formatPercent(body.illuminatedFraction, 0)
	}
}

// Name of each visibility status.
export const STATUS_LABELS: Readonly<Record<PlanetaryVisibilityStatus, string>> = {
	observable: 'Observable at the event',
	nearby: 'Observable nearby',
	notObservable: 'Not observable',
	notSuitable: 'In solar glare',
	unknownNoSite: 'No site',
}

// Tone of each visibility status.
export const STATUS_TONES: Readonly<Record<PlanetaryVisibilityStatus, StatusTone>> = { observable: 'success', nearby: 'active', notObservable: 'neutral', notSuitable: 'warning', unknownNoSite: 'muted' }

// Sentence of each visibility reason.
export function reasonLabel(reason: PlanetaryVisibilityReason, visibility: Pick<PlanetaryEventVisibility, 'minimumAltitude' | 'maximumSunAltitude' | 'atEvent'>) {
	switch (reason) {
		case 'sunTooHigh':
			return `At the event the Sun is above ${formatDegrees(visibility.maximumSunAltitude, 0)}.`
		case 'planetTooLow':
			return `At the event ${visibility.atEvent.lowBodies.map((code) => BODY_LABELS[code]).join(' and ')} ${visibility.atEvent.lowBodies.length > 1 ? 'are' : 'is'} below ${formatDegrees(visibility.minimumAltitude, 0)}.`
		case 'solarGlare':
			return 'A conjunction with the Sun is never recommended for watching: the planet is in the glare and pointing near the Sun is dangerous.'
		case 'noWindow':
			return 'No stretch of at least 15 minutes nearby with every planet high enough and the Sun low enough.'
		case 'separationTooWide':
			return 'The planets can be watched nearby only while farther apart than the threshold.'
	}
}

// Sentence of each reason the kernels were not used.
export const FALLBACK_LABELS: Readonly<Record<PlanetaryFallbackReason, string>> = {
	noKernel: 'no SPICE kernel is enabled',
	loading: 'the kernels are still being opened',
	targetMissing: 'no enabled kernel has every planet asked for',
	missingCenter: 'a body is relative to a center no kernel has',
	outOfCoverage: 'the kernels do not cover the whole range',
	unsupportedFrame: 'a selected segment uses an unsupported frame',
	unsupportedType: 'a selected segment uses an unsupported data type',
	cycle: 'a kernel chain never reaches the barycenter',
}

// Short name of a source: the kernels or VSOP87E.
export function sourceName(signature: PlanetaryEventsSignature | undefined) {
	if (!signature) return undefined
	return signature.source.kind === 'spk' ? 'SPICE kernels' : 'VSOP87E'
}

// One-line description of the source of an answer, naming the planets taken from their system barycentre.
export function describeSource(signature: PlanetaryEventsSignature | undefined) {
	if (!signature) return undefined
	const { source } = signature

	if (source.kind === 'spk') {
		const files = new Set(Object.values(source.kernels).flat())
		const barycentres = Object.entries(signature.origins ?? {})
			.filter(([, origin]) => origin === 'barycentre')
			.map(([code]) => BODY_LABELS[code as PlanetaryEventBody])
		return `SPICE kernels (${files.size} file${files.size === 1 ? '' : 's'}, generation ${signature.generation})${barycentres.length > 0 ? `; ${barycentres.join(', ')} from the system barycentre, under 0.1″ from the centre` : ''}`
	}

	return `VSOP87E analytical theory, because ${FALLBACK_LABELS[source.fallbackReason]}`
}

// Name of each sampled quantity and its unit.
export const QUANTITY_LABELS: Readonly<Record<PlanetaryEventQuantity, string>> = {
	elongation: 'Elongation from the Sun (°)',
	separation: 'Separation (°)',
	longitudeDifference: 'Longitude difference (°)',
	longitude: 'Ecliptic longitude (°)',
	earthDistance: 'Distance from the Earth (AU)',
	magnitude: 'Magnitude',
	illuminatedFraction: 'Illuminated (%)',
}

// Display value of a sampled quantity: degrees, AU, a magnitude, or a percentage.
export function quantityValue(quantity: PlanetaryEventQuantity, value: number) {
	switch (quantity) {
		case 'elongation':
		case 'separation':
		case 'longitudeDifference':
		case 'longitude':
			return (value * 180) / Math.PI
		case 'illuminatedFraction':
			return value * 100
		default:
			return value
	}
}

// Offset of a window from an event in words: "at the event", "5 h 20 min after", "1 d 3 h before".
export function formatOffset(offsetMs: number) {
	if (offsetMs === 0) return 'at the event'
	const minutes = Math.round(Math.abs(offsetMs) / 60_000)
	const days = Math.floor(minutes / 1440)
	const hours = Math.floor((minutes % 1440) / 60)
	const rest = minutes % 60
	const parts = days > 0 ? [`${days} d`, `${hours} h`] : hours > 0 ? [`${hours} h`, `${rest} min`] : [`${rest} min`]
	return `${parts.join(' ')} ${offsetMs > 0 ? 'after' : 'before'}`
}

// A text field of a spreadsheet export made safe: a value starting with =, +, -, @, a tab, or a carriage return is
// prefixed with an apostrophe so no spreadsheet runs it as a formula.
export function spreadsheetText(text: string) {
	return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

// A number of the export, or the empty field when absent or not finite.
function csvNumber(value: number | undefined, digits: number) {
	return value === undefined || !Number.isFinite(value) ? '' : value.toFixed(digits)
}

// Degrees of an angle in radians for the export.
function csvDegrees(value: number | undefined) {
	return value === undefined ? '' : csvNumber((value * 180) / Math.PI, 4)
}

// Separation of an event for the export: a pair's, or a planet's from the Sun at a conjunction or opposition.
function separationOf(event: PlanetaryEvent) {
	return event.kind === 'planetaryConjunction' || event.kind === 'planetaryAppulse' || event.kind === 'solarConjunction' || event.kind === 'opposition' ? event.separation : undefined
}

// Columns of the export, in order; times are UTC ISO 8601 and the event instant is geocentric.
export const CSV_COLUMNS = ['event_id', 'kind', 'bodies', 'event_utc_iso', 'subtype', 'separation_deg', 'elongation_deg', 'earth_distance_au', 'magnitude_v', 'site_name', 'visibility_status', 'best_window_start_utc', 'best_window_end_utc', 'source', 'model_version'] as const

// CSV (RFC 4180, CRLF) of the events listed with their visibility from the site; a planet pair leaves its single-planet
// columns empty, and an absent value is an empty field.
export function eventsCsv(events: readonly PlanetaryEvent[], visibility: Readonly<Record<string, PlanetaryEventVisibility>> | undefined, siteName: string | undefined, signature: PlanetaryEventsSignature | undefined) {
	const source = describeSource(signature) ?? ''
	const model = signature ? String(signature.modelVersion) : ''
	const rows = events.map((event) => {
		const single = event.bodies.length === 1 ? event.circumstances[0] : undefined
		const seen = visibility?.[event.id]
		const elongation = event.kind === 'greatestElongation' ? event.elongation : single?.elongation
		const magnitude = event.kind === 'greatestBrightness' ? event.magnitude : single?.magnitude
		const fields = [
			event.id,
			event.kind,
			event.bodies.map((code) => BODY_LABELS[code]).join('-'),
			new Date(event.time).toISOString(),
			'subtype' in event ? event.subtype : '',
			csvDegrees(separationOf(event)),
			csvDegrees(elongation),
			csvNumber(single?.earthDistance, 6),
			csvNumber(magnitude, 2),
			siteName === undefined ? '' : spreadsheetText(siteName),
			seen?.status ?? 'unknownNoSite',
			seen?.bestWindow ? new Date(seen.bestWindow.start).toISOString() : '',
			seen?.bestWindow ? new Date(seen.bestWindow.end).toISOString() : '',
			spreadsheetText(source),
			model,
		]
		return fields.map(csvField).join(',')
	})
	return `${[CSV_COLUMNS.join(','), ...rows].join('\r\n')}\r\n`
}
