import type { DarvMeasurement, DarvSessionSummary, DeviceSummary } from 'api'
import { cn } from 'cn'
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
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
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
	darvBlocker,
	darvComparable,
	darvMeasurementRequest,
	darvMeasuring,
	darvMountSupport,
	darvOpen,
	darvProgress,
	darvRuntime,
	darvSlewRate,
	finishDarv,
	formatDarvDrift,
	repeatDarv,
	startDarv,
} from './darv'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of DARV, a camera operation of the Images camera tabs: the equipment it uses, the
// measurement settings (adjusted axis, RA direction, slew-rate preset of the mount, leg duration; the exposure is
// derived from them and only shown), the phase and progress of the running measurement, the result of the latest one and the
// history of the session, and the Start, Repeat, Abort, and Finish commands. Frames take the camera settings of
// Camera Acquisition, but never its exposure time, which this panel does not change. The camera is the panel's target
// and the mount the MOUNT of the active equipment setup; a missing or unsuitable mount says why. The form is the
// camera's, kept in the profile, and is locked showing the values applied while a measurement runs; the session is the
// server's, shown here whichever tab started it, and keeps running when the panel unmounts. Its frames are shown by the
// latest frame of the camera with the trails drawn over them. The drift is in pixels per second: DARV never solves its
// frames, so it is never converted into a polar error, and it is compared only between measurements of equal settings.

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
	// The mount of a session is fixed; another setup mount starts a new session.
	const sameMount = open && session !== undefined && mount.device !== undefined && session.mount.connectionId === mount.device.connectionId && session.mount.deviceId === mount.device.id

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
			<CollapsibleSection id="images.darv.equipment" title="Equipment">
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</DataRow>
				</DataList>
				{!measuring && mountAvailability.status !== 'ready' && <Notice>{mountAvailability.message}</Notice>}
				{!measuring && (mountAvailability.status === 'notSelected' || mountAvailability.status === 'unsupported') && <EquipmentSetupButton />}
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.darv.acquisition"
				device={device}
				exposure={exposure}
				capabilities={capabilities}
				description="The frame is a LIGHT taken with the camera settings of Camera Acquisition; its exposure covers both legs and a few seconds of margin, and is shown as the latest frame of the camera, kept in memory only."
			>
				<DataRow label="Exposure">{`${darvExposureTime(shown.legDuration)} s`}</DataRow>
			</CameraAcquisitionSection>
			<CollapsibleSection id="images.darv.measurement" title="Measurement">
				<SegmentedControl label="Axis" options={DARV_AXES} value={shown.axis} format={(axis) => DARV_AXIS_LABELS[axis]} disabled={locked} onChange={(axis) => update({ axis })} />
				<SegmentedControl label="First Motion" options={DARV_DIRECTIONS} value={shown.direction} format={(direction) => DARV_DIRECTION_LABELS[direction]} disabled={locked} onChange={(direction) => update({ direction })} />
				{slewRates.length > 0 ? (
					<Select label="Slew Rate" options={slewRates.map((rate) => rate.name)} value={slewRate ?? slewRates[0].name} format={(name) => slewRates.find((rate) => rate.name === name)?.label.trim() || name} disabled={locked} onChange={(name) => update({ slewRate: name })} />
				) : (
					<Notice>Slew Rate: {measuring ? shown.slewRate : 'the mount reports no preset yet.'}</Notice>
				)}
				<NumberInput label="Leg Duration" value={shown.legDuration} min={DARV_MINIMUM_LEG_DURATION} max={DARV_MAXIMUM_LEG_DURATION} step={5} suffix="s" disabled={locked} onChange={(legDuration) => update({ legDuration })} />
				<Checkbox label="Stop the tracking when finishing" checked={settings.stopTracking} disabled={pending} onChange={(stopTracking) => update({ stopTracking })} />
				<Notice>
					{DARV_AXIS_HINTS[shown.axis]} The mount moves in RA only, {DARV_DIRECTION_LABELS[shown.direction].toLowerCase()} first and back; the slowest preset that draws a long enough trail works best.
				</Notice>
			</CollapsibleSection>
			{latest && <Result session={session!} measurement={latest} />}
			{session && session.measurements.length > 1 && <History measurements={session.measurements} />}
			<CollapsibleSection id="images.darv.controls" title="Controls">
				{latest && <MeasurementState measurement={latest} />}
				{measuring && latest && <MeasurementProgress measurement={latest} />}
				{measuring ? (
					<Button variant="secondary" disabled={pending} onClick={() => void abortDarv(darvRuntime, session!)}>
						Abort
					</Button>
				) : (
					<>
						<Button disabled={blocker !== undefined || pending} onClick={measure}>
							{sameMount ? 'Repeat Measurement' : 'Start Measurement'}
						</Button>
						{open && (
							<Button variant="secondary" disabled={pending} onClick={() => void finishDarv(darvRuntime, session!, settings.stopTracking)}>
								Finish Session
							</Button>
						)}
					</>
				)}
				{blocker && <Notice>{blocker}</Notice>}
				{session && <TrackingState session={session} />}
				{open && !measuring && latest?.state === 'ready' && <Notice>Adjust the {DARV_AXIS_LABELS[latest.request.axis].toLowerCase()} knob to bring the two trails together, then repeat the measurement.</Notice>}
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
		</>
	)
}

