import type { MeridianFlipMonitor, MeridianFlipSettings, MeridianMechanicalAssessment, MeridianMonitorReason, MeridianTransitionKind } from 'api'
import { cn } from 'cn'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../../equipment-control/control'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { MOUNT_ROLE_BLOCKERS } from '../../equipment/equipment'
import { EquipmentSetupButton } from '../../equipment/EquipmentSetupButton'
import { type RoleDevice, useRoleDevice } from '../../equipment/useEquipment'
import { formatClockDuration, formatClockTime, formatFixed, formatGeographic, formatHourAngle, formatLocalTime, MISSING } from '../../format'
import { useActiveSite, useActiveTimeZone } from '../../location/useLocation'
import { activeProfile, meridianFlipSettings, profileCamera, profileState, setMeridianFlipSettings } from '../../profile/profile'
import { MERIDIAN_FLIP_MAXIMUM_SECONDS } from '../../profile/schema'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { StatusBadge, type StatusTone } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { useNow } from '../../useNow'
import {
	disableMeridianFlip,
	enableMeridianFlip,
	formatTransitOffset,
	loadMeridianFlipTransitions,
	MERIDIAN_AVAILABILITY_LABELS,
	MERIDIAN_FLIP_MAXIMUM_SETTLE_SECONDS,
	MERIDIAN_PIER_SIDES,
	type MeridianFlipSection,
	meridianFlipState,
	meridianFlipView,
	meridianHourAngle,
	meridianPhaseText,
	monitorKey,
	MOUNT_SITE_LONGITUDE_TOLERANCE,
	mountSiteLongitudeOffset,
	nextMeridianEvent,
	normalizeMeridianFlipSettings,
	sameMeridianFlipSettings,
	secondsToTransit,
	updateMeridianFlipSettings,
} from './meridianflip'
import { latestExecution, meridianFlipExecutorState } from './meridianflipexecutor'
import { ExecutorPanelSections, FlipStrip, MeridianFlipExecutorSections } from './MeridianFlipExecutorView'
import { MeridianFlipGuide } from './MeridianFlipGuide'
import { FlipSection } from './MeridianFlipSection'

// Meridian Flip tool, laid out as one passage of the target the MOUNT of the active profile's Equipment Setup tracks:
// a readout of where it stands (the time to or since the upper transit, the phase and the next instant of the forecast,
// whether the pier side the driver reports still needs a flip, and the timeline of the preferred window), the strip of a
// flip that runs, is armed, or left the capture paused (MeridianFlipExecutorView.tsx), then the Monitor section (what
// the server's monitor observes and the transitions it reported) or the Executor section (the flip and its latest
// execution), and a guide to how a flip works and the tools it involves (MeridianFlipGuide.tsx). The contextual panel
// holds what is set rather than read: the flip window, the flip policy, the equipment, and the summaries of the camera
// tools a flip invokes. The mount is never chosen here: a missing or unavailable one is reported and Enable is disabled. The monitor is the server's, so changing profile, setup, or workspace, or closing the tab, leaves
// it enabled for the mount it was enabled for; settings are applied explicitly and remembered by the profile per mount.
// Nothing here commands the mount: the countdowns are only interpolated between the samples of the server, which takes
// every decision.

// Text of each mechanical assessment, and its tone.
const MECHANICAL: Readonly<Record<MeridianMechanicalAssessment, readonly [string, StatusTone]>> = {
	unsupportedMountType: ['No flip for this mount type', 'muted'],
	unknown: ['Pier side unknown', 'muted'],
	notDue: ['Flip not due yet', 'neutral'],
	alreadyOnExpectedSide: ['Already on the expected side', 'success'],
	flipCandidate: ['Flip may be needed', 'warning'],
	verificationPending: ['Waiting for the mount to settle', 'neutral'],
}

