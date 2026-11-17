import type { AstroWeatherForecast, MeteorActivityCurve, MeteorNightRanking as Ranking, MeteorObservingNight, MeteorShowerDetail, MeteorShowerOccurrence } from 'api'
import { formatDate, formatFixed, formatSpeed, MISSING } from '../../format'
import type { SiteLocation } from '../../location/site'
import { formatDeclination, formatRightAscension } from '../../sky/format'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { DisclosureSummary } from '../../ui/DisclosureSummary'
import { LinkButton } from '../../ui/LinkButton'
import { Notice } from '../../ui/Notice'
import { ProgressBar } from '../../ui/ProgressBar'
import { SectionHeading } from '../../ui/SectionHeading'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { MeteorActivityChart } from './MeteorActivityChart'
import { MeteorNightChart } from './MeteorNightChart'
import { NightVerdict } from './MeteorNightList'
import { MeteorNightRanking } from './MeteorNightRanking'
import { addDays, addShowerToPlanner, daysBetween, eveningOf, maximumEvening, occurrenceOfEvening, showRadiantInSky, showRadiantInSkyAt } from './meteorshowers'
import { ACTIVITY_KIND_LABELS, ACTIVITY_LABELS, ANNUAL_RELATION_LABELS, BASIS_LABELS, bestWindow, describeWindow, formatAnnualEvent, formatEvening, formatNightsAway, formatPeak, formatSolarLongitude, GAP_LABELS, kilometersPerSecond, REASON_LABELS, SELECTION_LABELS, STATUS_LABELS } from './meteorshowers.format'
import { type MeteorWeatherAssessment, sourceStateText, windowsWeather } from './meteorshowers.weather'

// Details of one shower, answer first: its name and activity now, then its night at the tool's location for the evening
// shown (the verdict, each window with the Moon and the weather in words, the modelled count, the maximum and the
// year-specific events of that night, and the constraints applied), the moves to other evenings, and the handoffs; then
// the radiant over the night, the best nights, and the activity profile; then, collapsed, the curated visual data and the
// year-specific events, the occurrences of each source apart (the published visual maximum is never confused with the IAU
// mean reference), and every IAU solution with the preferred one marked and why. Show Radiant in Sky keeps the Sky's clock;
// Show in Sky at Best Time and Show in Sky at Maximum set it, the only changes of the Sky clock. Nothing here moves the
// mount.

// Columns of the solutions.
const SOLUTION_COLUMNS = ['Solution', 'Status', 'Activity', 'Period (λ☉)', 'Radiant (J2000)', { key: 'n', label: 'N', numeric: true }, 'Technique', 'Reference'] as const

// Name and tone of each weather assessment.
const WEATHER_LABELS: Readonly<Record<MeteorWeatherAssessment, { readonly label: string; readonly tone: 'success' | 'warning' | 'danger' | 'neutral' | 'muted' }>> = {
	favorable: { label: 'Favorable', tone: 'success' },
	variable: { label: 'Variable', tone: 'warning' },
	unfavorable: { label: 'Unfavorable', tone: 'danger' },
	notCovered: { label: 'Beyond the forecast', tone: 'muted' },
	unassessed: { label: 'Not assessed', tone: 'muted' },
}

// Expected count of a modelled night, meteors, and its highest local hourly rate, meteors per hour; both absent for a
// geometric night.
function modelledNight(night: MeteorObservingNight | undefined): { readonly count?: number; readonly rate?: number } {
	if (!night?.model) return {}
	let count = 0
	let rate = 0
	for (const window of night.model.windows) {
		count += window.expectedCount
		rate = Math.max(rate, window.bestLocalHourlyRate)
	}
	return { count, rate }
}

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

