import type { PlanetaryEvent, PlanetaryEventBody, PlanetaryEventSeries, PlanetaryEventVisibility } from 'api'
import { useState } from 'react'
import { formatDate, formatDateTime, formatDegrees, formatFixed, formatPercent, formatSpan, formatZonedDateTime, MISSING } from '../../format'
import type { SiteLocation } from '../../location/site'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { DisclosureSummary } from '../../ui/DisclosureSummary'
import { Notice } from '../../ui/Notice'
import { SectionHeading } from '../../ui/SectionHeading'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { StatusBadge } from '../../ui/StatusBadge'
import { PlanetaryEventChart } from './PlanetaryEventChart'
import { addPlanetToPlanner, showPlanetInSky, showPlanetInSkyAt, windowMiddle } from './planetaryevents'
import { BODY_LABELS, eventName, eventTitle, formatDistance, KIND_DEFINITIONS, primaryValue, reasonLabel, STATUS_LABELS, STATUS_TONES, statusTitle, windowTiming } from './planetaryevents.format'

// Inspector of the selected event, answer first: its name, how it can be watched from the site in one line (the best
// window, or why it cannot be), its instant in the display zone, and the explicit handoffs; then the visibility in full,
// the curve, the circumstances of its planets (collapsed), and its related events. For a pair the handoffs act on the
// planet chosen. Show in Sky keeps the Sky's clock; Show in Sky at Best Window sets it to the middle of the best window and
// Show in Sky at Event Time to the event's instant. Nothing here moves the mount. The parent keys it by the event, so the
// planet chosen starts on the first one of each event.

// Inspector of an event.
export function PlanetaryEventDetails({
	event,
	all,
	visibility,
	hasSite,
	visibilityLoading,
	series,
	seriesLoading,
	seriesError,
	timeZone,
	site,
	onSelect,
}: {
	readonly event: PlanetaryEvent
	readonly all: readonly PlanetaryEvent[]
	readonly visibility?: PlanetaryEventVisibility
	readonly hasSite: boolean
	readonly visibilityLoading: boolean
	readonly series?: PlanetaryEventSeries
	readonly seriesLoading: boolean
	readonly seriesError?: string
	readonly timeZone: string
	readonly site?: SiteLocation
	readonly onSelect: (id: string) => void
}) {
	const [code, setCode] = useState<PlanetaryEventBody>(event.bodies[0])
	const related = all.filter((e) => event.relatedIds.includes(e.id))
	const chart = series && series.time === event.time && series.kind === event.kind ? series : undefined
	const best = visibility?.bestWindow
	const pair = event.bodies.length > 1

	return (
		<section className="flex min-w-0 flex-col gap-4 rounded-md border border-line-100 bg-base-100 p-3">
			<header className="flex flex-col gap-2">
				<h2 className="m-0 text-sm font-semibold text-ink-100">{eventName(event)}</h2>
				{visibility && <StatusBadge tone={STATUS_TONES[visibility.status]} label={STATUS_LABELS[visibility.status]} title={statusTitle(visibility.status, pair)} />}
				<p className="m-0 text-sm text-ink-100">
					<Summary event={event} visibility={visibility} hasSite={hasSite} visibilityLoading={visibilityLoading} timeZone={timeZone} />
				</p>
				<DataList>
					<DataRow label="Event time">{formatZonedDateTime(event.time, timeZone, false)}</DataRow>
					<DataRow label="Value">{primaryValue(event)}</DataRow>
				</DataList>
			</header>
			<div className="flex flex-col gap-2">
				{pair && <SegmentedControl label="Planet" options={event.bodies} value={code} format={(value) => BODY_LABELS[value]} onChange={setCode} />}
				<Actions>
					{best && (
						<Button variant="primary" title="Sets the Sky clock to the middle of the best window and shows the planet there" onClick={() => showPlanetInSkyAt(code, windowMiddle(best), site)}>
							Show in Sky at Best Window
						</Button>
					)}
					<Button variant="secondary" title="Sets the Sky clock to the instant of the event and shows the planet there" onClick={() => showPlanetInSkyAt(code, event.time, site)}>
						Show in Sky at Event Time
					</Button>
					<Button variant="secondary" title="Shows the planet at the Sky's own time" onClick={() => showPlanetInSky(code, site)}>
						Show in Sky
					</Button>
					<Button variant="secondary" title="Adds the planet to the Observing Planner as a target" onClick={() => addPlanetToPlanner(code)}>
						Add to Observing Planner
					</Button>
				</Actions>
			</div>
			<p className="m-0 text-sm text-ink-200">{KIND_DEFINITIONS[event.kind]}</p>
			{visibility && <VisibilitySection visibility={visibility} event={event} timeZone={timeZone} />}
			<div className="flex flex-col gap-2">
				<SectionHeading>Curve</SectionHeading>
				{chart && <PlanetaryEventChart series={chart} />}
				{!chart && seriesLoading && <Notice>Sampling the curve…</Notice>}
				{seriesError && <Notice error>{seriesError}</Notice>}
			</div>
			<details className="border-t border-line-100">
				<DisclosureSummary title="Circumstances at the event" />
				<div className="flex flex-col gap-3 pb-1">
					{event.circumstances.map((body) => (
						<div key={body.body} className="flex flex-col gap-1">
							<h4 className="m-0 text-sm font-semibold text-ink-200">{BODY_LABELS[body.body]}</h4>
							<DataList>
								<DataRow label="Ecliptic longitude, latitude">
									{formatDegrees(body.longitude, 2)}, {formatDegrees(body.latitude, 2)}
								</DataRow>
								<DataRow label="Elongation from the Sun">{formatDegrees(body.elongation, 1)}</DataRow>
								<DataRow label="Distance from the Earth">{formatDistance(body.earthDistance)}</DataRow>
								<DataRow label="Illuminated">{formatPercent(body.illuminatedFraction, 1)}</DataRow>
								<DataRow label="Magnitude">{body.magnitude === undefined ? MISSING : formatFixed(body.magnitude, 2)}</DataRow>
							</DataList>
						</div>
					))}
					<Notice>Geocentric apparent positions on the true ecliptic of date; the site never changes the event time.</Notice>
				</div>
			</details>
			{related.length > 0 && (
				<div className="flex flex-col gap-1">
					<SectionHeading>Related events</SectionHeading>
					{related.map((e) => (
						<Button key={e.id} variant="ghost" className="justify-start" onClick={() => onSelect(e.id)}>
							{eventTitle(e)} · {formatDateTime(e.time, timeZone, false)}
						</Button>
					))}
				</div>
			)}
		</section>
	)
}

