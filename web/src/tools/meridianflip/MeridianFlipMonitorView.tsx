import type { DeviceSummary, MeridianExposureAssessment, MeridianFlipMonitor, MeridianFlipSettings, MeridianMechanicalAssessment, MeridianMonitorReason, MeridianMountView, MeridianTimingPhase, MeridianTransitionKind } from 'api'
import { cn } from 'cn'
import { type ReactNode, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import type { RoleStatus } from '../../equipment/equipment'
import { EquipmentSetupButton } from '../../equipment/EquipmentSetupButton'
import { useRoleDevice } from '../../equipment/useEquipment'
import { formatClockDuration, formatDuration, formatHourAngle, formatUtcDateTime, MISSING } from '../../format'
import { activeProfile, meridianFlipSettings, profileCamera, profileState, setMeridianFlipSettings } from '../../profile/profile'
import { MERIDIAN_FLIP_MAXIMUM_SECONDS } from '../../profile/schema'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { useNow } from '../../useNow'
import {
	assessMeridianExposure,
	disableMeridianFlip,
	enableMeridianFlip,
	loadMeridianFlipTransitions,
	MERIDIAN_AVAILABILITY_LABELS,
	MERIDIAN_FLIP_MAXIMUM_SETTLE_SECONDS,
	meridianFlipHeadline,
	meridianFlipState,
	monitorKey,
	normalizeMeridianFlipSettings,
	sameMeridianFlipSettings,
	secondsToTransit,
	updateMeridianFlipSettings,
} from './meridianflip'
import { MeridianFlipExecutorSections } from './MeridianFlipExecutorView'

// Meridian Flip tool, Monitor section (the Executor section is MeridianFlipExecutorView.tsx): shows the server's monitor of the MOUNT of the active profile's Equipment Setup, where
// its tracked target stands relative to the upper meridian and the preferred flip window, whether the pier side the
// driver reports still needs a flip, and the transitions it observed. The mount is never chosen here: a missing or
// unavailable one is reported and Enable is disabled. The monitor is the server's, so changing profile, setup, or
// workspace, or closing the tab, leaves it enabled for the mount it was enabled for; settings are applied explicitly
// and remembered by the profile per mount. Nothing here commands the mount: the countdown is only interpolated between
// the samples of the server, which takes every decision.

// Why the monitor cannot be enabled, for each state of the MOUNT role that is not connected.
const BLOCKERS: Readonly<Record<Exclude<RoleStatus, 'connected'>, string>> = {
	notSelected: 'No mount is assigned in Equipment Setup.',
	unavailable: 'The assigned mount is not available on the selected connection.',
	disconnected: 'The assigned mount is disconnected.',
	connecting: 'The assigned mount is connecting.',
	disconnecting: 'The assigned mount is disconnecting.',
	error: 'The assigned mount failed to connect.',
}

// Text of each timing phase.
const PHASES: Readonly<Record<MeridianTimingPhase, string>> = {
	unavailable: 'No forecast',
	before: 'Before the early warning',
	approaching: 'Approaching the meridian',
	windowOpen: 'Preferred window open',
	pastDeadline: 'Preferred window closed',
}

// Text of each mechanical assessment.
const MECHANICAL: Readonly<Record<MeridianMechanicalAssessment, string>> = {
	unsupportedMountType: 'Not applicable to this mount type',
	unknown: 'Unknown',
	notDue: 'Not due yet',
	alreadyOnExpectedSide: 'Already on the expected side',
	flipCandidate: 'Flip may be needed',
	verificationPending: 'Waiting for the mount to settle',
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

// Text of each pier side.
const PIER_SIDES: Readonly<Record<MeridianMountView['pierSide'], string>> = { EAST: 'East', WEST: 'West', NEITHER: 'Unknown' }

// Text of each exposure decision.
const DECISIONS: Readonly<Record<MeridianExposureAssessment['decision'], string>> = { allowed: 'Fits', defer: 'Defer', blocked: 'Does not fit', unknown: 'Unknown' }

// Fill of each part of the timeline: the stretches of the bar and the marks of the transit and of now.
const TIMELINE = {
	outside: 'bg-base-200',
	approach: 'bg-accent/40',
	window: 'bg-warning/60',
	closing: 'bg-danger/60',
	transit: 'w-px bg-ink-200',
	now: 'w-1 bg-ink-100',
} as const

// Legend of the timeline: the sample mark of each part and what it means.
const TIMELINE_LEGEND: readonly { readonly mark: string; readonly label: string }[] = [
	{ mark: cn('h-2 w-4 rounded-sm', TIMELINE.approach), label: 'Approach: early warning to window' },
	{ mark: cn('h-2 w-4 rounded-sm', TIMELINE.window), label: 'Preferred flip window' },
	{ mark: cn('h-2 w-4 rounded-sm', TIMELINE.closing), label: 'Window closing: deadline warning' },
	{ mark: cn('h-2 w-4 rounded-sm border border-line-100', TIMELINE.outside), label: 'Outside the warning and the window' },
	{ mark: cn('h-3', TIMELINE.transit), label: 'Upper transit' },
	{ mark: cn('h-3', TIMELINE.now), label: 'Now' },
]

// Countdown to or since the transit: "in 4:05", "4:05 ago", or MISSING.
function formatCountdown(seconds: number | undefined) {
	if (seconds === undefined) return MISSING
	return seconds >= 0 ? `in ${formatClockDuration(seconds)}` : `${formatClockDuration(-seconds)} ago`
}

// Meridian Flip Monitor tool.
export function MeridianFlipMonitorView() {
	const mount = useRoleDevice('MOUNT')
	const profile = activeProfile(useSnapshot(profileState))
	const state = useSnapshot(meridianFlipState)
	const device = mount.device
	const blocker = mount.status === 'connected' ? undefined : BLOCKERS[mount.status]
	const identity = profileCamera(profile, device?.id)
	const key = device ? monitorKey(device.connectionId, device.id) : undefined
	const monitor = key ? state.monitors[key] : undefined
	const pending = key ? state.pending[key] : undefined
	const error = key ? state.errors[key] : undefined
	const saved = meridianFlipSettings(profile.settings, identity)
	const [draft, setDraft] = useState<MeridianFlipSettings>(() => monitor?.settings ?? saved)
	const [label, tone] = meridianFlipHeadline(monitor)

	// Section shown: the passive monitor or the executor that flips; transient, a view choice of this tab.
	const [section, setSection] = useState<'Monitor' | 'Executor'>('Monitor')

	// The draft starts over from the settings of another mount, profile, or enablement.
	const draftKey = `${profile.id}:${key}:${monitor?.monitorId}`
	const [draftOf, setDraftOf] = useState(draftKey)

	if (draftOf !== draftKey) {
		setDraftOf(draftKey)
		setDraft(monitor?.settings ?? saved)
	}

	const monitorId = monitor?.monitorId

	useEffect(() => {
		if (device && monitorId) void loadMeridianFlipTransitions(meridianFlipState, device.connectionId, device.id)
	}, [device?.connectionId, device?.id, monitorId])

	function enable() {
		if (!device) return
		const settings = normalizeMeridianFlipSettings(draft)
		setMeridianFlipSettings(profileState, identity, settings)
		void enableMeridianFlip(meridianFlipState, device.connectionId, device.id, settings)
	}

	function apply() {
		const settings = normalizeMeridianFlipSettings(draft)
		setMeridianFlipSettings(profileState, identity, settings)
		if (device && monitor) void updateMeridianFlipSettings(meridianFlipState, device.connectionId, device.id, settings, monitor.settingsRevision)
	}

	const actions = (
		<Actions>
			{monitor ? (
				<Button variant="secondary" disabled={!!pending} onClick={() => void disableMeridianFlip(meridianFlipState, monitor.connectionId, monitor.deviceId)}>
					{pending === 'disable' ? 'Disabling…' : 'Disable'}
				</Button>
			) : (
				<Button disabled={!device || !!blocker || !!pending} title={blocker} onClick={enable}>
					{pending === 'enable' ? 'Enabling…' : 'Enable'}
				</Button>
			)}
		</Actions>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Meridian Flip" actions={section === 'Monitor' ? actions : undefined}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
					<SegmentedControl options={['Monitor', 'Executor'] as const} value={section} onChange={setSection} className="max-w-xs" />
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-5">
						<span className="text-ink-300">Mount</span>
						<span className="min-w-0 truncate text-ink-100">
							<DeviceLink device={device} fallback={mount.status === 'notSelected' ? 'None selected' : 'Unavailable'} />
						</span>
						<StatusBadge tone={tone} label={label} />
						{blocker && !monitor && <span className="text-ink-300">{blocker}</span>}
						{mount.status === 'notSelected' && <EquipmentSetupButton />}
					</div>
					{error && <Notice error>{error}</Notice>}
					{section === 'Executor' ? (
						<MeridianFlipExecutorSections mount={mount} monitor={monitor} />
					) : (
						<>
							<div className="grid gap-4 md:grid-cols-2">
								<ObservationPanel monitor={monitor} />
								<SettingsPanel draft={draft} onChange={(settings) => setDraft(normalizeMeridianFlipSettings(settings))} monitor={monitor} saved={saved} pending={!!pending} onApply={apply} />
							</div>
							{monitor && <TimelinePanel monitor={monitor} />}
							<div className="grid gap-4 md:grid-cols-2">
								<ExposurePanel device={device} monitor={monitor} />
								<EventsPanel monitorKey={key} />
							</div>
							<Notice>
								The monitor only observes: it never moves the mount, stops tracking, or interrupts an exposure. The window is a timing preference, not a physical limit of the mount. A pier side change is reported as observed, never as a verified flip; the Executor is what flips. It stays enabled when
								this tab closes and ends when the server stops.
							</Notice>
						</>
					)}
				</div>
			</div>
		</WorkspaceLayout>
	)
}

// Card of one section of the tool.
function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-sm font-semibold text-ink-100">{title}</h2>
			{children}
		</section>
	)
}

