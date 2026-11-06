import type { AstroWeatherForecast, AstroWeatherNight, AstroWeatherSource } from 'api'
import { formatClockTime, formatTemperature } from '../../format'
import type { AstroWeatherMode } from '../../profile/schema'
import { Icon, type IconName } from '../../ui/Icon'
import { Notice } from '../../ui/Notice'
import { BLOCK_LABELS, coverage, formatLength, MISSING_LABELS, MODE_LABELS, OUTLOOK_LABELS, REASON_LABELS } from './astroweather'
import { type FactRange, type NightEvaluation, type NightFacts, nightFacts, type Outlook, type OutlookSegment } from './observing'

// Night at a glance: the outlook in the mode with why, the window worth using or why there is none, and six facts of the part
// of the night the mode can use. A value the forecast lacks reads as unavailable, never as 0, and what limits a claim, such as
// an old forecast or a source that ended, is said beside it.

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
function rangeText(range: FactRange | undefined, unit = '') {
	if (!range) return undefined
	return range.min === range.max ? `${range.min}${unit}` : `${range.min}–${range.max}${unit}`
}

// Text of the precipitation of some hours.
function rainText({ precipitationChance, precipitation }: NightFacts) {
	if (precipitationChance === undefined && precipitation === undefined) return undefined
	return [precipitationChance === undefined ? undefined : `up to ${precipitationChance}%`, precipitation === undefined ? undefined : `${precipitation.toFixed(1)} mm`].filter(Boolean).join(', ')
}

// One fact of the night.
function Fact({ label, value, note }: { readonly label: string; readonly value: string | undefined; readonly note?: string }) {
	return (
		<div className="min-w-0 rounded-sm border border-line-100 px-3 py-2">
			<p className="m-0 text-xs leading-4 tracking-[0.04em] text-ink-300">{label}</p>
			<p className="m-0 text-sm wrap-break-word text-ink-100">{value ?? 'Unavailable'}</p>
			{note && <Notice>{note}</Notice>}
		</div>
	)
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
	// Night shown.
	readonly night: AstroWeatherNight
	// Reading of the night.
	readonly evaluation: NightEvaluation
	// Observing mode.
	readonly mode: AstroWeatherMode
	// IANA time zone of the times.
	readonly timeZone: string
}

// Text of a sentence about why an hour or night reads as it does.
export function reasonsText(hours: Pick<OutlookSegment, 'reasons' | 'missing'>, limit = Number.POSITIVE_INFINITY) {
	const parts = hours.reasons.slice(0, limit).map((reason) => REASON_LABELS[reason])
	if (hours.missing.length > 0) parts.push(`No ${hours.missing.map((metric) => MISSING_LABELS[metric]).join(' or ')}`)
	return parts.join('. ')
}

// Summary of the night.
export function ForecastSummary({ forecast, loaded, night, evaluation, mode, timeZone }: ForecastSummaryProps) {
	const { outlook, weather, best, marginal, block, scope } = evaluation
	const mark = OUTLOOK_MARKS[outlook]
	const facts = nightFacts(forecast, scope)
	const span = (window: { readonly start: number; readonly end: number }) => `${formatClockTime(window.start, timeZone)}–${formatClockTime(window.end, timeZone, { named: true })} (${formatLength(window)})`
	const notices = loaded ? [...sourceNotices(forecast.meteorology.source, night, timeZone), ...sourceNotices(forecast.astronomy.source, night, timeZone)] : []
	const why = reasonsText(evaluation, REASONS_SHOWN)

	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<p className="m-0 flex items-center gap-2 text-base font-semibold text-ink-100">
					<Icon name={mark.icon} className={`size-5 flex-none ${mark.className}`} />
					{OUTLOOK_LABELS[outlook]} for {MODE_LABELS[mode]}
				</p>
				{why && <p className="m-0 text-sm leading-5 text-ink-200">{why}.</p>}
				{outlook !== weather && <p className="m-0 text-sm leading-5 text-ink-200">Weather alone: {OUTLOOK_LABELS[weather]}.</p>}
				{best && <p className="m-0 text-sm leading-5 text-ink-100">Best window: {span(best)}</p>}
				{!best && block && <p className="m-0 text-sm leading-5 text-ink-200">{BLOCK_LABELS[block]}</p>}
				{marginal && <p className="m-0 text-sm leading-5 text-ink-200">Longest marginal window: {span(marginal)}</p>}
			</div>
			<div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
				<Fact label="Total cloud" value={rangeText(facts.cloudCover, '%')} />
				<Fact label="Seeing class" value={rangeText(facts.seeing)} note="1 best, 8 worst" />
				<Fact label="Transparency class" value={rangeText(facts.transparency)} note="1 best, 8 worst" />
				<Fact label="Precipitation" value={rainText(facts)} note="Chance, modeled amount" />
				<Fact label="Strongest gust" value={facts.windGust === undefined ? undefined : `${facts.windGust} km/h`} />
				<Fact label="Dew margin" value={facts.dewMargin === undefined ? undefined : formatTemperature(facts.dewMargin)} note="Smallest, air above dew point" />
			</div>
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
		</section>
	)
}