interface ResultProps {
	// Session of the measurement.
	readonly session: DarvSessionSummary
	// Latest measurement.
	readonly measurement: DarvMeasurement
}

// Outcome of the latest measurement: the drift between the trails, how many trails were paired, the fit quality, the
// change since the previous comparable measurement, and the diagnostics.
function Result({ session, measurement }: ResultProps) {
	const { result } = measurement
	const previous = darvComparable(session.measurements)
	const notes = result?.diagnostics.flatMap((reason) => DARV_DIAGNOSTIC_LABELS[reason] ?? []) ?? []

	return (
		<CollapsibleSection id="images.darv.measurement" title={`Measurement #${measurement.generation}`}>
			<DataList>
				<DataRow label="State">{DARV_STATE_LABELS[measurement.state]}</DataRow>
				{result && <DataRow label="Result">{DARV_STATUS_LABELS[result.status]}</DataRow>}
				{result?.driftMagnitude !== undefined && <DataRow label="Separation Drift">{formatDarvDrift(result.driftMagnitude)}</DataRow>}
				{result && <DataRow label="Trails">{`${result.usableCount} of ${result.trailCount} usable`}</DataRow>}
				{result && result.trailCount > 0 && <DataRow label="Fit Quality">{formatPercent(result.confidence)}</DataRow>}
				{previous?.result?.driftMagnitude !== undefined && result?.driftMagnitude !== undefined && (
					<DataRow label={`Since #${previous.generation}`}>
						<span className={cn(result.driftMagnitude < previous.result.driftMagnitude && 'text-success')}>{`${formatDarvDrift(previous.result.driftMagnitude)} → ${formatDarvDrift(result.driftMagnitude)}`}</span>
					</DataRow>
				)}
			</DataList>
			{result?.status === 'limited' && <Notice>The trails could not be measured fully; judge the separation on the frame.</Notice>}
			{notes.length > 0 && <Notice>{notes.join(' ')}</Notice>}
			<Notice>The drift is how fast the return trail separates from the outbound one, across the RA motion; it is not a polar error.</Notice>
		</CollapsibleSection>
	)
}

// Measurements of the session, latest first, with their settings and drift.
function History({ measurements }: { readonly measurements: readonly DarvMeasurement[] }) {
	return (
		<CollapsibleSection id="images.darv.history" title="History" summary={`${measurements.length} measurements`} defaultOpen={false}>
			<DataList>
				{measurements.toReversed().map((measurement) => (
					<DataRow key={measurement.generation} label={`#${measurement.generation} ${DARV_AXIS_LABELS[measurement.request.axis]}, ${measurement.request.legDuration} s`}>
						{measurement.result?.driftMagnitude !== undefined ? formatDarvDrift(measurement.result.driftMagnitude) : measurement.result ? DARV_STATUS_LABELS[measurement.result.status] : DARV_STATE_LABELS[measurement.state]}
					</DataRow>
				))}
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

// Phase of the running or last measurement, its failure, and the slew rate restoration.
function MeasurementState({ measurement }: { readonly measurement: DarvMeasurement }) {
	const failed = measurement.state === 'failed'

	return (
		<>
			<SessionStateText failed={failed}>{DARV_STATE_LABELS[measurement.state]}</SessionStateText>
			{failed && measurement.error && <Notice error>{measurement.error}</Notice>}
			{measurement.slewRateRestored === false && measurement.previousSlewRate && <Notice>The slew rate could not be restored to {measurement.previousSlewRate}.</Notice>}
		</>
	)
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