// Explanation of each reason.
const REASONS: Readonly<Record<MeridianMonitorReason, string>> = {
	disconnected: 'The mount is disconnected; the target is forgotten until it reconnects.',
	noCoordinates: 'The mount has not reported its position.',
	noSite: 'The mount has not reported its site.',
	moving: 'The mount is moving; the previous target is no longer assumed.',
	parked: 'The mount is parked.',
	notTracking: 'The mount is not tracking, so it observes no fixed target; the hour angle is geometry only.',
	settling: 'The mount must hold its position for the settle time before it is a target.',
	altazimuthMount: 'An altazimuth mount needs no meridian flip; only the timing is shown.',
	forkMount: 'A fork mount needs no German equatorial flip; only the timing is shown.',
	unknownMountType: 'The driver has not reported the mount type.',
	noPierSide: 'The driver reports no pier side, so a flip cannot be assessed.',
	nearPole: 'The target is at the pole, where the pier side is undefined.',
	nonSiderealTracking: 'The mount does not track at the sidereal rate; the forecast is approximate.',
}

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

// Fill of each part of the timeline: the stretches of the bar and the marks of the transit and of now. The approach is
// neutral, since nothing is due during it; only the window and its closing are tinted.
const TIMELINE = {
	outside: 'bg-base-200',
	approach: 'bg-line-200',
	window: 'bg-warning/60',
	closing: 'bg-danger/60',
	transit: 'w-px bg-ink-200',
	now: 'w-1 rounded-full bg-ink-100',
} as const

// Legend of the stretches and the transit mark of the timeline; now and the instants are labeled on the bar itself.
const TIMELINE_LEGEND: readonly { readonly mark: string; readonly label: string }[] = [
	{ mark: cn('h-2 w-4 rounded-sm', TIMELINE.approach), label: 'Approach' },
	{ mark: cn('h-2 w-4 rounded-sm', TIMELINE.window), label: 'Preferred window' },
	{ mark: cn('h-2 w-4 rounded-sm', TIMELINE.closing), label: 'Window closing' },
	{ mark: cn('h-3', TIMELINE.transit), label: 'Upper transit' },
]

// Time to an instant from now (Unix milliseconds), or since it: "in 07:41", "03:12 ago".
function formatFromNow(at: number, now: number) {
	return at >= now ? `in ${formatClockDuration((at - now) / 1000)}` : `${formatClockDuration((now - at) / 1000)} ago`
}