// The windows of the night, each a line with its weather in words when a forecast covers it.
function Windows({ night, forecast, timeZone }: { readonly night: MeteorObservingNight; readonly forecast?: AstroWeatherForecast; readonly timeZone: string }) {
	const weather = forecast ? windowsWeather(forecast, night.windows) : undefined

	return (
		<ul className="m-0 flex list-none flex-col gap-1.5 p-0">
			{night.windows.map((window, i) => {
				const forecastHere = weather?.[i]
				const assessment = forecastHere && WEATHER_LABELS[forecastHere.assessment]
				const facts =
					forecastHere &&
					[
						forecastHere.cloudCover === undefined ? undefined : `${Math.round(forecastHere.cloudCover)}% cloud`,
						forecastHere.precipitationProbability === undefined ? undefined : `${forecastHere.precipitationProbability}% rain`,
						forecastHere.transparency === undefined ? undefined : `transparency ${forecastHere.transparency} of 8`,
					]
						.filter(Boolean)
						.join(', ')
				return (
					<li key={window.start} className="flex flex-col gap-1 text-sm text-ink-100">
						<span className="tabular-nums">{describeWindow(window, timeZone)}</span>
						{assessment && (
							<span className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
								<StatusBadge tone={assessment.tone} label={assessment.label} />
								{facts}
							</span>
						)}
					</li>
				)
			})}
		</ul>
	)
}

export interface MeteorShowerDetailsProps {
	// Detail of the shower.
	readonly detail: MeteorShowerDetail
	// Observing night of the evening shown; absent while computing, without a site, or after a failure.
	readonly night?: MeteorObservingNight
	readonly nightLoading: boolean
	readonly nightError?: string
	// Lowest radiant altitude of a window, radians.
	readonly minimumAltitude: number
	// The tool's location; absent without an observing site.
	readonly site?: SiteLocation
	// IANA zone the instants are read in.
	readonly timeZone: string
	// Evening shown, YYYY-MM-DD; absent until a site is known.
	readonly eveningDate?: string
	// Tonight's evening at the site, YYYY-MM-DD.
	readonly tonightDate?: string
	// Shows another evening.
	readonly onEvening: (eveningDate: string) => void
	// Whether the night's bar above the list already moves the evening and states the constraints, so the details offer
	// only the night of the maximum.
	readonly nightBar: boolean
	// The constraints the windows are judged against, in words.
	readonly constraints: string
	// Opens the constraints in the panel.
	readonly onConstraints: () => void
	// Activity curve of the year of the next occurrence; absent while reading.
	readonly activity?: MeteorActivityCurve
	// Ranking of nights, its state, and how many evenings it spans.
	readonly ranking?: Ranking
	readonly rankingLoading: boolean
	readonly rankingError?: string
	readonly rankedNights: number
	readonly onRank: () => void
	// Astro Weather forecast of the site; absent without one.
	readonly forecast?: AstroWeatherForecast
}

