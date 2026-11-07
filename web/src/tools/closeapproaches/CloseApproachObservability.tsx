import type { MinorBody } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { formatDateTime, formatDegrees, formatLocalTime } from '../../format'
import { type ObservingSite, openObservingSites } from '../../location/site'
import { collapsibleSections, sectionOpen } from '../../shell/collapsible'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { formatDeclination, formatMagnitude, formatRightAscension, formatSolarSystemDistance } from '../../sky/format'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { closeApproachesState, loadCloseApproachObservability, OBSERVABILITY_INSTANTS, type ObservabilityInstant, observabilityKey, showInSky } from './closeapproaches'

// How the Close Approaches tool meets the Sky: the two explicit actions that show the object there, and the Observability
// section, read through the route of the Sky only while it is open, from the active observing site of the profile. Nothing
// here computes a position or changes the site or any device; the zone of the times only formats them.

// Section identifier of Observability, which keys its expanded state.
const OBSERVABILITY_SECTION = 'closeapproaches.observability'

// Name of each instant the section evaluates.
const INSTANT_LABELS: Readonly<Record<ObservabilityInstant, string>> = { approach: 'Approach', now: 'Now', sky: 'Sky Time' }

// Description of each reason an accurate position fell back to the local model.
const FALLBACK_REASONS = { timeout: 'Horizons did not answer in time', network: 'Horizons cannot be reached', breakerOpen: 'Horizons failed repeatedly and is paused', offline: 'the offline policy forbids asking Horizons' } as const

// Why the numbers of a close flyby are less certain than they read.
const FLYBY_NOTE = 'Rise, transit, and set come from a two-body orbit, and Horizons positions are interpolated every 10 minutes, so both lose accuracy during a very close flyby.'

interface SkyActionsProps {
	// Object of the encounter.
	readonly body: MinorBody
	// Instant of the encounter, Unix milliseconds (UTC).
	readonly time: number
	// Active observing site of the profile; absent when it has none.
	readonly site?: ObservingSite
}

// Actions that show the object in the Sky: one keeps the clock of the Sky, the other moves it to the encounter.
export function CloseApproachSkyActions({ body, time, site }: SkyActionsProps) {
	return (
		<div className="flex flex-wrap gap-2">
			<Button variant="secondary" title="Selects the object in the Sky. Its clock does not change." onClick={() => showInSky(body, site)}>
				Open in Sky
			</Button>
			<Button variant="secondary" title="Sets the clock of the Sky to the UTC instant of this encounter and selects the object." onClick={() => showInSky(body, site, time)}>
				View in Sky at Approach Time
			</Button>
		</div>
	)
}

// Sky position of the object at the instant chosen, read while the section is open. timeZone (IANA) only formats its
// times.
export function CloseApproachObservability({ body, time, site, timeZone }: SkyActionsProps & { readonly timeZone: string }) {
	const { observabilityInstant, observability, observabilityLoading, observabilityError } = useSnapshot(closeApproachesState)
	const open = sectionOpen(useSnapshot(collapsibleSections), OBSERVABILITY_SECTION, false)
	const position = observability?.position
	const events = observability?.events
	const load = () => void loadCloseApproachObservability(closeApproachesState, body, time, site)
	const key = observabilityKey(body.spkId, time, observabilityInstant, site)

	// Follows the object, the instant, and the place of the site while the section is open; the key holds what the request
	// depends on, never the zone of the times or the name of the site.
	useEffect(() => {
		if (open) load()
	}, [open, key])

	return (
		<CollapsibleSection id={OBSERVABILITY_SECTION} title="Observability" summary={site ? undefined : 'No observing site'} defaultOpen={false}>
			<SegmentedControl label="Instant" options={OBSERVABILITY_INSTANTS} value={observabilityInstant} format={(value) => INSTANT_LABELS[value]} onChange={(value) => (closeApproachesState.observabilityInstant = value)} />
			{!site && (
				<>
					<Notice>Altitude, azimuth, rise, and set need an observing site, so this position is geocentric.</Notice>
					<Button variant="secondary" className="self-start" onClick={() => openObservingSites()}>
						Set Location
					</Button>
				</>
			)}
			{observabilityLoading && !position && <p className="m-0 text-ink-300">Computing the position…</p>}
			{observabilityError && (
				<>
					<Notice error>Position unavailable: {observabilityError}</Notice>
					<Button variant="secondary" className="self-start" onClick={load}>
						Retry
					</Button>
				</>
			)}
			{position && (
				<>
					<DataRow label={`At (${timeZone})`}>{formatDateTime(position.time, timeZone)}</DataRow>
					{position.altitude !== undefined && <DataRow label="Altitude">{formatDeclination(position.altitude)}</DataRow>}
					{position.altitude !== undefined && position.altitude < 0 && <Notice>Below the horizon at this instant.</Notice>}
					{position.azimuth !== undefined && <DataRow label="Azimuth">{formatDegrees(position.azimuth)}</DataRow>}
					<DataRow label="RA (of date)">{formatRightAscension(position.rightAscension)}</DataRow>
					<DataRow label="Dec (of date)">{formatDeclination(position.declination)}</DataRow>
					<DataRow label="Constellation">{position.constellationName ?? position.constellation}</DataRow>
					{position.magnitude !== undefined && <DataRow label="Apparent magnitude">{formatMagnitude(position.magnitude)}</DataRow>}
					{position.distance !== undefined && <DataRow label="Distance">{formatSolarSystemDistance(position.distance)}</DataRow>}
					{events?.state === 'circumpolar' && <DataRow label="Rise and set">Circumpolar</DataRow>}
					{events?.state === 'belowHorizon' && <DataRow label="Rise and set">Below the horizon all day</DataRow>}
					{events?.rise !== undefined && <DataRow label="Rise">{formatLocalTime(events.rise, timeZone, position.time)}</DataRow>}
					{events?.transit !== undefined && <DataRow label="Transit">{formatLocalTime(events.transit, timeZone, position.time)}</DataRow>}
					{events?.set !== undefined && <DataRow label="Set">{formatLocalTime(events.set, timeZone, position.time)}</DataRow>}
					<Notice>
						Apparent {position.center} place from {position.source === 'horizons' ? 'JPL Horizons' : position.source === 'spk' ? 'the SPK kernels' : position.fallbackReason ? `the local model (${FALLBACK_REASONS[position.fallbackReason]})` : 'the local model'}.
					</Notice>
					<Notice>{FLYBY_NOTE}</Notice>
				</>
			)}
		</CollapsibleSection>
	)
}
