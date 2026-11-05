import type { MinorBody } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { formatDegrees } from '../../format'
import type { SkyObserverSettings } from '../../profile/schema'
import { collapsibleSections, sectionOpen } from '../../shell/collapsible'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { navigate, routeState } from '../../shell/route'
import { formatDeclination, formatLocalTime, formatMagnitude, formatRightAscension, formatSolarSystemDistance } from '../../sky/format'
import { Note } from '../../sky/InspectorParts'
import { skyState } from '../../sky/sky'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { closeApproachesState, formatApproachTime, loadCloseApproachObservability, OBSERVABILITY_INSTANTS, type ObservabilityInstant, showInSky } from './closeapproaches'

// How the Close Approaches tool meets the Sky: the two explicit actions that show the object there, and the Observability
// section, read through the route of the Sky only while it is open. Nothing here computes a position or changes the
// observer or any device.

// Section identifier of Observability, which keys its expanded state.
const OBSERVABILITY_SECTION = 'closeapproaches.observability'

// Name of each instant the section evaluates.
const INSTANT_LABELS: Readonly<Record<ObservabilityInstant, string>> = { approach: 'Approach', now: 'Now', sky: 'Sky Time' }

// Description of each reason an accurate position fell back to the local model.
const FALLBACK_REASONS = { timeout: 'Horizons did not answer in time', network: 'Horizons cannot be reached', breakerOpen: 'Horizons failed repeatedly and is paused' } as const

// Why the numbers of a close flyby are less certain than they read.
const FLYBY_NOTE = 'Rise, transit, and set come from a two-body orbit, and Horizons positions are interpolated every 10 minutes, so both lose accuracy during a very close flyby.'

// Opens the Observer panel of the Sky.
function openObserver() {
	skyState.panel = 'observer'
	navigate(routeState, { workspace: 'sky' })
}

interface SkyActionsProps {
	// Object of the encounter.
	readonly body: MinorBody
	// Instant of the encounter, Unix milliseconds (UTC).
	readonly time: number
	// Observer of the profile.
	readonly observer?: SkyObserverSettings
}

// Actions that show the object in the Sky: one keeps the clock of the Sky, the other moves it to the encounter.
export function CloseApproachSkyActions({ body, time, observer }: SkyActionsProps) {
	return (
		<div className="flex flex-wrap gap-2">
			<Button variant="secondary" title="Selects the object in the Sky. Its clock does not change." onClick={() => showInSky(body, observer)}>
				Open in Sky
			</Button>
			<Button variant="secondary" title="Sets the clock of the Sky to the UTC instant of this encounter and selects the object." onClick={() => showInSky(body, observer, time)}>
				View in Sky at Approach Time
			</Button>
		</div>
	)
}

// Sky position of the object at the instant chosen, read while the section is open.
export function CloseApproachObservability({ body, time, observer, timeZone }: SkyActionsProps & { readonly timeZone: string }) {
	const { observabilityInstant, observability, observabilityLoading, observabilityError } = useSnapshot(closeApproachesState)
	const open = sectionOpen(useSnapshot(collapsibleSections), OBSERVABILITY_SECTION, false)
	const position = observability?.position
	const events = observability?.events
	const load = () => void loadCloseApproachObservability(closeApproachesState, body, time, observer)

	// Follows the object, the instant, and the observer while the section is open; the key holds what the request depends on.
	useEffect(() => {
		if (open) load()
	}, [open, body.spkId, time, observabilityInstant, observer?.latitude, observer?.longitude, observer?.elevation])

	return (
		<CollapsibleSection id={OBSERVABILITY_SECTION} title="Observability" summary={observer ? undefined : 'No observer'} defaultOpen={false}>
			<SegmentedControl label="Instant" options={OBSERVABILITY_INSTANTS} value={observabilityInstant} format={(value) => INSTANT_LABELS[value]} onChange={(value) => (closeApproachesState.observabilityInstant = value)} />
			{!observer && (
				<>
					<Note>Altitude, azimuth, rise, and set need the observer&apos;s location, so this position is geocentric.</Note>
					<Button variant="secondary" className="self-start" onClick={openObserver}>
						Set Sky Observer
					</Button>
				</>
			)}
			{observabilityLoading && !position && <p className="m-0 text-ink-300">Computing the position…</p>}
			{observabilityError && (
				<>
					<Note danger>Position unavailable: {observabilityError}</Note>
					<Button variant="secondary" className="self-start" onClick={load}>
						Retry
					</Button>
				</>
			)}
			{position && (
				<>
					<DataRow label={`At (${timeZone})`}>{formatApproachTime(position.time, timeZone)}</DataRow>
					{position.altitude !== undefined && <DataRow label="Altitude">{formatDeclination(position.altitude)}</DataRow>}
					{position.altitude !== undefined && position.altitude < 0 && <Note>Below the horizon at this instant.</Note>}
					{position.azimuth !== undefined && <DataRow label="Azimuth">{formatDegrees(position.azimuth)}</DataRow>}
					<DataRow label="RA (of date)">{formatRightAscension(position.rightAscension)}</DataRow>
					<DataRow label="Dec (of date)">{formatDeclination(position.declination)}</DataRow>
					<DataRow label="Constellation">{position.constellationName ?? position.constellation}</DataRow>
					{position.magnitude !== undefined && <DataRow label="Apparent magnitude">{formatMagnitude(position.magnitude)}</DataRow>}
					{position.distance !== undefined && <DataRow label="Distance">{formatSolarSystemDistance(position.distance)}</DataRow>}
					{events?.state === 'circumpolar' && <DataRow label="Rise and set">Circumpolar</DataRow>}
					{events?.state === 'belowHorizon' && <DataRow label="Rise and set">Below the horizon all day</DataRow>}
					{events?.rise !== undefined && <DataRow label="Rise">{formatLocalTime(events.rise, position.time, undefined, timeZone)}</DataRow>}
					{events?.transit !== undefined && <DataRow label="Transit">{formatLocalTime(events.transit, position.time, undefined, timeZone)}</DataRow>}
					{events?.set !== undefined && <DataRow label="Set">{formatLocalTime(events.set, position.time, undefined, timeZone)}</DataRow>}
					<Note>
						Apparent {position.center} place from {position.source === 'horizons' ? 'JPL Horizons' : position.fallbackReason ? `the local model (${FALLBACK_REASONS[position.fallbackReason]})` : 'the local model'}.
					</Note>
					<Note>{FLYBY_NOTE}</Note>
				</>
			)}
		</CollapsibleSection>
	)
}
