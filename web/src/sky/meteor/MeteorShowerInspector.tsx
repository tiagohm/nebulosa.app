import type { MeteorRadiantPath, MeteorShowerDetail, MeteorShowerStates } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatDateTime, formatDegrees, formatPercent } from '../../format'
import { fetchJson, jsonInit } from '../../http'
import { siteObserver, type SiteLocation } from '../../location/site'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { openMeteorShower } from '../../tools/meteorshowers/meteorshowers'
import { ACTIVITY_LABELS, BASIS_LABELS, formatOccurrencePeak, STATUS_LABELS } from '../../tools/meteorshowers/meteorshowers.format'
import { meteorShowerSourcesState } from '../../tools/meteorshowers/meteorshowers.sources'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { ObjectTitle } from '../../ui/ObjectTitle'
import { StatusBadge } from '../../ui/StatusBadge'
import { skyClock, skyTime } from '../clock'
import { showCoordinateInSky, skyImageState } from '../footprint'
import { formatDeclination, formatRightAscension } from '../format'
import { createRequestGuard } from '../selection'
import type { SkySelection } from '../sky'

// Object Inspector of a meteor shower radiant in the Sky: the shower's identity and status, its activity at the instant
// the Sky shows and which source decided it, the radiant at that instant (geocentric J2000 and of date, and for the
// profile's site its geometric altitude and azimuth with the Sun and the Moon), and its next maximum. The radiant is a
// direction, not an object: it has no distance, magnitude, rise, or set here, and no Slew, framing, or planner target is
// offered. Center on Radiant only pans the view; Open in Meteor Showers opens the tool on the shower.

// Spacing of the instants read while the Sky follows the real time, milliseconds: a radiant moves about 0.25° a minute
// across the sky, and its drift against the stars is negligible over a minute.
const STATE_STEP_MS = 60_000

// Requests of the inspector, through the browser's fetch.
const browserFetch = { fetch: (input: string, init?: RequestInit) => fetch(input, init) }

// Guard of the state requests of the inspector, each superseding its previous one.
const stateGuard = createRequestGuard()

// Guard of the detail requests of the inspector.
const detailGuard = createRequestGuard()

export interface MeteorShowerInspectorProps {
	// Selection of a radiant.
	readonly selection: SkySelection
	// Observing site of the active profile; absent when it has none.
	readonly observer?: SiteLocation
	// Opens Settings → Observing Sites to choose or add a site.
	readonly onSetObserver: () => void
	// IANA time zone times are shown in: the profile's display zone.
	readonly timeZone: string
}