// What the monitor observes now: the hour angle, the transit, the window, the pier sides, and the assessment.
function ObservationPanel({ monitor }: { readonly monitor?: MeridianFlipMonitor }) {
	const now = useNow(!!monitor)

	if (!monitor) {
		return (
			<Panel title="Observation">
				<Notice>Enable the monitor to follow the target the mount tracks.</Notice>
			</Panel>
		)
	}

	const { timing, mount, reason } = monitor
	const countdown = secondsToTransit(monitor, now)
	const stale = timing.secondsToTransit !== undefined && countdown === undefined

	return (
		<Panel title="Observation">
			<DataList>
				<DataRow label="Status">{MERIDIAN_AVAILABILITY_LABELS[monitor.availability]}</DataRow>
				<DataRow label="Phase">{stale ? 'Stale' : PHASES[timing.phase]}</DataRow>
				<DataRow label={timing.phase === 'unavailable' ? 'Hour angle (geometry only)' : 'Hour angle'}>{timing.hourAngle === undefined ? MISSING : formatHourAngle(timing.hourAngle)}</DataRow>
				<DataRow label="Transit">{stale ? 'Stale' : formatCountdown(countdown)}</DataRow>
				<DataRow label="Transit at">{timing.transitAt === undefined ? MISSING : formatUtcDateTime(timing.transitAt)}</DataRow>
				<DataRow label="Window opens">{timing.windowOpensAt === undefined ? MISSING : formatUtcDateTime(timing.windowOpensAt)}</DataRow>
				<DataRow label="Window closes">{timing.windowClosesAt === undefined ? MISSING : formatUtcDateTime(timing.windowClosesAt)}</DataRow>
				<DataRow label="Forecast">{timing.quality === 'valid' ? 'Sidereal tracking' : timing.quality === 'approximate' ? 'Approximate' : MISSING}</DataRow>
				<DataRow label="Tracking">{mount.tracking ? mount.trackMode.toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'Off'}</DataRow>
				<DataRow label="Pier side (reported)">{PIER_SIDES[mount.pierSide]}</DataRow>
				<DataRow label="Pier side (geometric)">{mount.expectedPierSide ? PIER_SIDES[mount.expectedPierSide] : MISSING}</DataRow>
				<DataRow label="Flip" tone={monitor.mechanical === 'flipCandidate' ? 'danger' : 'default'}>
					{MECHANICAL[monitor.mechanical]}
				</DataRow>
				<DataRow label="Sampled">{formatUtcDateTime(monitor.sampledAt)}</DataRow>
			</DataList>
			{reason && <Notice>{REASONS[reason]}</Notice>}
		</Panel>
	)
}