// Meridian Flip tool.
export function MeridianFlipMonitorView() {
	const mount = useRoleDevice('MOUNT')
	const profile = activeProfile(useSnapshot(profileState))
	const state = useSnapshot(meridianFlipState)
	const executor = useSnapshot(meridianFlipExecutorState)
	const device = mount.device
	const blocker = mount.status === 'connected' ? undefined : MOUNT_ROLE_BLOCKERS[mount.status]
	const key = device ? monitorKey(device.connectionId, device.id) : undefined
	const monitor = key ? state.monitors[key] : undefined
	const pending = key ? state.pending[key] : undefined
	const error = key ? state.errors[key] : undefined
	const arm = key ? executor.arms[key] : undefined
	const running = device ? latestExecution(executor, device.connectionId, device.id)?.state === 'running' : false
	const now = useNow(!!monitor)
	const identity = profileCamera(profile, device?.id)
	const saved = meridianFlipSettings(profile.settings, identity)
	const [draft, setDraft] = useState<MeridianFlipSettings>(() => monitor?.settings ?? saved)

	// Section shown: the one this tab showed last, and the Executor whenever a flip of the mount starts running or gets
	// armed, including once the mirror of the Executor loads after a reload.
	const live = running || arm !== undefined
	const [section, setSection] = useState<MeridianFlipSection>(() => (live ? 'Executor' : meridianFlipView.section))
	const [wasLive, setWasLive] = useState(live)

	if (live !== wasLive) {
		setWasLive(live)
		if (live) setSection('Executor')
	}
	const monitorId = monitor?.monitorId

	// The draft of the flip window starts over from the settings of another mount, profile, or enablement.
	const draftKey = `${profile.id}:${key}:${monitorId}`
	const [draftOf, setDraftOf] = useState(draftKey)

	if (draftOf !== draftKey) {
		setDraftOf(draftKey)
		setDraft(monitor?.settings ?? saved)
	}

	useEffect(() => {
		if (device && monitorId) void loadMeridianFlipTransitions(meridianFlipState, device.connectionId, device.id)
	}, [device?.connectionId, device?.id, monitorId])

	function show(next: MeridianFlipSection) {
		setSection(next)
		meridianFlipView.section = next
	}

	// Enables the monitor with the flip window being edited, which the profile then remembers for the mount.
	function enable() {
		if (!device) return
		const settings = normalizeMeridianFlipSettings(draft)
		setMeridianFlipSettings(profileState, identity, settings)
		void enableMeridianFlip(meridianFlipState, device.connectionId, device.id, settings)
	}

	// Remembers the flip window being edited and applies it to the running monitor.
	function apply() {
		const settings = normalizeMeridianFlipSettings(draft)
		setMeridianFlipSettings(profileState, identity, settings)
		if (device && monitor) void updateMeridianFlipSettings(meridianFlipState, device.connectionId, device.id, settings, monitor.settingsRevision)
	}

	function disable() {
		if (monitor) void disableMeridianFlip(meridianFlipState, monitor.connectionId, monitor.deviceId)
	}

	const actions = (
		<Actions>
			{!monitor ? (
				<Button disabled={!device || !!blocker || !!pending} title={blocker ?? (pending ? 'Waiting for the server to answer.' : undefined)} onClick={enable}>
					{pending === 'enable' ? 'Enabling…' : 'Enable'}
				</Button>
			) : arm ? (
				<ConfirmButton title="Disable the monitor?" message={`The scheduled flip of ${arm.mountName} ends with it, since the Executor follows the forecast of the monitor.`} confirmLabel="Disable" disabled={!!pending} onConfirm={disable}>
					Disable
				</ConfirmButton>
			) : (
				<Button variant="secondary" disabled={!!pending || running} title={running ? 'A flip of this mount is running; disable the monitor once it ends.' : undefined} onClick={disable}>
					{pending === 'disable' ? 'Disabling…' : 'Disable'}
				</Button>
			)}
		</Actions>
	)

	const panel = (
		<>
			<WindowSection draft={draft} onChange={(settings) => setDraft(normalizeMeridianFlipSettings(settings))} monitor={monitor} saved={saved} pending={!!pending} onApply={apply} />
			<ExecutorPanelSections mount={mount} />
		</>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Meridian Flip" actions={actions} panel={{ title: 'Flip Settings', content: panel }}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-5xl flex-col gap-5 p-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-5">
						<span className="text-ink-300">Mount</span>
						<span className="min-w-0 truncate text-ink-100">
							<DeviceLink device={device} fallback={mount.status === 'notSelected' ? 'None selected' : 'Unavailable'} />
						</span>
						{blocker && !monitor && <span className="text-ink-300">{blocker}</span>}
						{mount.status === 'notSelected' && <EquipmentSetupButton />}
					</div>
					{error && <Notice error>{error}</Notice>}
					<PassageReadout monitor={monitor} now={now} />
					<FlipStrip mount={mount} monitor={monitor} />
					<SegmentedControl options={['Monitor', 'Executor'] as const} value={section} onChange={show} className="max-w-xs" />
					{section === 'Executor' ? (
						<MeridianFlipExecutorSections mount={mount} monitor={monitor} />
					) : (
						<div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
							<ObservationSection mount={mount} monitor={monitor} now={now} />
							<EventsSection monitorKey={key} now={now} />
						</div>
					)}
					<MeridianFlipGuide />
				</div>
			</div>
		</WorkspaceLayout>
	)
}