// Details of a shower.
export function MeteorShowerDetails({ detail, night, nightLoading, nightError, minimumAltitude, site, timeZone, eveningDate, tonightDate, onEvening, nightBar, constraints, onConstraints, activity, ranking, rankingLoading, rankingError, rankedNights, onRank, forecast }: MeteorShowerDetailsProps) {
	const activityNow = ACTIVITY_LABELS[detail.activityNow.state]
	const visual = detail.visual
	// Evenings are named in the site's zone, whatever zone the instants are read in.
	const eveningZone = site?.timeZone ?? timeZone
	const occurrence = eveningDate === undefined ? detail.occurrence : occurrenceOfEvening(detail.occurrences, eveningDate, eveningZone)
	const peak = occurrence?.visual
	const peakEvening = maximumEvening(occurrence, eveningZone)
	const best = night && bestWindow(night.windows)
	const located = detail.radiant !== undefined
	const nightEvents = eveningDate === undefined ? [] : detail.annualEvents.filter((event) => eveningOf(event.time, eveningZone) === eveningDate)
	const { count: modelledCount, rate: modelledRate } = modelledNight(night)

	return (
		<section className="flex min-w-0 flex-col gap-4 rounded-md border border-line-100 bg-base-100 p-3">
			<header className="flex flex-col gap-1.5">
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
					<h2 className="m-0 text-base font-semibold text-ink-100">{detail.name}</h2>
					<span className="text-xs text-ink-300">{[detail.code, detail.number === undefined ? undefined : `IAU ${detail.number}`, detail.iauName !== detail.name ? detail.iauName : undefined].filter(Boolean).join(' · ')}</span>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge tone={activityNow.tone} label={`${activityNow.label} now`} title={`Decided by the ${BASIS_LABELS[detail.activityNow.basis]} data`} />
					{visual && <span className="text-xs text-ink-300">{visual.typicalZhr === undefined ? 'Variable ZHR' : `Typical ZHR ${visual.typicalZhr} at maximum`}</span>}
				</div>
			</header>

			<div className="flex flex-col gap-2">
				<SectionHeading as="h3">{eveningDate ? `Night of ${formatEvening(eveningDate)}${eveningDate === tonightDate ? ' · tonight' : ''}` : 'Observing night'}</SectionHeading>
				{!site && <Notice>Set the observing site of this profile to see when the radiant can be watched.</Notice>}
				{site && nightError && <Notice error>{nightError}</Notice>}
				{site && !night && nightLoading && <Notice>Computing the night…</Notice>}
				{site && night && (
					<>
						<div className="flex flex-wrap items-center gap-2">
							<NightVerdict entry={night} />
							{modelledCount !== undefined && <span className="text-sm text-ink-100 tabular-nums">{`about ${formatFixed(modelledCount, 0)} meteors modelled, up to ${formatFixed(modelledRate, 0)} an hour`}</span>}
							{nightLoading && <span className="text-xs text-ink-300">Updating…</span>}
						</div>
						{night.windows.length > 0 ? <Windows night={night} forecast={forecast} timeZone={timeZone} /> : <p className="m-0 text-sm text-ink-100">{night.reasons.map((reason) => REASON_LABELS[reason]).join(' ')}</p>}
					</>
				)}
				{peak && peakEvening && eveningDate && <p className="m-0 text-sm text-ink-200">{`Maximum ${formatPeak(peak.peak, peak.peakSolarLongitudeDecimals, timeZone)}, ${formatNightsAway(daysBetween(eveningDate, peakEvening))}.`}</p>}
				{nightEvents.map((event) => (
					<p key={event.id} className="m-0 text-sm text-ink-200">
						{`${formatAnnualEvent(event, timeZone)}; ${ANNUAL_RELATION_LABELS[event.relation]}.`}
					</p>
				))}
				{site && !nightBar && (
					<p className="m-0 text-xs text-ink-300">
						{constraints}.{' '}
						<LinkButton className="text-xs" onClick={onConstraints}>
							Change
						</LinkButton>
					</p>
				)}
				{site && eveningDate && (
					<Actions>
						{!nightBar && (
							<>
								<Button variant="secondary" title="Shows the evening before" onClick={() => onEvening(addDays(eveningDate, -1))}>
									Previous Night
								</Button>
								<Button variant="secondary" title="Shows the evening after" onClick={() => onEvening(addDays(eveningDate, 1))}>
									Next Night
								</Button>
							</>
						)}
						{peakEvening && (
							<Button variant="secondary" disabled={peakEvening === eveningDate} title={peakEvening === eveningDate ? 'This is the night of the maximum' : `Shows the night of ${formatEvening(peakEvening)}`} onClick={() => onEvening(peakEvening)}>
								Night of Maximum
							</Button>
						)}
						{tonightDate && !nightBar && (
							<Button variant="secondary" disabled={tonightDate === eveningDate} title={tonightDate === eveningDate ? 'This is tonight' : `Shows tonight, ${formatEvening(tonightDate)}`} onClick={() => onEvening(tonightDate)}>
								Tonight
							</Button>
						)}
					</Actions>
				)}
				<Actions>
					{best && (
						<Button variant="primary" title="Sets the Sky clock to the highest radiant of the best window and shows the radiant there" onClick={() => showRadiantInSkyAt(detail.id, detail.name, best.bestTime, site)}>
							Show in Sky at Best Time
						</Button>
					)}
					<Button variant="secondary" disabled={!located} title={located ? "Shows the radiant at the Sky's own time" : 'The catalog gives no radiant for this shower'} onClick={() => showRadiantInSky(detail.id, detail.name, site)}>
						Show Radiant in Sky
					</Button>
					{peak && peak.peakSolarLongitudeDecimals > 0 && (
						<Button variant="secondary" title="Sets the Sky clock to the published maximum and shows the radiant there" onClick={() => showRadiantInSkyAt(detail.id, detail.name, peak.peak, site)}>
							Show in Sky at Maximum
						</Button>
					)}
					<Button variant="secondary" disabled={!located} title={located ? 'Offers the shower to the Observing Planner as an observing event' : 'The catalog gives no radiant for this shower'} onClick={() => addShowerToPlanner(detail.id, detail.name)}>
						Add to Observing Planner
					</Button>
				</Actions>
			</div>

			{site && night && (
				<div className="flex flex-col gap-2">
					<SectionHeading as="h3">Radiant over the night</SectionHeading>
					<MeteorNightChart key={`${detail.id}|${night.eveningDate}`} night={night} name={detail.name} minimumAltitude={minimumAltitude} timeZone={timeZone} />
					<Notice>
						{`Judged against ${night.support.basis === 'none' ? 'no published activity period, so the windows only satisfy the geometry' : `the ${BASIS_LABELS[night.support.basis]} activity period`}. Geometric altitudes and the Moon geocentric, without horizon, terrain, or weather.${night.model ? ` Counts from the published profile for a limiting magnitude of ${formatFixed(night.model.limitingMagnitude, 1)}, r = ${formatFixed(night.model.populationIndex, 1)} (${night.model.populationIndexSource === 'profile' ? 'the profile' : 'yours'}), and F = ${formatFixed(night.model.obstructionCorrection, 2)}: what an ideal observer would count, never a forecast.` : ''}${forecast && night.windows.length > 0 ? ` Weather of Open-Meteo (${sourceStateText(forecast.meteorology.source)}) and 7Timer! (${sourceStateText(forecast.astronomy.source)}), assessed only when fresh; it never changes a window.` : ''}`}
					</Notice>
				</div>
			)}

			{site && (
				<div className="flex flex-col gap-2">
					<SectionHeading as="h3">Best nights</SectionHeading>
					<Actions>
						<Button variant="secondary" disabled={rankingLoading || !located} title={!located ? 'The catalog gives no radiant for this shower' : `Ranks ${rankedNights} evenings from this one, or around the maximum when the shower is not active on it`} onClick={onRank}>
							{rankingLoading ? 'Ranking…' : ranking ? 'Rank Again' : `Rank ${rankedNights} Nights`}
						</Button>
					</Actions>
					{rankingLoading && (
						<div className="flex flex-col gap-1">
							<ProgressBar />
							<Notice>{`Searching ${rankedNights} nights, under a second each.`}</Notice>
						</div>
					)}
					{rankingError && <Notice error>{rankingError}</Notice>}
					{ranking && <MeteorNightRanking ranking={ranking} eveningDate={eveningDate} onSelect={onEvening} />}
				</div>
			)}

			<div className="flex flex-col gap-2">
				<SectionHeading as="h3">Activity</SectionHeading>
				{activity ? <MeteorActivityChart curve={activity} timeZone={timeZone} now={Date.now()} /> : <Notice>Reading the activity…</Notice>}
				{activity?.profile && <Notice>Profile of Moorhead et al. (2019), the NASA Meteoroid Environment Office forecast parameters: a model of a typical year.</Notice>}
			</div>

			<details className="border-t border-line-100">
				<DisclosureSummary title="Visual data and events" />
				<div className="flex flex-col gap-2 pb-1">
					{visual ? (
						<>
							<DataList>
								<DataRow label="Typical ZHR at maximum">{visual.typicalZhr === undefined ? 'Variable' : `${visual.typicalZhr} per hour`}</DataRow>
								<DataRow label="Population index r">{formatFixed(visual.populationIndex, 1)}</DataRow>
								<DataRow label="Entry speed">{`${visual.velocity} km/s`}</DataRow>
								<DataRow label="Source">{detail.visualSource ? `${detail.visualSource.publisher}, ${detail.visualSource.title}` : MISSING}</DataRow>
							</DataList>
							<Notice>The ZHR is what an ideal observer would see with the radiant overhead under a limiting magnitude of 6.5, never a count expected from a site.</Notice>
						</>
					) : (
						<Notice>No curated visual data: no ZHR or visual maximum is known for this shower here.</Notice>
					)}
					{detail.annualEvents.length > 0 && (
						<ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-sm text-ink-200">
							{detail.annualEvents.map((event) => (
								<li key={event.id}>
									<span className="text-ink-100">{formatAnnualEvent(event, timeZone)}</span>
									<span className="block text-xs text-ink-300">{`${event.attribution}; ${ANNUAL_RELATION_LABELS[event.relation]}. IMO Meteor Shower Calendar ${event.year}.`}</span>
								</li>
							))}
						</ul>
					)}
					{detail.annualEvents.length > 0 && <Notice>Each event belongs to its year alone; a possible enhancement is not a predicted outburst, and none is a storm forecast.</Notice>}
					{!detail.annualPredictionAvailable && <Notice>No year-specific predictions were curated for this year; the visual values are the recurring baseline.</Notice>}
				</div>
			</details>

			<details className="border-t border-line-100">
				<DisclosureSummary title="Occurrences" />
				<div className="flex flex-col gap-2 pb-1">
					{detail.occurrences.length === 0 && <Notice>No source dates this shower in these years.</Notice>}
					{detail.occurrences.map((entry) => (
						<OccurrenceRows key={entry.visual?.start ?? entry.iau?.start ?? entry.iau?.reference} occurrence={entry} timeZone={timeZone} />
					))}
				</div>
			</details>

			<details className="border-t border-line-100">
				<DisclosureSummary title="IAU solutions">
					<span className="ml-auto text-xs text-ink-300">{STATUS_LABELS[detail.status]}</span>
				</DisclosureSummary>
				<div className="flex flex-col gap-2 pb-1">
					{detail.identity === 'snapshot' && <Notice>This record has no IAU number; its id comes from this edition of the catalog and may name another record after a refresh.</Notice>}
					<Notice>{SELECTION_LABELS[detail.selectedBy]}</Notice>
					{detail.gaps.length > 0 && (
						<ul className="m-0 list-disc pl-4 text-xs text-ink-300">
							{detail.gaps.map((gap) => (
								<li key={gap}>{GAP_LABELS[gap]}</li>
							))}
						</ul>
					)}
					<Table columns={SOLUTION_COLUMNS}>
						{detail.solutions.map((solution, index) => (
							<Row key={solution.solutionId ?? index} selected={index === detail.selected}>
								<Cell>{`${solution.solutionId ?? `#${index + 1}`}${index === detail.selected ? ' (preferred)' : ''}`}</Cell>
								<Cell>{solution.status ? STATUS_LABELS[solution.status] : MISSING}</Cell>
								<Cell title={solution.activity.source}>{ACTIVITY_KIND_LABELS[solution.activity.kind]}</Cell>
								<Cell>{solution.activityInterval ? `${formatSolarLongitude(solution.activityInterval.start, 1)}–${formatSolarLongitude(solution.activityInterval.end, 1).slice(3)}` : MISSING}</Cell>
								<Cell>{solution.rightAscension !== undefined && solution.declination !== undefined ? `${formatRightAscension(solution.rightAscension)} ${formatDeclination(solution.declination)}` : MISSING}</Cell>
								<Cell numeric>{solution.memberCount ?? MISSING}</Cell>
								<Cell>{solution.observationTechnique ?? MISSING}</Cell>
								<Cell title={solution.reference}>{solution.reference?.split('\n').at(-1) ?? MISSING}</Cell>
							</Row>
						))}
					</Table>
					{detail.selected !== undefined && detail.solutions[detail.selected].geocentricSpeed !== undefined && <Notice>{`Geocentric speed of the preferred solution: ${formatSpeed(kilometersPerSecond(detail.solutions[detail.selected].geocentricSpeed!), 1)}.`}</Notice>}
					{detail.selected !== undefined && detail.solutions[detail.selected].parentBody && <Notice>{`Parent body: ${detail.solutions[detail.selected].parentBody}.`}</Notice>}
				</div>
			</details>
		</section>
	)
}
