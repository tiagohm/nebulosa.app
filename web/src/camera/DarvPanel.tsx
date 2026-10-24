import type { DarvMeasurement, DarvSessionSummary, DeviceSummary } from 'api'
import { cn } from 'cn'
import { darvExposureTime } from 'nebulosa/src/observation/alignment/polaralignment.darv'
import { type ReactNode, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { Notice } from '../equipment-control/parts'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { deviceState } from '../equipment/equipment'
import type { RoleDevice } from '../equipment/useEquipment'
import { operationsState } from '../operations'
import { activeProfile, darvSettings, exposureSettings, profileState, setDarvSettings } from '../profile/profile'
import { type CameraIdentity, DARV_MAXIMUM_LEG_DURATION, DARV_MINIMUM_LEG_DURATION, type DarvSettings } from '../profile/schema'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
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
	repeatDarv,
	startDarv,
} from './darv'

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
			<PanelSection title="Equipment">
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					<Row label="Camera">
						<DeviceLink device={device} fallback="—" />
					</Row>
					<Row label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</Row>
					<Row label="Exposure">{`${darvExposureTime(shown.legDuration)} s`}</Row>
				</dl>
				{!measuring && mountAvailability.status !== 'ready' && <p className="m-0 text-xs leading-4 text-ink-300">{mountAvailability.message}</p>}
				{!measuring && (mountAvailability.status === 'notSelected' || mountAvailability.status === 'unsupported') && (
					<Button variant="secondary" className="self-start" onClick={() => (deviceState.open = true)}>
						Equipment Setup
					</Button>
				)}
				<p className="m-0 text-xs leading-4 text-ink-300">The frame is a LIGHT taken with the camera settings of Camera Acquisition; its exposure covers both legs and a few seconds of margin, and is shown as the latest frame of the camera, kept in memory only.</p>
			</PanelSection>
			<PanelSection title="Measurement Settings">
				<SegmentedControl label="Axis" options={DARV_AXES} value={shown.axis} format={(axis) => DARV_AXIS_LABELS[axis]} disabled={locked} onChange={(axis) => update({ axis })} />
				<SegmentedControl label="First Motion" options={DARV_DIRECTIONS} value={shown.direction} format={(direction) => DARV_DIRECTION_LABELS[direction]} disabled={locked} onChange={(direction) => update({ direction })} />
				{slewRates.length > 0 ? (
					<Select label="Slew Rate" options={slewRates.map((rate) => rate.name)} value={slewRate ?? slewRates[0].name} format={(name) => slewRates.find((rate) => rate.name === name)?.label.trim() || name} disabled={locked} onChange={(name) => update({ slewRate: name })} />
				) : (
					<p className="m-0 text-xs leading-4 text-ink-300">Slew Rate: {measuring ? shown.slewRate : 'the mount reports no preset yet.'}</p>
				)}
				<NumberInput label="Leg Duration" value={shown.legDuration} min={DARV_MINIMUM_LEG_DURATION} max={DARV_MAXIMUM_LEG_DURATION} step={5} suffix="s" disabled={locked} onChange={(legDuration) => update({ legDuration })} />
				<Checkbox label="Stop the tracking when finishing" checked={settings.stopTracking} disabled={pending} onChange={(stopTracking) => update({ stopTracking })} />
				<Notice>
					{DARV_AXIS_HINTS[shown.axis]} The mount moves in RA only, {DARV_DIRECTION_LABELS[shown.direction].toLowerCase()} first and back; the slowest preset that draws a long enough trail works best.
				</Notice>
			</PanelSection>
			{latest && <Result session={session!} measurement={latest} />}
			{session && session.measurements.length > 1 && <History measurements={session.measurements} />}
			<PanelSection title="Controls">
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
				{blocker && <p className="m-0 text-xs leading-4 text-ink-300">{blocker}</p>}
				{session && <TrackingState session={session} />}
				{open && !measuring && latest?.state === 'ready' && <p className="m-0 text-xs leading-4 text-ink-300">Adjust the {DARV_AXIS_LABELS[latest.request.axis].toLowerCase()} knob to bring the two trails together, then repeat the measurement.</p>}
				{error && <p className="m-0 text-xs leading-4 text-danger">{error}</p>}
			</PanelSection>
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
		<PanelSection title={`Measurement #${measurement.generation}`}>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<Row label="State">{DARV_STATE_LABELS[measurement.state]}</Row>
				{result && <Row label="Result">{DARV_STATUS_LABELS[result.status]}</Row>}
				{result?.driftMagnitude !== undefined && <Row label="Separation Drift">{formatDrift(result.driftMagnitude)}</Row>}
				{result && <Row label="Trails">{`${result.usableCount} of ${result.trailCount} usable`}</Row>}
				{result && result.trailCount > 0 && <Row label="Fit Quality">{`${Math.round(result.confidence * 100)}%`}</Row>}
				{previous?.result?.driftMagnitude !== undefined && result?.driftMagnitude !== undefined && (
					<Row label={`Since #${previous.generation}`}>
						<span className={cn(result.driftMagnitude < previous.result.driftMagnitude && 'text-success')}>{`${formatDrift(previous.result.driftMagnitude)} → ${formatDrift(result.driftMagnitude)}`}</span>
					</Row>
				)}
			</dl>
			{result?.status === 'limited' && <p className="m-0 text-xs leading-4 text-ink-300">The trails could not be measured fully; judge the separation on the frame.</p>}
			{notes.length > 0 && <p className="m-0 text-xs leading-4 text-ink-300">{notes.join(' ')}</p>}
			<p className="m-0 text-xs leading-4 text-ink-300">The drift is how fast the return trail separates from the outbound one, across the RA motion; it is not a polar error.</p>
		</PanelSection>
	)
}

