import type { AstroWeatherForecast, MeteorActivityCurve, MeteorNightRanking as Ranking, MeteorObservingNight, MeteorShowerDetail, MeteorShowerOccurrence } from 'api'
import { formatDate, formatDateTime, formatDegrees, formatPercent, formatSpan } from '../../format'
import type { SiteLocation } from '../../location/site'
import { formatDeclination, formatRightAscension } from '../../sky/format'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { MeteorActivityChart } from './MeteorActivityChart'
import { MeteorNightChart } from './MeteorNightChart'
import { MeteorNightRanking } from './MeteorNightRanking'
import { addShowerToPlanner, showRadiantInSky, showRadiantInSkyAt } from './meteorshowers'
import { ACTIVITY_KIND_LABELS, ACTIVITY_LABELS, ANNUAL_RELATION_LABELS, BASIS_LABELS, formatAnnualEvent, formatPeak, formatSolarLongitude, GAP_LABELS, kilometersPerSecond, REASON_LABELS, SELECTION_LABELS, STATUS_LABELS } from './meteorshowers.format'
import { type MeteorWeatherAssessment, sourceStateText, windowsWeather } from './meteorshowers.weather'

// Details of one shower: its identity and status, its curated visual data with the edition it comes from, its
// occurrences by each source apart (the published visual maximum is never confused with the IAU mean reference), every
// IAU solution with the preferred one marked and why, what the catalog leaves unknown, and its geometric observing night
// from the tool's location. Nothing here targets the radiant: Show Radiant in Sky only selects it, and Set Sky Time to
// Maximum is the one action that changes the Sky clock.

// Columns of the solutions.
const SOLUTION_COLUMNS = ['Solution', 'Status', 'Activity', 'Period (λ☉)', 'Radiant (J2000)', { key: 'n', label: 'N', numeric: true }, 'Technique', 'Reference'] as const

// Rows of one occurrence: each source on its own rows.
function OccurrenceRows({ occurrence, timeZone }: { readonly occurrence: MeteorShowerOccurrence; readonly timeZone: string }) {
	const { visual, iau } = occurrence
	return (
		<DataList>
			{visual && <DataRow label="Visual period (IMO)">{`${formatDate(visual.start, 'UTC')} to ${formatDate(visual.end, 'UTC')} (calendar days)`}</DataRow>}
			{visual && <DataRow label="Maximum (IMO)">{`${formatPeak(visual.peak, visual.peakSolarLongitudeDecimals, timeZone)} · ${formatSolarLongitude(visual.peakSolarLongitude, visual.peakSolarLongitudeDecimals)}`}</DataRow>}
			{iau?.start !== undefined && iau.end !== undefined && <DataRow label="Activity (IAU)">{`${formatDate(iau.start, timeZone)} to ${formatDate(iau.end, timeZone)}`}</DataRow>}
			{iau?.reference !== undefined && <DataRow label="Mean reference (IAU)">{`${formatDate(iau.reference, timeZone)} · an average of the activity, not its maximum`}</DataRow>}
		</DataList>
	)
}

// Name and tone of each weather assessment.
const WEATHER_LABELS: Readonly<Record<MeteorWeatherAssessment, { readonly label: string; readonly tone: 'success' | 'warning' | 'danger' | 'neutral' }>> = {
	favorable: { label: 'Favorable', tone: 'success' },
	variable: { label: 'Variable', tone: 'warning' },
	unfavorable: { label: 'Unfavorable', tone: 'danger' },
	notCovered: { label: 'Beyond the forecast', tone: 'neutral' },
	unassessed: { label: 'Not assessed', tone: 'neutral' },
}

// The forecast of the windows, from the Astro Weather sources.
function WindowsWeather({ night, forecast, timeZone }: { readonly night: MeteorObservingNight; readonly forecast: AstroWeatherForecast; readonly timeZone: string }) {
	const weather = windowsWeather(forecast, night.windows)
	return (
		<div className="flex flex-col gap-1">
			{weather.map((window) => {
				const assessment = WEATHER_LABELS[window.assessment]
				const facts = [
					window.cloudCover === undefined ? undefined : `${Math.round(window.cloudCover)}% cloud`,
					window.precipitationProbability === undefined ? undefined : `${window.precipitationProbability}% chance of precipitation`,
					window.transparency === undefined ? undefined : `transparency class ${window.transparency} of 8`,
				]
					.filter(Boolean)
					.join(', ')
				return (
					<p key={window.start} className="m-0 flex flex-wrap items-center gap-2 text-xs text-ink-200">
						<StatusBadge tone={assessment.tone} label={assessment.label} />
						<span>{`${formatSpan(window.start, window.end, timeZone)}${facts ? `: ${facts}` : ''}`}</span>
					</p>
				)
			})}
			<p className="m-0 text-xs text-ink-300">{`Forecast of Open-Meteo (${sourceStateText(forecast.meteorology.source)}) and 7Timer! (${sourceStateText(forecast.astronomy.source)}), as Astro Weather shows them: a forecast, not a measurement of the site. Only a fresh forecast is assessed, and the weather never changes a window, a rate, or a ranking.`}</p>
		</div>
	)
}

