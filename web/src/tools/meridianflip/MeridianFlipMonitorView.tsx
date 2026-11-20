import type { MeridianFlipMonitor, MeridianTransitionKind } from 'api'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../../equipment-control/control'
import type { RoleDevice } from '../../equipment/useEquipment'
import { formatClockTime, formatFixed, formatGeographic, formatHourAngle, formatLocalTime, MISSING } from '../../format'
import { useActiveSite, useActiveTimeZone } from '../../location/useLocation'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { Cell, Row, Table } from '../../ui/Table'
import { MERIDIAN_AVAILABILITY_LABELS, MERIDIAN_PIER_SIDES, meridianFlipState, meridianHourAngle, monitorKey, MOUNT_SITE_LONGITUDE_TOLERANCE, mountSiteLongitudeOffset } from './meridianflip'
import { FlipSection } from './MeridianFlipSection'

// Monitor section of the Meridian Flip tool: what the server's monitor of the MOUNT of the Equipment Setup observes
// (its state, the hour angle, the instants of the passage, the tracking, the pier sides, and the site the forecast
// follows) and the transitions it reported. Nothing here commands the mount; the monitor is enabled, disabled, and set
// from the workspace actions and the contextual panel of the tool.

// Text of each transition.
const TRANSITIONS: Readonly<Record<MeridianTransitionKind, string>> = {
	approaching: 'Approaching the meridian',
	upperMeridianCrossed: 'Crossed the meridian',
	windowOpened: 'Preferred window opened',
	flipCandidate: 'Flip may be needed',
	deadlineApproaching: 'Preferred window closing',
	deadlinePassed: 'Preferred window closed with a flip pending',
	pierSideChanged: 'Pier side changed',
	externalFlipSuspected: 'Pier side changed after a motion (not verified)',
	targetChanged: 'Target changed',
	monitorUnavailable: 'Mount telemetry lost',
	monitorRecovered: 'Mount telemetry recovered',
}

interface MeridianFlipMonitorViewProps {
	// Mount of the Equipment Setup.
	readonly mount: RoleDevice
	// Monitor of that mount; absent while it is not enabled.
	readonly monitor?: MeridianFlipMonitor
	// Instant the interpolations are made at, in Unix milliseconds.
	readonly now: number
}

// Monitor section for the mount of the Equipment Setup and its monitor: the observation beside the recent events.
export function MeridianFlipMonitorView({ mount, monitor, now }: MeridianFlipMonitorViewProps) {
	const key = mount.device ? monitorKey(mount.device.connectionId, mount.device.id) : undefined

	return (
		<div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
			<ObservationSection mount={mount} monitor={monitor} now={now} />
			<EventsSection monitorKey={key} now={now} />
		</div>
	)
}

// What the monitor observes at instant now (Unix milliseconds): its state, the hour angle, the instants of the passage,
// the tracking, the pier sides, and the site the forecast follows, warned about when it is not the active observing
// site's.
function ObservationSection({ mount, monitor, now }: MeridianFlipMonitorViewProps) {
	const timeZone = useActiveTimeZone()
	const control = useSnapshot(controlRuntime)
	const site = useActiveSite()

	if (!monitor) {
		return (
			<FlipSection title="Observation">
				<Notice>The observation of the mount shows here once the monitor is enabled.</Notice>
			</FlipSection>
		)
	}

	const { timing, mount: view } = monitor
	const hourAngle = meridianHourAngle(monitor, now)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const mountSite = monitor.reason === 'noSite' ? undefined : mountState?.site
	const offset = mountSite && site ? mountSiteLongitudeOffset(toDeg(mountSite.longitude), site.longitude) : undefined

	return (
		<FlipSection title="Observation">
			<DataList>
				<DataRow label="Status">{MERIDIAN_AVAILABILITY_LABELS[monitor.availability]}</DataRow>
				<DataRow label={timing.phase === 'unavailable' ? 'Hour angle (geometry only)' : 'Hour angle'}>{hourAngle === undefined ? MISSING : formatHourAngle(hourAngle)}</DataRow>
				<DataRow label="Transit">{timing.transitAt === undefined ? MISSING : formatLocalTime(timing.transitAt, timeZone, now)}</DataRow>
				<DataRow label="Window">{timing.windowOpensAt === undefined || timing.windowClosesAt === undefined ? MISSING : `${formatLocalTime(timing.windowOpensAt, timeZone, now)} to ${formatLocalTime(timing.windowClosesAt, timeZone, now)}`}</DataRow>
				<DataRow label="Forecast">{timing.quality === 'valid' ? 'Sidereal tracking' : timing.quality === 'approximate' ? 'Approximate' : MISSING}</DataRow>
				<DataRow label="Tracking">{view.tracking ? view.trackMode.toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'Off'}</DataRow>
				<DataRow label="Pier side (reported)">{MERIDIAN_PIER_SIDES[view.pierSide]}</DataRow>
				<DataRow label="Pier side (geometric)">{view.expectedPierSide ? MERIDIAN_PIER_SIDES[view.expectedPierSide] : MISSING}</DataRow>
				<DataRow label="Mount site">{monitor.reason === 'noSite' ? 'Not reported' : mountSite ? formatGeographic(toDeg(mountSite.latitude), toDeg(mountSite.longitude)) : MISSING}</DataRow>
				<DataRow label="Sampled">{formatClockTime(monitor.sampledAt, timeZone, { seconds: true })}</DataRow>
			</DataList>
			{offset !== undefined && Math.abs(offset) > MOUNT_SITE_LONGITUDE_TOLERANCE && (
				<Notice>
					The forecast follows the site the mount reports, {formatFixed(Math.abs(offset), 2)}° {offset > 0 ? 'east' : 'west'} of the active observing site, so its instants come about {formatFixed(Math.abs(offset) * 4, 0)} min {offset > 0 ? 'early' : 'late'} for the sky of the site. Send the active site to the
					mount from Equipment Control.
				</Notice>
			)}
		</FlipSection>
	)
}

// Recent transitions of the monitor, newest first, at instant now (Unix milliseconds).
function EventsSection({ monitorKey: key, now }: { readonly monitorKey?: string; readonly now: number }) {
	const timeZone = useActiveTimeZone()
	const state = useSnapshot(meridianFlipState)
	const transitions = key ? (state.transitions[key] ?? []) : []

	return (
		<FlipSection title="Recent Events">
			{transitions.length > 0 ? (
				<div className="max-h-80 overflow-y-auto">
					<Table columns={['Time', 'Event', 'Pier side']}>
						{transitions.toReversed().map((transition) => (
							<Row key={transition.transitionId}>
								<Cell numeric>{formatLocalTime(transition.at, timeZone, now)}</Cell>
								<Cell>{TRANSITIONS[transition.kind]}</Cell>
								<Cell>{transition.previousPierSide ? `${MERIDIAN_PIER_SIDES[transition.previousPierSide]} → ${MERIDIAN_PIER_SIDES[transition.pierSide]}` : MERIDIAN_PIER_SIDES[transition.pierSide]}</Cell>
							</Row>
						))}
					</Table>
				</div>
			) : (
				<Notice>No events yet; the server keeps them while the monitor is enabled.</Notice>
			)}
		</FlipSection>
	)
}
