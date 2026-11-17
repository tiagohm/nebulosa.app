import type { AstroWeatherForecast, AstroWeatherNight, AstroWeatherSource } from 'api'
import { formatClockTime, formatHours, formatPercent, formatTemperature } from '../../format'
import type { AstroWeatherMode } from '../../profile/schema'
import { DataRow } from '../../ui/DataRow'
import { Icon, type IconName } from '../../ui/Icon'
import { Notice } from '../../ui/Notice'
import { SectionHeading } from '../../ui/SectionHeading'
import { BLOCK_LABELS, coverage, MISSING_LABELS, MODE_LABELS, OUTLOOK_LABELS, REASON_LABELS } from './astroweather'
import { type FactRange, type NightEvaluation, type NightFacts, nightFacts, type Outlook, type OutlookSegment, type ReasonCount } from './observing'

// Night at a glance: the outlook in the mode with why, in hours of the night, the window worth using or why there is none,
// and the facts of the part of the night the mode can use, led by the Moon and the darkness, which are computed locally and
// so stand without a forecast. Until a forecast is read the page says it is reading one, and without one it says so in a
// warning rather than an error, since the night itself is still known. A value the forecast lacks reads as unavailable,
// never as 0, and what limits a claim, such as an old forecast or a source that ended, is said beside it.

// Reasons shown at most in the sentence of the outlook.
const REASONS_SHOWN = 3

// Name of each service.
export const PROVIDER_NAMES: Readonly<Record<AstroWeatherSource['provider'], string>> = { openMeteo: 'Open-Meteo', sevenTimer: '7Timer!' }

// Icon and its color for each reading, the name always beside them.
const OUTLOOK_MARKS: Readonly<Record<Outlook, { readonly icon: IconName; readonly className: string }>> = {
	favorable: { icon: 'success', className: 'text-success' },
	variable: { icon: 'warning', className: 'text-warning' },
	unfavorable: { icon: 'error', className: 'text-danger' },
	unavailable: { icon: 'info', className: 'text-ink-300' },
}

// Text of a range, a single number when both ends agree.
function rangeText(range: FactRange | undefined, prefix = '', unit = '') {
	if (!range) return undefined
	return range.min === range.max ? `${prefix}${range.min}${unit}` : `${prefix}${range.min}–${range.max}${unit}`
}

// Text of the precipitation of some hours: the highest hourly chance and the modeled amount of the hours together, in mm.
function rainText({ precipitationChance, precipitation }: NightFacts) {
	if (precipitationChance === undefined && precipitation === undefined) return undefined
	return [precipitationChance === undefined ? undefined : `up to ${precipitationChance}%`, precipitation === undefined ? undefined : `${precipitation.toFixed(1)} mm`].filter(Boolean).join(', ')
}

// Text of the Moon over the night shown: how much of it is lit, and when it is above the horizon.
function moonText({ moon }: AstroWeatherNight, timeZone: string) {
	const lit = `${formatPercent(moon.illuminatedFraction)} lit`
	if (moon.above.length === 0) return `${lit}, below the horizon`
	return `${lit}, up ${moon.above.map((span) => `${formatClockTime(span.start, timeZone)}–${formatClockTime(span.end, timeZone)}`).join(', ')}`
}

// Text of the astronomical darkness of a night: its length, or that the Sun never reaches −18°.
function darknessText({ sun }: AstroWeatherNight) {
	if (sun.darkness.length === 0) return 'None'
	return formatHours(sun.darkness.reduce((sum, span) => sum + span.end - span.start, 0))
}

// Returns a message as a sentence, closed by a period unless it already ends with punctuation.
function sentence(text: string) {
	return /[.!?…]$/.test(text) ? text : `${text}.`
}