// The observing night section.
function ObservingNight({ night, name, minimumAltitude, timeZone, forecast }: { readonly night: MeteorObservingNight; readonly name: string; readonly minimumAltitude: number; readonly timeZone: string; readonly forecast?: AstroWeatherForecast }) {
	return (
		<div className="flex flex-col gap-2">
			<p className="m-0 text-xs text-ink-300">
				Judged against {night.support.basis === 'none' ? 'no published activity period: the windows only satisfy the geometry' : `the ${BASIS_LABELS[night.support.basis]} activity period`}. Geometric altitudes, the Moon geocentric; no meteor rate is computed without an activity profile.
			</p>
			{night.windows.length > 0 ? (
				<DataList>
					{night.windows.map((window) => (
						<DataRow key={window.start} label={`Window ${formatSpan(window.start, window.end, timeZone)}${window.support === 'geometryOnly' ? ' (geometry only)' : ''}`}>
							{`radiant up to ${formatDegrees(window.maximumRadiantAltitude, 0)} at ${formatDateTime(window.bestTime, timeZone, false).slice(11)} · Moon ${formatPercent(window.moonIlluminationAtBest)} lit, ${window.moonAltitudeAtBest > 0 ? `${formatDegrees(window.moonAltitudeAtBest, 0)} high, ${formatDegrees(window.moonRadiantSeparationAtBest, 0)} away` : 'down'}`}
						</DataRow>
					))}
				</DataList>
			) : (
				<Notice>{night.reasons.map((reason) => REASON_LABELS[reason]).join(' ')}</Notice>
			)}
			{night.model && (
				<div className="flex flex-col gap-1">
					<p className="m-0 text-xs text-ink-300">{`Modelled from the published activity profile for a limiting magnitude of ${night.model.limitingMagnitude.toFixed(1)}, r = ${night.model.populationIndex.toFixed(1)} (${night.model.populationIndexSource === 'profile' ? 'from the profile' : 'yours'}), and F = ${night.model.obstructionCorrection.toFixed(2)}: what an ideal observer would count, never a forecast.`}</p>
					{night.model.windows.length === 0 ? (
						<p className="m-0 text-xs text-ink-300">The profile gives no activity in these windows.</p>
					) : (
						<DataList>
							{night.model.windows.map((window) => (
								<DataRow key={window.start} label={`Modelled ${formatSpan(window.start, window.end, timeZone)}`}>{`about ${window.expectedCount.toFixed(0)} meteors · up to ${window.bestLocalHourlyRate.toFixed(0)} per hour at ${formatDateTime(window.bestTime, timeZone, false).slice(11)}`}</DataRow>
							))}
						</DataList>
					)}
				</div>
			)}
			{forecast && night.windows.length > 0 && <WindowsWeather night={night} forecast={forecast} timeZone={timeZone} />}
			<MeteorNightChart night={night} name={name} minimumAltitude={minimumAltitude} timeZone={timeZone} />
		</div>
	)
}