// One line saying how the event can be watched: the best window with its timing and peak altitudes, the first reason it
// cannot be, or why nothing is known yet.
function Summary({ event, visibility, hasSite, visibilityLoading, timeZone }: { readonly event: PlanetaryEvent; readonly visibility?: PlanetaryEventVisibility; readonly hasSite: boolean; readonly visibilityLoading: boolean; readonly timeZone: string }) {
	if (!hasSite) return 'No observing site: the event is listed without its local visibility.'
	if (!visibility) return visibilityLoading ? 'Computing the visibility…' : 'Visibility not computed.'
	const best = visibility.bestWindow

	if (best) {
		const peaks = best.peakAltitudes.map((peak, i) => `${BODY_LABELS[event.bodies[i]]} ${formatDegrees(peak, 0)}`).join(', ')
		return `Best window ${formatDate(best.start, timeZone)} ${formatSpan(best.start, best.end, timeZone)} (${best.period}), which ${windowTiming(best.offsetMs)}; peak altitude ${peaks}.`
	}

	return visibility.reasons.length > 0 ? reasonLabel(visibility.reasons[0], visibility) : statusTitle(visibility.status, event.bodies.length > 1)
}

// Visibility of the event from the site in full: the criteria, the planets and the Sun at its instant, the best window,
// and the reasons the summary does not already give, with the limits of the geometry.
function VisibilitySection({ visibility, event, timeZone }: { readonly visibility: PlanetaryEventVisibility; readonly event: PlanetaryEvent; readonly timeZone: string }) {
	const { atEvent, bestWindow } = visibility
	return (
		<div className="flex flex-col gap-2">
			<SectionHeading>From the site</SectionHeading>
			<DataList>
				<DataRow label="Criteria">
					{visibility.profile === 'twilight' ? 'Twilight' : 'Night'}: planets ≥ {formatDegrees(visibility.minimumAltitude, 0)}, Sun ≤ {formatDegrees(visibility.maximumSunAltitude, 0)}
				</DataRow>
				{atEvent.bodies.map((body) => (
					<DataRow key={body.body} label={`${BODY_LABELS[body.body]} at the event`}>
						altitude {formatDegrees(body.altitude, 1)}, azimuth {formatDegrees(body.azimuth, 0)}
					</DataRow>
				))}
				<DataRow label="Sun at the event">{formatDegrees(atEvent.sunAltitude, 1)}</DataRow>
				{bestWindow && (
					<>
						<DataRow label="Best window">
							{formatDate(bestWindow.start, timeZone)} {formatSpan(bestWindow.start, bestWindow.end, timeZone)} ({bestWindow.period})
						</DataRow>
						<DataRow label="Window timing">{windowTiming(bestWindow.offsetMs)}</DataRow>
						<DataRow label="Peak altitude">{bestWindow.peakAltitudes.map((peak, i) => `${BODY_LABELS[event.bodies[i]]} ${formatDegrees(peak, 0)}`).join(', ')}</DataRow>
						{bestWindow.separation !== undefined && <DataRow label="Separation in the window">{formatDegrees(bestWindow.separation, 2)}</DataRow>}
					</>
				)}
			</DataList>
			{visibility.reasons.slice(bestWindow ? 0 : 1).map((reason) => (
				<Notice key={reason}>{reasonLabel(reason, visibility)}</Notice>
			))}
			{event.kind === 'station' && <Notice>A station is an instant of zero motion: the turn is seen by comparing the planet against the stars over several nights.</Notice>}
			<Notice>Geometric altitudes, without refraction, terrain, or weather.</Notice>
		</div>
	)
}