// Notices of one service for a night.
function sourceNotices(source: AstroWeatherSource, night: AstroWeatherNight, timeZone: string) {
	const name = PROVIDER_NAMES[source.provider]
	if (source.state === 'unavailable') return [source.errorCode === 'rateLimited' ? `${name} is limiting requests.` : source.errorCode === 'invalidResponse' ? `${name} answered something that cannot be read.` : `${name} cannot be reached.`]

	const notices: string[] = []
	if (source.state === 'stale' && source.fetchedAt !== undefined) notices.push(`${name} could not be read again: showing its forecast of ${formatClockTime(source.fetchedAt, timeZone)}.`)
	const covered = coverage(night.display, source.validFrom, source.validTo)
	if (covered === 'partial' && source.validTo !== undefined && source.validTo < night.display.end) notices.push(`${name} ends at ${formatClockTime(source.validTo, timeZone)}.`)
	if (covered === 'none') notices.push(`${name} does not cover this night.`)
	return notices
}

export interface ForecastSummaryProps {
	// Forecast shown.
	readonly forecast: AstroWeatherForecast
	// Whether a forecast has been read; false while `forecast` stands for none.
	readonly loaded: boolean
	// Whether a forecast is being read.
	readonly loading: boolean
	// Why the latest forecast could not be read, if it could not.
	readonly error?: string
	// Night shown.
	readonly night: AstroWeatherNight
	// Reading of the night.
	readonly evaluation: NightEvaluation
	// Observing mode.
	readonly mode: AstroWeatherMode
	// IANA time zone of the times.
	readonly timeZone: string
}

// Text of a sentence about why an hour reads as it does: its reasons, then what it lacks.
export function reasonsText(hour: Pick<OutlookSegment, 'reasons' | 'missing'>) {
	return [...hour.reasons.map((reason) => REASON_LABELS[reason]), ...missingText(hour.missing)].join('. ')
}

// Text of what some hours lack, as one part of a sentence, or none.
function missingText(missing: OutlookSegment['missing']) {
	return missing.length > 0 ? [`No ${missing.map((metric) => MISSING_LABELS[metric]).join(' or ')}`] : []
}

// Text of a sentence about why a night reads as it does: its most decisive reasons, each with the hours of the `total` read
// that give it, then what the night lacks.
function nightReasonsText(reasons: readonly ReasonCount[], missing: OutlookSegment['missing'], total: number) {
	return [...reasons.slice(0, REASONS_SHOWN).map(({ reason, hours }) => `${REASON_LABELS[reason]} (${hours} of ${total} h)`), ...missingText(missing)].join('. ')
}

// Outlook of the night in the mode, with why and its window.
function Verdict({ evaluation, mode, timeZone }: Pick<ForecastSummaryProps, 'evaluation' | 'mode' | 'timeZone'>) {
	const { outlook, weather, best, marginal, block, scope, reasons, missing } = evaluation
	const mark = OUTLOOK_MARKS[outlook]
	const span = (window: { readonly start: number; readonly end: number }) => `${formatClockTime(window.start, timeZone)}–${formatClockTime(window.end, timeZone, { named: true })} (${formatHours(window.end - window.start)})`
	const why = nightReasonsText(reasons, missing, scope.length)

	return (
		<div className="flex flex-col gap-1">
			<h2 className="m-0 flex items-center gap-2 text-lg leading-6 font-semibold text-balance text-ink-100">
				<Icon name={mark.icon} className={`size-5 flex-none ${mark.className}`} />
				{OUTLOOK_LABELS[outlook]} for {MODE_LABELS[mode]}
			</h2>
			{why && <p className="m-0 text-sm leading-5 text-pretty text-ink-200">{why}.</p>}
			{outlook !== weather && <p className="m-0 text-sm leading-5 text-ink-200">Weather alone: {OUTLOOK_LABELS[weather]}.</p>}
			{best && <p className="m-0 text-sm leading-5 text-ink-100">Best window: {span(best)}</p>}
			{!best && block && <p className="m-0 text-sm leading-5 text-ink-200">{BLOCK_LABELS[block]}</p>}
			{marginal && <p className="m-0 text-sm leading-5 text-ink-200">Longest marginal window: {span(marginal)}</p>}
		</div>
	)
}