// Details of a shower.
export function MeteorShowerDetails({
	detail,
	night,
	nightLoading,
	nightError,
	minimumAltitude,
	site,
	activeSite,
	timeZone,
	activity,
	ranking,
	rankingLoading,
	rankingError,
	onRank,
	onSelectNight,
	forecast,
}: {
	readonly detail: MeteorShowerDetail
	readonly night?: MeteorObservingNight
	readonly nightLoading: boolean
	readonly nightError?: string
	readonly minimumAltitude: number
	readonly site?: SiteLocation
	readonly activeSite?: SiteLocation
	readonly timeZone: string
	readonly activity?: MeteorActivityCurve
	readonly ranking?: Ranking
	readonly rankingLoading: boolean
	readonly rankingError?: string
	readonly onRank: () => void
	readonly onSelectNight: (eveningDate: string) => void
	readonly forecast?: AstroWeatherForecast
}) {
	const activityNow = ACTIVITY_LABELS[detail.activityNow.state]
	const visual = detail.visual
	const peakOccurrence = detail.occurrences.find((occurrence) => occurrence.visual && occurrence.visual.peak >= Date.now()) ?? detail.occurrences.findLast((occurrence) => occurrence.visual)
	const preciseVisualPeak = peakOccurrence?.visual && peakOccurrence.visual.peakSolarLongitudeDecimals > 0 ? peakOccurrence.visual.peak : undefined

	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-md border border-line-100 bg-base-100 p-3">
			<header className="flex flex-wrap items-center gap-2">
				<h2 className="m-0 text-base font-semibold text-ink-100">{detail.name}</h2>
				<span className="text-xs text-ink-300">{[detail.code, detail.number === undefined ? undefined : `IAU ${detail.number}`, detail.iauName !== detail.name ? detail.iauName : undefined].filter(Boolean).join(' · ')}</span>
				<StatusBadge tone={detail.status === 'established' ? 'success' : detail.status === 'removed' ? 'danger' : 'neutral'} label={STATUS_LABELS[detail.status]} />
				<StatusBadge tone={activityNow.tone} label={`${activityNow.label} (${BASIS_LABELS[detail.activityNow.basis]})`} />
			</header>
			<Actions>
				<Button variant="secondary" disabled={detail.radiant === undefined} onClick={() => showRadiantInSky(detail.id, detail.name, activeSite)}>
					Show Radiant in Sky
				</Button>
				{preciseVisualPeak !== undefined && (
					<Button variant="secondary" onClick={() => showRadiantInSkyAt(detail.id, detail.name, preciseVisualPeak, activeSite)}>
						Set Sky Time to Maximum
					</Button>
				)}
				<Button variant="secondary" disabled={detail.radiant === undefined} onClick={() => addShowerToPlanner(detail.id, detail.name)}>
					Add to Observing Planner
				</Button>
			</Actions>
			{detail.identity === 'snapshot' && <Notice>This record has no IAU number; its id comes from this edition of the catalog and may name another record after a refresh.</Notice>}
			{visual && (
				<div className="flex flex-col gap-1">
					<h3 className="m-0 text-sm font-semibold text-ink-100">Visual Data (IMO)</h3>
					<DataList>
						<DataRow label="Typical ZHR at maximum">{visual.typicalZhr === undefined ? 'Variable' : `${visual.typicalZhr} per hour`}</DataRow>
						<DataRow label="Population index r">{visual.populationIndex.toFixed(1)}</DataRow>
						<DataRow label="Entry speed">{`${visual.velocity} km/s`}</DataRow>
						<DataRow label="Source">{detail.visualSource ? `${detail.visualSource.publisher}, ${detail.visualSource.title}` : '—'}</DataRow>
					</DataList>
					<p className="m-0 text-xs text-ink-300">The ZHR is what an ideal observer would see with the radiant overhead under a limiting magnitude of 6.5, never a count expected from a site.</p>
				</div>
			)}
			{!visual && <p className="m-0 text-xs text-ink-300">No curated visual data: no ZHR or visual maximum is known for this shower here.</p>}
			{!detail.annualPredictionAvailable && <p className="m-0 text-xs text-ink-300">No year-specific predictions were curated for this year; the visual values are the recurring baseline.</p>}
			{detail.annualEvents.length > 0 && (
				<div className="flex flex-col gap-1">
					<h3 className="m-0 text-sm font-semibold text-ink-100">Year-Specific Events</h3>
					<ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-xs text-ink-200">
						{detail.annualEvents.map((event) => (
							<li key={event.id}>
								<span className="text-ink-100">{formatAnnualEvent(event, timeZone)}</span>
								<span className="block text-ink-300">{`${event.attribution}; ${ANNUAL_RELATION_LABELS[event.relation]}. IMO Meteor Shower Calendar ${event.year}.`}</span>
							</li>
						))}
					</ul>
					<p className="m-0 text-xs text-ink-300">Each event belongs to its year alone. A possible enhancement is not a predicted outburst, and none is a storm forecast.</p>
				</div>
			)}
			<div className="flex flex-col gap-1">
				<h3 className="m-0 text-sm font-semibold text-ink-100">Occurrences</h3>
				{detail.occurrences.length === 0 && <p className="m-0 text-xs text-ink-300">No source dates this shower in these years.</p>}
				{detail.occurrences.map((occurrence) => (
					<OccurrenceRows key={occurrence.visual?.start ?? occurrence.iau?.start ?? occurrence.iau?.reference} occurrence={occurrence} timeZone={timeZone} />
				))}
			</div>
			<div className="flex flex-col gap-1">
				<h3 className="m-0 text-sm font-semibold text-ink-100">Activity</h3>
				{activity ? <MeteorActivityChart curve={activity} timeZone={timeZone} now={Date.now()} /> : <p className="m-0 text-xs text-ink-300">Reading the activity…</p>}
				{activity?.profile && <p className="m-0 text-xs text-ink-300">Profile: Moorhead et al. (2019), the NASA Meteoroid Environment Office forecast parameters, a model of a typical year.</p>}
			</div>
			<div className="flex flex-col gap-1">
				<h3 className="m-0 text-sm font-semibold text-ink-100">Observing Night</h3>
				{!site && <p className="m-0 text-xs text-ink-300">Set the observing site of this profile to see when the radiant can be watched.</p>}
				{site && nightLoading && <p className="m-0 text-xs text-ink-300">Computing the night…</p>}
				{site && nightError && <Notice error>{nightError}</Notice>}
				{site && night && <ObservingNight night={night} name={detail.name} minimumAltitude={minimumAltitude} timeZone={timeZone} forecast={forecast} />}
			</div>
			{site && (
				<div className="flex flex-col gap-1">
					<h3 className="m-0 text-sm font-semibold text-ink-100">Best Nights</h3>
					<Actions>
						<Button variant="secondary" disabled={rankingLoading || detail.radiant === undefined} onClick={onRank}>
							{rankingLoading ? 'Ranking…' : 'Rank Nights'}
						</Button>
					</Actions>
					{rankingError && <Notice error>{rankingError}</Notice>}
					{ranking && <MeteorNightRanking ranking={ranking} onSelect={onSelectNight} />}
				</div>
			)}
			<div className="flex flex-col gap-1">
				<h3 className="m-0 text-sm font-semibold text-ink-100">IAU Solutions</h3>
				<p className="m-0 text-xs text-ink-300">{SELECTION_LABELS[detail.selectedBy]}</p>
				{detail.gaps.length > 0 && (
					<ul className="m-0 list-disc pl-4 text-xs text-ink-300">
						{detail.gaps.map((gap) => (
							<li key={gap}>{GAP_LABELS[gap]}</li>
						))}
					</ul>
				)}
				<div className="overflow-x-auto">
					<Table columns={SOLUTION_COLUMNS}>
						{detail.solutions.map((solution, index) => (
							<Row key={solution.solutionId ?? index} selected={index === detail.selected}>
								<Cell>{`${solution.solutionId ?? `#${index + 1}`}${index === detail.selected ? ' (preferred)' : ''}`}</Cell>
								<Cell>{solution.status ? STATUS_LABELS[solution.status] : '—'}</Cell>
								<Cell title={solution.activity.source}>{ACTIVITY_KIND_LABELS[solution.activity.kind]}</Cell>
								<Cell>{solution.activityInterval ? `${formatSolarLongitude(solution.activityInterval.start, 1)}–${formatSolarLongitude(solution.activityInterval.end, 1).slice(3)}` : '—'}</Cell>
								<Cell>{solution.rightAscension !== undefined && solution.declination !== undefined ? `${formatRightAscension(solution.rightAscension)} ${formatDeclination(solution.declination)}` : '—'}</Cell>
								<Cell numeric>{solution.memberCount ?? '—'}</Cell>
								<Cell>{solution.observationTechnique ?? '—'}</Cell>
								<Cell title={solution.reference}>{solution.reference?.split('\n').at(-1) ?? '—'}</Cell>
							</Row>
						))}
					</Table>
				</div>
				{detail.selected !== undefined && detail.solutions[detail.selected].geocentricSpeed !== undefined && <p className="m-0 text-xs text-ink-300">{`Geocentric speed of the preferred solution: ${kilometersPerSecond(detail.solutions[detail.selected].geocentricSpeed!).toFixed(1)} km/s.`}</p>}
				{detail.selected !== undefined && detail.solutions[detail.selected].parentBody && <p className="m-0 text-xs text-ink-300">{`Parent body: ${detail.solutions[detail.selected].parentBody}.`}</p>}
			</div>
		</section>
	)
}