// Where the tracked target stands at instant now (Unix milliseconds): the time to or since the transit in large figures
// (or the state of the monitor when it has no forecast), the phase and the next instant of the forecast, whether a flip
// may be needed, and the timeline; the one reading of the tool meant to be read from across the room.
function PassageReadout({ monitor, now }: { readonly monitor?: MeridianFlipMonitor; readonly now: number }) {
	const timeZone = useActiveTimeZone()

	if (!monitor) {
		return (
			<section className="flex flex-col gap-1">
				<p className="m-0 text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-300">Not monitoring</p>
				<p className="m-0 text-sm leading-5 text-ink-200">Enable the monitor to follow the target the mount tracks. It runs on the server, so it keeps going when this tab closes.</p>
			</section>
		)
	}

	const seconds = secondsToTransit(monitor, now)
	const stale = monitor.timing.secondsToTransit !== undefined && seconds === undefined
	const forecast = monitor.availability === 'monitoring' && seconds !== undefined
	const next = forecast ? nextMeridianEvent(monitor.timing, now) : undefined
	const [mechanical, mechanicalTone] = MECHANICAL[monitor.mechanical]
	const tone = monitor.mechanical === 'flipCandidate' && monitor.timing.phase === 'pastDeadline' ? 'danger' : mechanicalTone
	const headline = forecast ? formatTransitOffset(seconds) : stale ? 'Stale' : MERIDIAN_AVAILABILITY_LABELS[monitor.availability]
	const phase = stale ? `The last sample, at ${formatClockTime(monitor.sampledAt, timeZone, { seconds: true })}, is too old to count down from.` : meridianPhaseText(monitor, now)

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
				<div className="flex min-w-0 flex-col gap-1">
					<p className={cn('m-0 text-3xl leading-9 font-semibold tracking-[-0.01em] tabular-nums', forecast ? 'text-ink-100' : 'text-ink-200')}>{headline}</p>
					<p className="m-0 text-sm leading-5 text-ink-200 tabular-nums">
						{phase}
						{next && (
							<span className="text-ink-300">
								{' · '}
								{next.label} {formatFromNow(next.at, now)}, at {formatLocalTime(next.at, timeZone, now)}
							</span>
						)}
					</p>
				</div>
				<StatusBadge tone={tone} label={mechanical} title={monitor.reason ? REASONS[monitor.reason] : undefined} />
			</div>
			{forecast && <Timeline monitor={monitor} now={now} />}
			{monitor.reason && <Notice>{REASONS[monitor.reason]}</Notice>}
		</section>
	)
}

// Timeline from the early warning to the closing of the window, with the transit and now marked on it, at instant now
// (Unix milliseconds); now off the scale is said rather than pinned to an edge.
function Timeline({ monitor, now }: { readonly monitor: MeridianFlipMonitor; readonly now: number }) {
	const timeZone = useActiveTimeZone()
	const { warningAt, transitAt, windowOpensAt, deadlineWarningAt, windowClosesAt } = monitor.timing

	if (warningAt === undefined || transitAt === undefined || windowOpensAt === undefined || deadlineWarningAt === undefined || windowClosesAt === undefined) return null

	const span = Math.max(windowClosesAt - warningAt, 60000)
	const start = warningAt - span * 0.1
	const end = windowClosesAt + span * 0.1
	const fraction = (time: number) => (time - start) / (end - start)
	const position = (time: number) => `${(Math.min(Math.max(fraction(time), 0), 1) * 100).toFixed(2)}%`
	const width = (from: number, to: number) => `${((Math.max(to - from, 0) / (end - start)) * 100).toFixed(2)}%`
	const inside = fraction(now) >= 0 && fraction(now) <= 1

	return (
		<div className="flex flex-col gap-2">
			<div className="relative mx-3 h-10">
				{inside && (
					<span className="absolute top-0 -translate-x-1/2 text-xs leading-4 text-ink-100" style={{ left: position(now) }}>
						Now
					</span>
				)}
				<div className={cn('absolute inset-x-0 top-5 h-2 rounded-full', TIMELINE.outside)} />
				<div className={cn('absolute top-5 h-2 border-r border-base-000', TIMELINE.approach)} style={{ left: position(warningAt), width: width(warningAt, windowOpensAt) }} />
				<div className={cn('absolute top-5 h-2 border-r border-base-000', TIMELINE.window)} style={{ left: position(windowOpensAt), width: width(windowOpensAt, deadlineWarningAt) }} />
				<div className={cn('absolute top-5 h-2', TIMELINE.closing)} style={{ left: position(deadlineWarningAt), width: width(deadlineWarningAt, windowClosesAt) }} />
				<div className={cn('absolute top-4 h-4', TIMELINE.transit)} style={{ left: position(transitAt) }} />
				{inside && <div className={cn('absolute top-4 h-4 -translate-x-1/2', TIMELINE.now)} style={{ left: position(now) }} />}
			</div>
			<div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs leading-4 text-ink-300 tabular-nums">
				<span>Warning {formatLocalTime(warningAt, timeZone, now)}</span>
				<span>Transit {formatLocalTime(transitAt, timeZone, now)}</span>
				<span>Opens {formatLocalTime(windowOpensAt, timeZone, now)}</span>
				<span>Closes {formatLocalTime(windowClosesAt, timeZone, now)}</span>
			</div>
			{!inside && <Notice>{now < start ? 'Now is before the timeline, which starts shortly before the early warning.' : 'Now is past the end of the timeline: the window closed.'}</Notice>}
			<ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs leading-4 text-ink-300">
				{TIMELINE_LEGEND.map(({ mark, label }) => (
					<li key={label} className="flex items-center gap-1.5">
						<span className={cn('flex-none', mark)} />
						{label}
					</li>
				))}
			</ul>
		</div>
	)
}