// Line of the state of the forecast in place of the outlook while there is none: being read, or not readable.
function ForecastState({ loading, error }: Pick<ForecastSummaryProps, 'loading' | 'error'>) {
	if (loading) {
		return (
			<div className="flex flex-col gap-1">
				<h2 className="m-0 text-lg leading-6 font-semibold text-ink-100">Reading the forecast…</h2>
				<p className="m-0 text-sm leading-5 text-ink-200">Asking Open-Meteo and 7Timer! for this site. The Sun and the Moon below are computed locally.</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-1">
			<h2 className="m-0 flex items-center gap-2 text-lg leading-6 font-semibold text-ink-100">
				<Icon name="warning" className="size-5 flex-none text-warning" />
				No forecast
			</h2>
			<p className="m-0 text-sm leading-5 text-pretty text-ink-200">{error ? sentence(error) : 'The forecast services cannot be reached.'} The darkness and the Moon below are computed locally; Refresh tries the forecast again.</p>
		</div>
	)
}

// Summary of the night.
export function ForecastSummary({ forecast, loaded, loading, error, night, evaluation, mode, timeZone }: ForecastSummaryProps) {
	const { usable, scope } = evaluation
	const facts = nightFacts(forecast, scope)
	const readAt = forecast.meteorology.source.fetchedAt ?? forecast.astronomy.source.fetchedAt
	const notices = loaded ? [...sourceNotices(forecast.meteorology.source, night, timeZone), ...sourceNotices(forecast.astronomy.source, night, timeZone)] : []
	if (loaded && error) notices.unshift(`Refresh failed: ${sentence(error)} Showing the forecast read at ${readAt === undefined ? 'an earlier time' : formatClockTime(readAt, timeZone)}.`)
	const heading = usable ? `Usable for ${MODE_LABELS[mode]}: ${formatClockTime(usable.start, timeZone)}–${formatClockTime(usable.end, timeZone)}` : 'The whole night'

	return (
		<section className="flex flex-col gap-4">
			{loaded ? <Verdict evaluation={evaluation} mode={mode} timeZone={timeZone} /> : <ForecastState loading={loading} error={error} />}
			{notices.length > 0 && (
				<ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs leading-4 text-ink-200">
					{notices.map((notice) => (
						<li key={notice} className="flex gap-1.5">
							<Icon name="warning" className="mt-px size-3.5 flex-none text-warning" />
							{notice}
						</li>
					))}
				</ul>
			)}
			<div className="flex max-w-3xl flex-col gap-2">
				<SectionHeading as="h2">{heading}</SectionHeading>
				<div className="grid grid-cols-1 gap-x-8 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-4">
					<DataRow label="Moon">{moonText(night, timeZone)}</DataRow>
					<DataRow label="Darkness">{darknessText(night)}</DataRow>
					{loaded && (
						<>
							<DataRow label="Total cloud">{rangeText(facts.cloudCover, '', '%') ?? 'Unavailable'}</DataRow>
							<DataRow label="Seeing">{rangeText(facts.seeing, 'class ') ?? 'Unavailable'}</DataRow>
							<DataRow label="Transparency">{rangeText(facts.transparency, 'class ') ?? 'Unavailable'}</DataRow>
							<DataRow label="Smallest dew margin">{facts.dewMargin === undefined ? 'Unavailable' : formatTemperature(facts.dewMargin)}</DataRow>
							<DataRow label="Strongest gust">{facts.windGust === undefined ? 'Unavailable' : `${facts.windGust} km/h`}</DataRow>
							<DataRow label="Precipitation">{rainText(facts) ?? 'Unavailable'}</DataRow>
						</>
					)}
				</div>
				{loaded && <Notice>Classes run from 1, the best, to 8. Precipitation is the highest chance of an hour and the modeled amount of these hours together; the dew margin is how far the air stays above its dew point.</Notice>}
			</div>
		</section>
	)
}
