import type { DarvMeasurement, DarvSessionSummary, DeviceSummary, MountState } from 'api'
import { darvExposureTime } from 'nebulosa/src/observation/alignment/darv'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { RoleDevice } from '../equipment/useEquipment'
import { formatPercent } from '../format'
import { operationsState } from '../operations'
import { activeProfile, darvSettings, exposureSettings, profileState, setDarvSettings } from '../profile/profile'
import { type CameraIdentity, DARV_MAXIMUM_LEG_DURATION, DARV_MINIMUM_LEG_DURATION, type DarvSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { LinkButton } from '../ui/LinkButton'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { ProgressBar } from '../ui/ProgressBar'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { useNow } from '../useNow'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import {
	abortDarv,
	DARV_AXES,
	DARV_AXIS_HINTS,
	DARV_AXIS_LABELS,
	DARV_DIAGNOSTIC_LABELS,
	DARV_DIRECTION_LABELS,
	DARV_DIRECTIONS,
	DARV_PHASES,
	DARV_STATE_LABELS,
	DARV_STATUS_LABELS,
	DARV_TREND_LABELS,
	darvAdvice,
	darvBlocker,
	type DarvDriftReading,
	darvDriftReading,
	darvMeasurementRequest,
	darvMeasuring,
	darvMountSupport,
	darvOpen,
	darvProgress,
	darvRuntime,
	darvSlewRate,
	darvTrendText,
	finishDarv,
	formatDarvDrift,
	repeatDarv,
	startDarv,
} from './darv'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of DARV, a camera operation of the Images camera tabs. The session leads: its state, the
// progress of the running measurement, the latest drift as the panel's one Readout with how it moved since the
// previous comparable measurement in words, what to do with the knob next (the drift has no sign, so the loop reads its
// trend: turn either way, keep going while it falls, turn back when it grows), the key of the trails drawn over the
// frame, the commands, and why a start is blocked with the way to fix it; then the details of the latest result and
// the history of the session; then the settings, collapsed with a summary (measurement, acquisition), and the
// equipment last. Frames take the camera settings of Camera Acquisition, but never its exposure time, which is derived
// from the leg duration. The camera is the panel's target and the mount the MOUNT of the active equipment setup; a
// missing or unsuitable mount says why. The form is the camera's, kept in the profile, and is locked showing the values
// applied while a measurement runs; the session is the server's, shown here whichever tab started it, and keeps
// running when the panel unmounts. The drift is in pixels per second: DARV never solves its frames, so it is never
// converted into a polar error, and it is compared only between measurements of equal settings.

// Classes of the session commands: a touch target of 44 px on a coarse pointer, since they are pressed at the mount.
const COMMAND_CLASS = 'pointer-coarse:min-h-[44px]'

// Camera a DARV panel measures with and the forms it edits.
export interface DarvTarget {
	// Camera, when present on the watched connection.
	readonly device?: DeviceSummary
	// Whether the camera can take frames now, and why not.
	readonly availability: RoleAvailability
	// Mount of the equipment setup and its state.
	readonly mount: RoleDevice
	// Camera whose forms are edited; absent when the profile has no saved connection, so the defaults are shown and
	// nothing is kept.
	readonly settings?: CameraIdentity
}

// DARV panel sections of a camera.
export function DarvSections({ device, availability, mount, settings: identity }: DarvTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(darvRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const profile = activeProfile(profiles)
	const settings = darvSettings(profile.settings, identity)
	const exposure = exposureSettings(profile.settings, identity)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const latest = session?.measurements.at(-1)
	const reading = session && darvDriftReading(session.measurements)
	const capabilities = watchedDeviceState(control, 'camera', device)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const measuring = darvMeasuring(session)
	const open = darvOpen(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const locked = measuring || pending
	// While measuring, the form shows the values the measurement applied.
	const shown: Readonly<Omit<DarvSettings, 'stopTracking'>> = measuring && latest ? latest.request : settings
	const slewRate = measuring && latest ? latest.request.slewRate : darvSlewRate(settings, mountState)
	const mountAvailability = roleAvailability('MOUNT', mount, operations, darvMountSupport(mountState))
	const blocker = measuring ? undefined : darvBlocker(availability, mountAvailability, mountState, slewRate)
	const slewRates = mountState?.slewRates ?? []
	const acquisition = measuring && latest ? latest.request.capture : exposure
	const rate = slewRate !== undefined ? slewRateLabel(slewRate, mountState) : undefined
	// Mount whose own page fixes the blocker (parked, no tracking), rather than the equipment setup.
	const blockingMount = blocker !== undefined && availability.status === 'ready' && mountAvailability.status === 'ready' ? mount.device : undefined
	// The mount of a session is fixed; another setup mount starts a new session.
	const sameMount = open && session !== undefined && mount.device !== undefined && session.mount.connectionId === mount.device.connectionId && session.mount.deviceId === mount.device.id
	const advice = open && !measuring ? darvAdvice(latest, reading) : undefined
	const notes = open && latest?.state === 'ready' ? (latest.result?.diagnostics.flatMap((reason) => DARV_DIAGNOSTIC_LABELS[reason] ?? []) ?? []) : []

	// Updates fields of the camera's DARV form.
	function update(patch: Partial<DarvSettings>) {
		setDarvSettings(profileState, identity, patch)
	}

	function measure() {
		if (!device || !mount.device || slewRate === undefined) return
		const body = darvMeasurementRequest(settings, exposure, slewRate, capabilities)
		if (session && sameMount) void repeatDarv(darvRuntime, session, body)
		else void startDarv(darvRuntime, device.connectionId, device.id, { connectionId: mount.device.connectionId, deviceId: mount.device.id }, body)
	}

	return (
		<>
			<CollapsibleSection id="images.darv.session" title={measuring ? 'Current Measurement' : open ? 'Session' : session ? 'Last Session' : 'Session'} summary={session && sessionSummaryText(session, reading)}>
				{session && <SessionState session={session} latest={latest} />}
				{measuring && latest && <MeasurementProgress measurement={latest} />}
				{reading && <DriftReadout reading={reading} ended={!open} />}
				{notes.length > 0 && <Notice warning>{notes.join(' ')}</Notice>}
				{advice && <Notice>{advice}</Notice>}
				{reading && reading.measurement.result!.trailCount > 0 && <Notice>{trailKey(DARV_AXIS_LABELS[reading.measurement.request.axis])}</Notice>}
				{!measuring && blocker === undefined && (
					<Notice>
						{!sameMount && `${DARV_AXIS_HINTS[shown.axis]} `}
						{sameMount ? 'Repeat' : 'Start'} moves {mount.device?.name ?? 'the mount'} {DARV_DIRECTION_LABELS[shown.direction].toLowerCase()} in RA for {shown.legDuration} s and back{rate ? ` at ${rate}` : ''}; make sure it is clear to move.
					</Notice>
				)}
				<div className="flex flex-wrap gap-2">
					{measuring ? (
						<Button variant="secondary" className={COMMAND_CLASS} title="Stop the mount and discard the frame" disabled={pending} onClick={() => void abortDarv(darvRuntime, session!)}>
							Abort
						</Button>
					) : (
						<>
							<Button className={COMMAND_CLASS} title={blocker} disabled={blocker !== undefined || pending} onClick={measure}>
								{sameMount ? 'Repeat Measurement' : 'Start Measurement'}
							</Button>
							{open && (
								<Button variant="secondary" className={COMMAND_CLASS} title="End the session; the mount stays where it is" disabled={pending} onClick={() => void finishDarv(darvRuntime, session!, settings.stopTracking)}>
									Finish Session
								</Button>
							)}
						</>
					)}
				</div>
				{open && session!.trackingStarted && <Checkbox label="Stop the tracking when finishing" checked={settings.stopTracking} disabled={pending} onChange={(stopTracking) => update({ stopTracking })} />}
				{blocker && <Notice>{blocker}</Notice>}
				{!measuring && (mountAvailability.status === 'notSelected' || mountAvailability.status === 'unsupported') && <EquipmentSetupButton />}
				{blockingMount && (
					<LinkButton className="self-start text-xs" onClick={() => navigate(routeState, { workspace: 'equipment', device: blockingMount.id })}>
						Open {blockingMount.name} in Equipment Control
					</LinkButton>
				)}
				{error && <Notice error>{error}</Notice>}
				{session && <TrackingState session={session} />}
			</CollapsibleSection>
			{reading && <Result measurement={reading.measurement} />}
			{session && session.measurements.length > 1 && <History measurements={session.measurements} mountState={mountState} />}
			<CollapsibleSection id="images.darv.measurement" title="Measurement" summary={`${DARV_AXIS_LABELS[shown.axis]} · ${DARV_DIRECTION_LABELS[shown.direction]} · ${rate ?? 'no rate'} · ${shown.legDuration} s`} defaultOpen={false}>
				<SegmentedControl label="Axis" options={DARV_AXES} value={shown.axis} format={(axis) => DARV_AXIS_LABELS[axis]} disabled={locked} onChange={(axis) => update({ axis })} />
				<SegmentedControl label="First Motion" options={DARV_DIRECTIONS} value={shown.direction} format={(direction) => DARV_DIRECTION_LABELS[direction]} disabled={locked} onChange={(direction) => update({ direction })} />
				{slewRates.length > 0 ? (
					<Select label="Slew Rate" options={slewRates.map((rate) => rate.name)} value={slewRate ?? slewRates[0].name} format={(name) => slewRateLabel(name, mountState)} disabled={locked} onChange={(name) => update({ slewRate: name })} />
				) : (
					<Notice>Slew Rate: {measuring ? shown.slewRate : mountState ? 'the mount reports no preset yet.' : 'chosen once the mount is connected.'}</Notice>
				)}
				<NumberInput label="Leg Duration" value={shown.legDuration} min={DARV_MINIMUM_LEG_DURATION} max={DARV_MAXIMUM_LEG_DURATION} step={5} suffix="s" disabled={locked} onChange={(legDuration) => update({ legDuration })} />
				<Notice>The mount moves in RA only, out and back; the slowest preset that draws a long enough trail works best.</Notice>
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.darv.acquisition"
				device={device}
				exposure={acquisition}
				capabilities={capabilities}
				defaultOpen={false}
				summary={`${darvExposureTime(shown.legDuration)} s · ${acquisition.binX}×${acquisition.binY}`}
				description="The frame is a LIGHT taken with the camera settings of Camera Acquisition; its exposure covers both legs and a few seconds of margin, and is shown as the latest frame of the camera, kept in memory only."
			>
				<DataRow label="Exposure">{`${darvExposureTime(shown.legDuration)} s`}</DataRow>
			</CameraAcquisitionSection>
			<CollapsibleSection id="images.darv.equipment" title="Equipment" summary={mount.device?.name ?? 'No mount'} defaultOpen={false}>
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</DataRow>
				</DataList>
				{!measuring && mountAvailability.status !== 'ready' && mountAvailability.message !== blocker && <Notice>{mountAvailability.message}</Notice>}
			</CollapsibleSection>
		</>
	)
}

// Returns the label a mount gives a slew-rate preset, or its name when the mount gives none or is not known.
function slewRateLabel(name: string, state: Pick<MountState, 'slewRates'> | undefined) {
	return state?.slewRates.find((rate) => rate.name === name)?.label.trim() || name
}

// Returns the one-line summary of a session: its state and its latest drift.
function sessionSummaryText(session: DarvSessionSummary, reading: DarvDriftReading | undefined) {
	const state = session.state === 'finished' ? 'Finished' : session.state === 'measuring' ? 'Measuring' : 'Idle'
	return reading ? `${state} · ${formatDarvDrift(reading.measurement.result!.driftMagnitude!)}` : state
}

// Returns the key of the trails drawn over the frame, and how they look once the axis is aligned.
function trailKey(axis: string) {
	return `On the frame: ember, the outbound trail; green, the return; dashed, a trail left out of the drift. Trails that open into a V mean an ${axis.toLowerCase()} error; one straight line means it is aligned.`
}

interface SessionStateProps {
	// Session shown.
	readonly session: DarvSessionSummary
	// Its latest measurement.
	readonly latest?: DarvMeasurement
}

// Headline of the session: Finished once the operator finished it, else the phase of the running or last measurement,
// its failure, and the slew rate restoration.
function SessionState({ session, latest }: SessionStateProps) {
	if (session.state === 'finished') return <SessionStateText failed={false}>Finished</SessionStateText>
	if (!latest) return null
	const failed = latest.state === 'failed'

	return (
		<>
			<SessionStateText failed={failed}>{`${DARV_STATE_LABELS[latest.state]} · #${latest.generation}`}</SessionStateText>
			{failed && latest.error && <Notice error>{latest.error}</Notice>}
			{latest.slewRateRestored === false && latest.previousSlewRate && <Notice>The slew rate could not be restored to {latest.previousSlewRate}.</Notice>}
		</>
	)
}

interface DriftReadoutProps {
	// Latest drift and how it moved.
	readonly reading: DarvDriftReading
	// Whether the session ended, so the drift is its last one.
	readonly ended: boolean
}

// The latest drift as the panel's Readout, read from the mount: the separation rate, and how it moved since the
// previous comparable measurement in words, or why it is not compared.
function DriftReadout({ reading, ended }: DriftReadoutProps) {
	const { measurement, previous, changed, trend } = reading
	const label = `${ended ? 'Last drift' : 'Drift'} of #${measurement.generation}`
	const comparison = previous && trend ? darvTrendText(trend, previous) : changed ? `not compared with #${changed.generation}, whose settings differ` : undefined

	return (
		<div className="flex flex-col gap-0.5">
			<p className="m-0 text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{formatDarvDrift(measurement.result!.driftMagnitude!)}</p>
			<p className="m-0 text-xs leading-4 text-ink-300 tabular-nums">{comparison ? `${label} · ${comparison}` : label}</p>
		</div>
	)
}

// Details of the latest measured measurement: its outcome, how many trails were paired, and the fit quality.
function Result({ measurement }: { readonly measurement: DarvMeasurement }) {
	const result = measurement.result!

	return (
		<CollapsibleSection id="images.darv.result" title={`Measurement #${measurement.generation}`} summary={`${DARV_STATUS_LABELS[result.status]} · ${result.usableCount} of ${result.trailCount} trails`} defaultOpen={false}>
			<DataList>
				<DataRow label="Result">{DARV_STATUS_LABELS[result.status]}</DataRow>
				<DataRow label="Trails">{`${result.usableCount} of ${result.trailCount} usable`}</DataRow>
				<DataRow label="Fit Quality" title="How well the trails fit straight legs; not how well the mount is aligned">
					{formatPercent(result.confidence)}
				</DataRow>
			</DataList>
			<Notice>The drift is how fast the return trail separates from the outbound one, across the RA motion, in pixels per second; it is not a polar error, and it compares only between measurements of equal settings.</Notice>
		</CollapsibleSection>
	)
}

interface HistoryProps {
	// Measurements of the session, oldest first.
	readonly measurements: readonly DarvMeasurement[]
	// State of the mount, for the labels of its slew-rate presets.
	readonly mountState?: Pick<MountState, 'slewRates'>
}

// Measurements of the session, latest first, with their settings and drift, and how each drift moved since the one
// before it.
function History({ measurements, mountState }: HistoryProps) {
	return (
		<CollapsibleSection id="images.darv.history" title="History" summary={`${measurements.length} measurements`} defaultOpen={false}>
			<DataList>
				{measurements.toReversed().map((measurement, index) => {
					const { request, result } = measurement
					const trend = result?.driftMagnitude !== undefined ? darvDriftReading(measurements.slice(0, measurements.length - index))?.trend : undefined
					const value = result?.driftMagnitude !== undefined ? formatDarvDrift(result.driftMagnitude) : result ? DARV_STATUS_LABELS[result.status] : DARV_STATE_LABELS[measurement.state]
					return (
						<DataRow key={measurement.generation} label={`#${measurement.generation} ${DARV_AXIS_LABELS[request.axis]}, ${DARV_DIRECTION_LABELS[request.direction]}, ${slewRateLabel(request.slewRate, mountState)}, ${request.legDuration} s`}>
							{trend ? `${value} · ${DARV_TREND_LABELS[trend]}` : value}
						</DataRow>
					)
				})}
			</DataList>
		</CollapsibleSection>
	)
}

// Tracking a measurement of the session started: on until the finish, then stopped, left on, or not stoppable.
function TrackingState({ session }: { readonly session: DarvSessionSummary }) {
	if (!session.trackingStarted) return null
	const message =
		session.state !== 'finished'
			? 'The tracking was started for the session and stays on until it is finished.'
			: session.trackingStopped === true
				? 'The tracking started for the session was stopped.'
				: session.trackingStopped === false
					? 'The tracking started for the session could not be stopped.'
					: 'The tracking started for the session was left on.'
	return <Notice>{message}</Notice>
}

// Interval between redraws of the progress while a measurement runs, in milliseconds.
const PROGRESS_TICK = 250

// Progress of the running measurement: its step among the phases, and a bar of the exposure elapsed with the time
// left while the shutter is open; while the measurement prepares or its frame is analyzed, whose length is unknown,
// the bar pulses instead.
function MeasurementProgress({ measurement }: { readonly measurement: DarvMeasurement }) {
	const now = useNow(true, PROGRESS_TICK)

	const { step, elapsed, fraction } = darvProgress(measurement, now)

	return (
		<div className="flex flex-col gap-1">
			<ProgressBar fraction={fraction} />
			<p className="m-0 flex justify-between text-xs leading-4 text-ink-300 tabular-nums">
				<span>{step !== undefined ? `Step ${step} of ${DARV_PHASES.length}` : ''}</span>
				{elapsed !== undefined && <span>{`${Math.floor(elapsed)} / ${measurement.exposure} s · ${Math.ceil(measurement.exposure - elapsed)} s left`}</span>}
			</p>
		</div>
	)
}
