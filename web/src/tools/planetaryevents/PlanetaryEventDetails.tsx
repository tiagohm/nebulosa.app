import type { PlanetaryEvent, PlanetaryEventSeries, PlanetaryEventsSignature, PlanetaryEventVisibility } from 'api'
import { formatDate, formatDateTime, formatDegrees, formatFixed, formatPercent, formatSpan, MISSING } from '../../format'
import type { SiteLocation } from '../../location/site'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { PlanetaryEventChart } from './PlanetaryEventChart'
import { addPlanetToPlanner, showPlanetInSky, showPlanetInSkyAt } from './planetaryevents'
import { BODY_LABELS, bodiesLabel, describeSource, eventTitle, formatDistance, formatOffset, KIND_DEFINITIONS, primaryValue, reasonLabel, STATUS_LABELS, STATUS_TONES } from './planetaryevents.format'

// Inspector of the selected event: its definition, its geocentric instant in the display zone and in UTC, the
// circumstances of its planets, how it can be watched from the site (at the instant and in the best nearby window, told
// apart), its source, its curves, its related events, and the explicit handoffs. Show in Sky keeps the Sky's clock; only
// Set Sky Time to Event changes it. Nothing here moves the mount.

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
	signature,
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
	readonly signature?: PlanetaryEventsSignature
	readonly timeZone: string
	readonly site?: SiteLocation
	readonly onSelect: (id: string) => void
}) {
	const related = all.filter((e) => event.relatedIds.includes(e.id))
	const chart = series && series.time === event.time && series.kind === event.kind ? series : undefined

	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-md border border-line-100 bg-base-100 p-3">
			<header className="flex flex-col gap-1">
				<h2 className="m-0 text-sm font-semibold text-ink-100">
					{eventTitle(event)} · {bodiesLabel(event)}
				</h2>
				<p className="m-0 text-xs text-ink-300">{KIND_DEFINITIONS[event.kind]}</p>
			</header>
			<DataList>
				<DataRow label="Event time">{formatDateTime(event.time, timeZone, false)}</DataRow>
				<DataRow label="UTC">{formatDateTime(event.time, 'UTC', false)}</DataRow>
				<DataRow label="Value">{primaryValue(event)}</DataRow>
			</DataList>
			{event.circumstances.map((body) => (
				<div key={body.body} className="flex flex-col gap-1">
					<h3 className="m-0 text-xs font-semibold text-ink-200">{BODY_LABELS[body.body]} at the event</h3>
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
			<div className="flex flex-col gap-1">
				<h3 className="m-0 text-xs font-semibold text-ink-200">From the site</h3>
				{!hasSite && <p className="m-0 text-xs text-ink-300">No site: the event is geocentric and listed without local visibility.</p>}
				{hasSite && !visibility && <p className="m-0 text-xs text-ink-300">{visibilityLoading ? 'Computing the visibility…' : 'Visibility not computed.'}</p>}
				{visibility && <VisibilityRows visibility={visibility} event={event} timeZone={timeZone} />}
			</div>
			<div className="flex flex-col gap-1">
				<h3 className="m-0 text-xs font-semibold text-ink-200">Curve</h3>
				{chart && <PlanetaryEventChart series={chart} />}
				{!chart && seriesLoading && <p className="m-0 text-xs text-ink-300">Sampling the curve…</p>}
				{seriesError && <Notice error>{seriesError}</Notice>}
			</div>
			{related.length > 0 && (
				<div className="flex flex-col gap-1">
					<h3 className="m-0 text-xs font-semibold text-ink-200">Related events</h3>
					{related.map((e) => (
						<Button key={e.id} variant="ghost" className="justify-start" onClick={() => onSelect(e.id)}>
							{eventTitle(e)} · {formatDateTime(e.time, timeZone, false)}
						</Button>
					))}
				</div>
			)}
			<p className="m-0 text-xs text-ink-300">{describeSource(signature) ?? ''}. Geocentric apparent positions on the true ecliptic of date; the site never changes the event time.</p>
			{event.bodies.map((code) => (
				<Actions key={code}>
					<Button variant="secondary" onClick={() => showPlanetInSky(code, site)}>
						Show {BODY_LABELS[code]} in Sky
					</Button>
					<Button variant="secondary" onClick={() => showPlanetInSkyAt(code, event.time, site)}>
						Set Sky Time to Event
					</Button>
					<Button variant="secondary" onClick={() => addPlanetToPlanner(code)}>
						Add {BODY_LABELS[code]} to Observing Planner
					</Button>
				</Actions>
			))}
		</section>
	)
}

// Visibility of the event from the site: at its instant, and the best nearby window with its offset.
function VisibilityRows({ visibility, event, timeZone }: { readonly visibility: PlanetaryEventVisibility; readonly event: PlanetaryEvent; readonly timeZone: string }) {
	const { atEvent, bestWindow } = visibility
	return (
		<>
			<p className="m-0">
				<StatusBadge tone={STATUS_TONES[visibility.status]} label={STATUS_LABELS[visibility.status]} />
			</p>
			<DataList>
				<DataRow label="Profile">
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
						<DataRow label="Window vs event">{formatOffset(bestWindow.offsetMs)}</DataRow>
						<DataRow label="Peak altitude">{bestWindow.peakAltitudes.map((peak, i) => `${BODY_LABELS[event.bodies[i]]} ${formatDegrees(peak, 0)}`).join(', ')}</DataRow>
						{bestWindow.separation !== undefined && <DataRow label="Separation in the window">{formatDegrees(bestWindow.separation, 2)}</DataRow>}
					</>
				)}
			</DataList>
			{visibility.reasons.map((reason) => (
				<p key={reason} className="m-0 text-xs text-ink-300">
					{reasonLabel(reason, visibility)}
				</p>
			))}
			{event.kind === 'station' && <p className="m-0 text-xs text-ink-300">A station is an instant of zero motion: the turn is seen by comparing the planet against the stars over several nights.</p>}
			<p className="m-0 text-xs text-ink-300">Geometric altitudes, without refraction, terrain, or weather.</p>
		</>
	)
}