// Measurements of the session, latest first, with their settings and drift.
function History({ measurements }: { readonly measurements: readonly DarvMeasurement[] }) {
	return (
		<PanelSection title="History">
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				{measurements.toReversed().map((measurement) => (
					<Row key={measurement.generation} label={`#${measurement.generation} ${DARV_AXIS_LABELS[measurement.request.axis]}, ${measurement.request.legDuration} s`}>
						{measurement.result?.driftMagnitude !== undefined ? formatDrift(measurement.result.driftMagnitude) : measurement.result ? DARV_STATUS_LABELS[measurement.result.status] : DARV_STATE_LABELS[measurement.state]}
					</Row>
				))}
			</dl>
		</PanelSection>
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
	return <p className="m-0 text-xs leading-4 text-ink-300">{message}</p>
}

// Phase of the running or last measurement, its failure, and the slew rate restoration.
function MeasurementState({ measurement }: { readonly measurement: DarvMeasurement }) {
	const failed = measurement.state === 'failed'

	return (
		<>
			<p className={cn('m-0', failed ? 'text-danger' : 'text-ink-100')}>{DARV_STATE_LABELS[measurement.state]}</p>
			{failed && measurement.error && <p className="m-0 text-xs leading-4 text-danger">{measurement.error}</p>}
			{measurement.slewRateRestored === false && measurement.previousSlewRate && <p className="m-0 text-xs leading-4 text-ink-300">The slew rate could not be restored to {measurement.previousSlewRate}.</p>}
		</>
	)
}

// Interval between redraws of the progress while a measurement runs, in milliseconds.
const PROGRESS_TICK = 250

// Progress of the running measurement: its step among the phases, and a bar of the exposure elapsed with the time
// left while the shutter is open; while the measurement prepares or its frame is analyzed, whose length is unknown,
// the bar pulses instead.
function MeasurementProgress({ measurement }: { readonly measurement: DarvMeasurement }) {
	const [now, setNow] = useState(Date.now)

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), PROGRESS_TICK)
		return () => clearInterval(timer)
	}, [])

	const { step, elapsed, fraction } = darvProgress(measurement, now)

	return (
		<div className="flex flex-col gap-1">
			<div className="h-1 overflow-hidden rounded-full bg-base-300">{fraction === undefined ? <div className="h-full w-1/3 animate-pulse bg-accent/60" /> : <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${fraction * 100}%` }} />}</div>
			<p className="m-0 flex justify-between text-xs leading-4 text-ink-300 tabular-nums">
				<span>{step !== undefined ? `Step ${step} of ${DARV_PHASES.length}` : ''}</span>
				{elapsed !== undefined && <span>{`${Math.floor(elapsed)} / ${measurement.exposure} s · ${Math.ceil(measurement.exposure - elapsed)} s left`}</span>}
			</p>
		</div>
	)
}

// Label and value of a row.
function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="contents">
			<dt className="text-ink-300">{label}</dt>
			<dd className="m-0 min-w-0 truncate text-right tabular-nums">{children}</dd>
		</div>
	)
}

// Formats a drift in pixels per second.
function formatDrift(drift: number) {
	return `${drift < 0.01 ? drift.toExponential(1) : drift.toFixed(3)} px/s`
}