// Meteor Shower Inspector.
export function MeteorShowerInspector({ selection, observer, onSetObserver, timeZone }: MeteorShowerInspectorProps) {
	const id = selection.ref.kind === 'meteorShower' ? selection.ref.id : ''
	const clock = useSnapshot(skyClock)
	const { revision } = useSnapshot(meteorShowerSourcesState)
	const [now, setNow] = useState(() => Date.now())
	const [states, setStates] = useState<MeteorShowerStates>()
	const [detail, setDetail] = useState<MeteorShowerDetail>()
	const [error, setError] = useState<string>()
	const [path, setPath] = useState<MeteorRadiantPath>()
	const time = Math.floor(skyTime(clock, now) / STATE_STEP_MS) * STATE_STEP_MS
	const place = observer ? `${observer.latitude},${observer.longitude},${observer.elevation}` : ''

	// The instant moves with the Sky clock; a real-time or playing clock is followed every STATE_STEP_MS.
	useEffect(() => {
		if (clock.mode === 'fixed') return
		const timer = setInterval(() => setNow(Date.now()), STATE_STEP_MS)
		return () => clearInterval(timer)
	}, [clock.mode])

	// The detail follows the shower and the catalog.
	useEffect(() => {
		const request = detailGuard.begin()
		setDetail(undefined)
		fetchJson<MeteorShowerDetail>(browserFetch, `/api/meteor-showers/${encodeURIComponent(id)}`, { signal: request.signal }).then(
			(answer) => request.current() && setDetail(answer),
			(cause: unknown) => request.current() && setError(cause instanceof Error ? cause.message : String(cause)),
		)
		return () => detailGuard.cancel()
	}, [id, revision])

	// The drift path the map draws, read for its dates; the server keeps it per day, so a new day reads it again.
	const day = Math.floor(time / 86400000)

	useEffect(() => {
		const controller = new AbortController()
		fetchJson<MeteorRadiantPath>(browserFetch, `/api/meteor-showers/${encodeURIComponent(id)}/path`, jsonInit('POST', { time }, controller.signal)).then(
			(answer) => !controller.signal.aborted && setPath(answer),
			() => !controller.signal.aborted && setPath(undefined),
		)
		return () => controller.abort()
	}, [id, day, revision])

	// The state follows the shower, the instant, the site's place, and the catalog.
	useEffect(() => {
		const request = stateGuard.begin()
		fetchJson<MeteorShowerStates>(browserFetch, '/api/meteor-showers/states', jsonInit('POST', { ids: [id], time, observer: siteObserver(observer) }, request.signal)).then(
			(answer) => {
				if (!request.current()) return
				setStates(answer)
				setError(undefined)
			},
			(cause: unknown) => request.current() && setError(cause instanceof Error ? cause.message : String(cause)),
		)
		return () => stateGuard.cancel()
	}, [id, time, place, revision])

	const state = states?.showers[0]
	const activity = state ? ACTIVITY_LABELS[state.activity] : undefined
	const radiant = state?.radiantJ2000
	const nextOccurrence = detail?.occurrences.find((occurrence) => (occurrence.visual?.peak ?? occurrence.iau?.reference ?? 0) >= time)

	return (
		<>
			<CollapsibleSection id="sky.meteor.info" summary={detail?.name ?? selection.name} title="Meteor Shower">
				<ObjectTitle name={detail?.name ?? selection.name} kind="Meteor shower radiant" designations={detail && [detail.code, detail.number === undefined ? undefined : `IAU ${detail.number}`, STATUS_LABELS[detail.status]].filter(Boolean).join(' · ')} />
				{activity && state && <StatusBadge tone={activity.tone} label={`${activity.label} (${BASIS_LABELS[state.activityBasis]})`} />}
				{error && <Notice error>{error}</Notice>}
				<Actions>
					<Button variant="secondary" disabled={!radiant} onClick={() => radiant && showCoordinateInSky(skyImageState, [radiant.rightAscension, radiant.declination], detail?.name ?? selection.name, false)}>
						Center on Radiant
					</Button>
					<Button variant="secondary" onClick={() => openMeteorShower(id)}>
						Open in Meteor Showers
					</Button>
				</Actions>
				<Notice>A radiant is the direction meteors of the shower seem to come from, not an object: it cannot be slewed to or framed.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="sky.meteor.radiant" title="Radiant">
				<DataRow label="Instant">{formatDateTime(time, timeZone, false)}</DataRow>
				{radiant ? (
					<>
						<DataRow label="RA (J2000)">{formatRightAscension(radiant.rightAscension)}</DataRow>
						<DataRow label="Dec (J2000)">{formatDeclination(radiant.declination)}</DataRow>
						{state?.radiantOfDate && <DataRow label="RA (of date)">{formatRightAscension(state.radiantOfDate.rightAscension)}</DataRow>}
						{state?.radiantOfDate && <DataRow label="Dec (of date)">{formatDeclination(state.radiantOfDate.declination)}</DataRow>}
						{state?.radiantAtReference ? <Notice>Far from its activity: the catalog position at the reference solar longitude, not moved by the drift.</Notice> : state?.radiantExtrapolated && <Notice>Moved from its catalog position by its daily drift.</Notice>}
					</>
				) : (
					state && <Notice>The catalog gives no radiant for this shower at this instant.</Notice>
				)}
				{observer && state?.altitude !== undefined && state.azimuth !== undefined && (
					<>
						<DataRow label="Altitude (geometric)">{formatDegrees(state.altitude, 1)}</DataRow>
						<DataRow label="Azimuth">{formatDegrees(state.azimuth, 1)}</DataRow>
					</>
				)}
				{observer && states?.sunAltitude !== undefined && <DataRow label="Sun altitude">{formatDegrees(states.sunAltitude, 1)}</DataRow>}
				{states?.moonIllumination !== undefined && (
					<DataRow label="Moon">{`${formatPercent(states.moonIllumination)} lit${states.moonAltitude !== undefined ? `, ${formatDegrees(states.moonAltitude, 0)} high` : ''}${state?.moonSeparation !== undefined ? `, ${formatDegrees(state.moonSeparation, 0)} from the radiant` : ''}`}</DataRow>
				)}
				{!observer && (
					<Notice>
						<span className="block">Without a site the radiant is geocentric: no altitude or azimuth.</span>
						<Button variant="secondary" className="mt-2" onClick={onSetObserver}>
							Set Location
						</Button>
					</Notice>
				)}
				{path?.start !== undefined && path.end !== undefined && path.segments.length > 0 && (
					<Notice>{`The dashed line on the map is the radiant moved by its drift over ${formatDateTime(path.start, timeZone, false).slice(0, 10)} to ${formatDateTime(path.end, timeZone, false).slice(0, 10)}, drawn in the frame of the map's stars.`}</Notice>
				)}
				{state?.altitude !== undefined && state.altitude < 0 && <Notice>The radiant is below the horizon: no meteor of the shower is seen from here now.</Notice>}
			</CollapsibleSection>
			{detail && (
				<CollapsibleSection id="sky.meteor.activity" title="Activity">
					{detail.visual?.typicalZhr !== undefined && <DataRow label="Typical ZHR (IMO)">{`${detail.visual.typicalZhr} per hour at maximum`}</DataRow>}
					<DataRow label="Next">{formatOccurrencePeak(nextOccurrence, timeZone)}</DataRow>
					{!detail.visual && <Notice>No curated visual data: no ZHR or visual maximum is known for this shower here.</Notice>}
				</CollapsibleSection>
			)}
		</>
	)
}