interface SettingsPanelProps {
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

// Window settings in minutes, the settle time in seconds, and Apply.
function SettingsPanel({ draft, onChange, monitor, saved, pending, onApply }: SettingsPanelProps) {
	const maximumMinutes = Math.floor(MERIDIAN_FLIP_MAXIMUM_SECONDS / 60)
	const minutes = (field: keyof MeridianFlipSettings) => (value: number) => onChange({ ...draft, [field]: value * 60 })
	const running = monitor?.settings
	const changed = running ? !sameMeridianFlipSettings(draft, running) : !sameMeridianFlipSettings(draft, saved)

	return (
		<Panel title="Settings">
			<div className="grid gap-3 sm:grid-cols-2">
				<NumberInput label="Early warning" value={draft.earlyWarningSeconds / 60} min={0} max={maximumMinutes} suffix="min" disabled={pending} onChange={minutes('earlyWarningSeconds')} />
				<NumberInput label="Deadline warning" value={draft.deadlineWarningSeconds / 60} min={0} max={(draft.maximumSeconds - draft.minimumSeconds) / 60} suffix="min" disabled={pending} onChange={minutes('deadlineWarningSeconds')} />
				<NumberInput label="Window opens after" value={draft.minimumSeconds / 60} min={0} max={draft.maximumSeconds / 60} suffix="min" disabled={pending} onChange={minutes('minimumSeconds')} />
				<NumberInput label="Window closes after" value={draft.maximumSeconds / 60} min={0} max={maximumMinutes} suffix="min" disabled={pending} onChange={minutes('maximumSeconds')} />
				<NumberInput label="Settle time" value={draft.settleSeconds} min={0} max={MERIDIAN_FLIP_MAXIMUM_SETTLE_SECONDS} suffix="s" disabled={pending} onChange={(value) => onChange({ ...draft, settleSeconds: value })} />
			</div>
			{running && changed && <Notice>The running monitor uses other settings until these are applied.</Notice>}
			<Notice>Times are relative to the upper meridian transit. They are preferences of when to flip, not a physical limit of the mount, which only the mount itself enforces.</Notice>
			<Actions>
				<Button variant="secondary" disabled={pending || !changed} onClick={onApply}>
					{running ? 'Apply' : 'Remember'}
				</Button>
			</Actions>
		</Panel>
	)
}

// Timeline from the early warning to the closing of the window, with the transit and now marked.
function TimelinePanel({ monitor }: { readonly monitor: MeridianFlipMonitor }) {
	const now = useNow()
	const { warningAt, transitAt, windowOpensAt, deadlineWarningAt, windowClosesAt } = monitor.timing
	const stale = secondsToTransit(monitor, now) === undefined

	if (warningAt === undefined || transitAt === undefined || windowOpensAt === undefined || deadlineWarningAt === undefined || windowClosesAt === undefined || stale) {
		return (
			<Panel title="Timeline">
				<Notice>{stale && monitor.timing.transitAt !== undefined ? 'The last sample is stale.' : 'No forecast while the mount does not track a settled target.'}</Notice>
			</Panel>
		)
	}

	const span = Math.max(windowClosesAt - warningAt, 60000)
	const start = warningAt - span * 0.1
	const end = windowClosesAt + span * 0.1
	const position = (time: number) => `${(Math.min(Math.max((time - start) / (end - start), 0), 1) * 100).toFixed(2)}%`
	const width = (from: number, to: number) => `${((Math.max(to - from, 0) / (end - start)) * 100).toFixed(2)}%`

	return (
		<Panel title="Timeline">
			<div className="relative h-8">
				<div className={cn('absolute inset-x-0 top-3 h-2 rounded-full', TIMELINE.outside)} />
				<div className={cn('absolute top-3 h-2', TIMELINE.approach)} style={{ left: position(warningAt), width: width(warningAt, windowOpensAt) }} />
				<div className={cn('absolute top-3 h-2', TIMELINE.window)} style={{ left: position(windowOpensAt), width: width(windowOpensAt, deadlineWarningAt) }} />
				<div className={cn('absolute top-3 h-2', TIMELINE.closing)} style={{ left: position(deadlineWarningAt), width: width(deadlineWarningAt, windowClosesAt) }} />
				<div className={cn('absolute top-1 h-6', TIMELINE.transit)} style={{ left: position(transitAt) }} />
				<div className={cn('absolute top-0 h-8 -translate-x-6/12', TIMELINE.now)} style={{ left: position(now) }} />
			</div>
			<div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs leading-4 text-ink-300">
				<span>Warning {formatUtcDateTime(warningAt)}</span>
				<span>Transit {formatUtcDateTime(transitAt)}</span>
				<span>Window {formatUtcDateTime(windowOpensAt)}</span>
				<span>Closes {formatUtcDateTime(windowClosesAt)}</span>
			</div>
			<ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs leading-4 text-ink-300">
				{TIMELINE_LEGEND.map(({ mark, label }) => (
					<li key={label} className="flex items-center gap-1.5">
						<span className={cn('flex-none', mark)} />
						{label}
					</li>
				))}
			</ul>
		</Panel>
	)
}

// Whether a hypothetical next exposure ends within the preferred window, asked of the server on demand.
function ExposurePanel({ device, monitor }: { readonly device?: DeviceSummary; readonly monitor?: MeridianFlipMonitor }) {
	const [exposure, setExposure] = useState(300)
	const [overhead, setOverhead] = useState(10)
	const [result, setResult] = useState<{ readonly assessment: MeridianExposureAssessment } | { readonly error: string }>()
	const [busy, setBusy] = useState(false)

	async function assess() {
		if (!device) return
		setBusy(true)
		setResult(await assessMeridianExposure(device.connectionId, device.id, { exposureSeconds: exposure, overheadSeconds: overhead, expectedContextId: monitor?.contextId }))
		setBusy(false)
	}

	const assessment = result && 'assessment' in result ? result.assessment : undefined

	return (
		<Panel title="Exposure Forecast">
			<div className="grid gap-3 sm:grid-cols-2">
				<NumberInput label="Exposure" value={exposure} min={0} max={86400} suffix="s" onChange={setExposure} />
				<NumberInput label="Overhead" value={overhead} min={0} max={3600} suffix="s" onChange={setOverhead} />
			</div>
			<Actions>
				<Button variant="secondary" disabled={!monitor || busy} title={monitor ? undefined : 'Enable the monitor first.'} onClick={() => void assess()}>
					{busy ? 'Assessing…' : 'Assess'}
				</Button>
			</Actions>
			{result && 'error' in result && <Notice error>{result.error}</Notice>}
			{assessment && (
				<DataList>
					<DataRow label="Next exposure" tone={assessment.decision === 'allowed' ? 'success' : assessment.decision === 'blocked' ? 'danger' : 'default'}>
						{DECISIONS[assessment.decision]}
					</DataRow>
					{assessment.decision === 'allowed' && assessment.latestSafeStartAt !== undefined && <DataRow label="Latest start">{formatUtcDateTime(assessment.latestSafeStartAt)}</DataRow>}
					{assessment.decision === 'defer' && assessment.reevaluateAt !== undefined && <DataRow label="Ask again at">{formatUtcDateTime(assessment.reevaluateAt)}</DataRow>}
					<DataRow label="Duration">{formatDuration(exposure + overhead)}</DataRow>
				</DataList>
			)}
			{assessment && <Notice>{assessment.reason}.</Notice>}
			<Notice>A preview only: it starts and changes nothing, and it holds for the current target at the moment it was asked.</Notice>
		</Panel>
	)
}

// Recent transitions of the monitor, newest first.
function EventsPanel({ monitorKey: key }: { readonly monitorKey?: string }) {
	const state = useSnapshot(meridianFlipState)
	const transitions = key ? (state.transitions[key] ?? []) : []

	return (
		<Panel title="Recent Events">
			{transitions.length > 0 ? (
				<div className="max-h-80 overflow-y-auto">
					<Table columns={['Time', 'Event', 'Pier side']}>
						{transitions.toReversed().map((transition) => (
							<Row key={transition.transitionId}>
								<Cell numeric>{formatUtcDateTime(transition.at)}</Cell>
								<Cell>{TRANSITIONS[transition.kind]}</Cell>
								<Cell>{transition.previousPierSide ? `${PIER_SIDES[transition.previousPierSide]} → ${PIER_SIDES[transition.pierSide]}` : PIER_SIDES[transition.pierSide]}</Cell>
							</Row>
						))}
					</Table>
				</div>
			) : (
				<Notice>No events yet. They are kept by the server while the monitor is enabled.</Notice>
			)}
		</Panel>
	)
}