// What the monitor observes at instant now (Unix milliseconds): its state, the hour angle, the instants of the passage,
// the tracking, the pier sides, and the site the forecast follows, warned about when it is not the active observing
// site's.
function ObservationSection({ mount, monitor, now }: { readonly mount: RoleDevice; readonly monitor?: MeridianFlipMonitor; readonly now: number }) {
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

interface WindowSectionProps {
	// Settings being edited, in seconds.
	readonly draft: MeridianFlipSettings
	// Replaces the settings being edited.
	readonly onChange: (settings: MeridianFlipSettings) => void
	// Running monitor, whose settings are in force.
	readonly monitor?: MeridianFlipMonitor
	// Settings the profile remembers for the mount.
	readonly saved: MeridianFlipSettings
	// Whether a request of the monitor is in flight.
	readonly pending: boolean
	// Remembers the draft and applies it to the running monitor.
	readonly onApply: () => void
}

// Flip window of the mount, a section of the contextual panel: the early warning, the window, and its closing warning in
// minutes after the upper transit, the settle time in seconds, and Apply (or Remember while the monitor is off, whose
// Enable also takes them).
function WindowSection({ draft, onChange, monitor, saved, pending, onApply }: WindowSectionProps) {
	const maximumMinutes = Math.floor(MERIDIAN_FLIP_MAXIMUM_SECONDS / 60)
	const running = monitor?.settings
	const changed = running ? !sameMeridianFlipSettings(draft, running) : !sameMeridianFlipSettings(draft, saved)
	const minutes = (field: keyof MeridianFlipSettings) => (value: number) => onChange({ ...draft, [field]: value * 60 })
	const inForce = running ?? saved

	return (
		<CollapsibleSection id="meridianFlip.window" title="Flip Window" summary={`${formatFixed(inForce.minimumSeconds / 60, 0)} to ${formatFixed(inForce.maximumSeconds / 60, 0)} min after transit`}>
			<NumberInput label="Early warning" value={draft.earlyWarningSeconds / 60} min={0} max={maximumMinutes} suffix="min" disabled={pending} onChange={minutes('earlyWarningSeconds')} />
			<NumberInput label="Window opens after transit" value={draft.minimumSeconds / 60} min={0} max={draft.maximumSeconds / 60} suffix="min" disabled={pending} onChange={minutes('minimumSeconds')} />
			<NumberInput label="Window closes after transit" value={draft.maximumSeconds / 60} min={0} max={maximumMinutes} suffix="min" disabled={pending} onChange={minutes('maximumSeconds')} />
			<NumberInput label="Closing warning" value={draft.deadlineWarningSeconds / 60} min={0} max={(draft.maximumSeconds - draft.minimumSeconds) / 60} suffix="min" disabled={pending} onChange={minutes('deadlineWarningSeconds')} />
			<NumberInput label="Settle time" value={draft.settleSeconds} min={0} max={MERIDIAN_FLIP_MAXIMUM_SETTLE_SECONDS} suffix="s" disabled={pending} onChange={(value) => onChange({ ...draft, settleSeconds: value })} />
			{running && changed && <Notice>The running monitor uses other settings until these are applied.</Notice>}
			<Notice>Preferences of when to flip, not a physical limit of the mount, which only the mount itself enforces.</Notice>
			<Actions>
				<Button variant="secondary" disabled={pending || !changed} title={changed ? undefined : 'Nothing changed.'} onClick={onApply}>
					{running ? 'Apply' : 'Remember'}
				</Button>
			</Actions>
		</CollapsibleSection>
	)
}
