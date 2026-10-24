import type { AutoFocusSessionSummary, CaptureSnoop, DeviceSummary } from 'api'
import { cn } from 'cn'
import { type ReactNode, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, deviceStateOf, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { Notice } from '../equipment-control/parts'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { deviceState } from '../equipment/equipment'
import { type RoleDevice, useRoleDevice } from '../equipment/useEquipment'
import { operationsState } from '../operations'
import { activeProfile, autoFocusSettings, exposureSettings, profileState, setAutoFocusSettings, starDetectionSettings } from '../profile/profile'
import type { AutoFocusSettings, CameraIdentity } from '../profile/schema'
import { PanelSection } from '../shell/ContextualPanel'
import { useAstapConfigured } from '../stars/StarRequestControls'
import { PROVIDER_LABELS } from '../stars/stars'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { AUTO_FOCUS_STATE_LABELS, autoFocusBlocker, autoFocusRequest, autoFocusRunning, autoFocusRuntime, defaultStepSize, FITTING_MODE_LABELS, FITTING_MODES, startAutoFocus, stopAutoFocus, VERIFICATION_LABELS } from './autofocus'
import { cameraKey } from './capture'
import { FrameProgress } from './FrameProgress'

// Contextual panel sections of Auto Focus, a camera operation of the Images camera tabs: the equipment it uses, each
// device linked to Equipment Control, the routine the server's
// runner follows (fitting, step size, positions per side, and the advanced settings collapsed), and the state of the
// running or last session with its Run and Stop commands. Frames are taken with the camera's exposure and camera
// settings, edited only in Camera Acquisition, and measured with the profile's star detection request, edited in
// Images → Star Detection. The camera is the panel's target and the focuser the one
// associated with it; a camera without a focuser says how to associate one. The filter wheel, when assigned, is
// shown and never moved. The forms are the camera's, kept in the profile; the session is the server's, shown here
// from the server state whichever tab started it, and keeps running when the panel unmounts. Its frames are shown by
// the latest frame of the camera, never by a viewer of its own.

// Camera an Auto Focus panel focuses and the forms it edits.
export interface AutoFocusTarget {
	// Camera, when present on the watched connection.
	readonly device?: DeviceSummary
	// Whether the camera can take frames now, and why not.
	readonly availability: RoleAvailability
	// Focuser associated with the camera and its state; absent when the camera has none.
	readonly focuser?: RoleDevice
	// Camera whose forms are edited; absent when the profile has no saved connection, so the defaults are shown and
	// nothing is kept.
	readonly settings?: CameraIdentity
	// Devices snooped into the frame headers; the focuser of the session always is.
	readonly snoop: CaptureSnoop
}

// Auto Focus panel sections of a camera.
export function AutoFocusSections({ device, availability, focuser, settings: identity, snoop }: AutoFocusTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(autoFocusRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const wheel = useRoleDevice('FILTER_WHEEL')
	const astapConfigured = useAstapConfigured()
	const profile = activeProfile(profiles)
	const settings = autoFocusSettings(profile.settings, identity)
	const detection = starDetectionSettings(profile.settings)
	const exposure = exposureSettings(profile.settings, identity)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	const focuserDevice = focuser?.device
	const focuserState = focuserDevice && deviceStateOf(control.states, 'focuser', focuserDevice.id)
	const wheelState = wheel.device && deviceStateOf(control.states, 'wheel', wheel.device.id)
	const running = autoFocusRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const locked = running || pending
	const stepSize = settings.stepSize ?? (focuserState ? defaultStepSize(focuserState.position.min, focuserState.position.max) : 100)
	const blocker = running ? undefined : autoFocusBlocker(availability, focuser && roleAvailability('FOCUSER', focuser, operations), focuserState, detection.detector.provider === 'astap' && !astapConfigured)

	// Updates fields of the camera's Auto Focus form.
	function update(patch: Partial<AutoFocusSettings>) {
		setAutoFocusSettings(profileState, identity, patch)
	}

	function start() {
		if (!device || !focuserDevice) return
		const request = autoFocusRequest(settings, detection, exposure, { connectionId: focuserDevice.connectionId, deviceId: focuserDevice.id }, stepSize, snoop, capabilities)
		void startAutoFocus(autoFocusRuntime, device.connectionId, device.id, request)
	}

	const filter = wheelState && (wheelState.names[wheelState.position] || `Slot ${wheelState.position + 1}`)

	return (
		<>
			<PanelSection title="Equipment">
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					<Row label="Camera">
						<DeviceLink device={device} fallback="—" />
					</Row>
					<Row label="Focuser">
						<DeviceLink device={focuserDevice} fallback="Not assigned" />
					</Row>
					{wheel.device && (
						<Row label="Filter Wheel">
							<DeviceLink device={wheel.device} fallback="—" />
						</Row>
					)}
				</dl>
				{!focuser && !running && (
					<Button variant="secondary" className="self-start" onClick={() => (deviceState.open = true)}>
						Equipment Setup
					</Button>
				)}
			</PanelSection>
			<PanelSection title="Focus Routine">
				{wheel.device && <p className="m-0 text-xs leading-4 text-ink-300">Filter: {filter ?? 'unknown'} — the Auto Focus measures through the current filter and never changes it.</p>}
				<p className="m-0 text-xs leading-4 text-ink-300">Frames are LIGHT, taken with the exposure and camera settings of Camera Acquisition ({exposure.exposureTime} s).</p>
				<p className="m-0 text-xs leading-4 text-ink-300">Each frame is measured by the median HFD of its accepted stars (Multi-Star) with the Star Detection settings ({PROVIDER_LABELS[detection.detector.provider]} detector) and shown as the latest frame of the camera; frames are kept in memory only.</p>
				<Select label="Curve Fitting" options={FITTING_MODES} value={settings.fittingMode} format={(mode) => FITTING_MODE_LABELS[mode]} disabled={locked} onChange={(fittingMode) => update({ fittingMode })} />
				<NumberInput label="Step Size" value={stepSize} min={1} max={focuserState ? Math.max(1, focuserState.position.max - focuserState.position.min) : undefined} suffix="steps" disabled={locked} onChange={(value) => update({ stepSize: value })} />
				<NumberInput label="Positions per Side" value={settings.initialOffsetSteps} min={1} max={50} disabled={locked} onChange={(initialOffsetSteps) => update({ initialOffsetSteps })} />
				<p className="m-0 text-xs leading-4 text-ink-300">
					The sweep starts {settings.initialOffsetSteps * stepSize} steps {settings.reversed ? 'inward' : 'outward'} and extends until both sides of the minimum have {settings.initialOffsetSteps} positions.
				</p>
				<Checkbox label="Return to the start position when stopped" checked={settings.restoreOnStop} disabled={locked} onChange={(restoreOnStop) => update({ restoreOnStop })} />
				<details>
					<summary className="cursor-pointer text-ink-200 select-none">Advanced settings</summary>
					<div className="mt-2 flex flex-col gap-2">
						<Checkbox label="Start the sweep inward" checked={settings.reversed} disabled={locked} onChange={(reversed) => update({ reversed })} />
						<NumberInput label="Settle Time" value={settings.settleDelay} min={0} max={600} step={0.1} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
						<NumberInput label="Measurement Timeout" value={settings.measureTimeout} min={1} max={3600} suffix="s" disabled={locked} onChange={(measureTimeout) => update({ measureTimeout })} />
						<NumberInput label="Max RMSD / HFD" value={settings.rmsdThreshold} min={0} max={10} step={0.01} disabled={locked} onChange={(rmsdThreshold) => update({ rmsdThreshold })} />
						<Notice>A fitted curve whose error relative to its best HFD exceeds this is rejected; 0 accepts any fit. Backlash is compensated as saved for the focuser in Equipment Control.</Notice>
					</div>
				</details>
			</PanelSection>
			<PanelSection title="Current Session">
				{session && <SessionState session={session} position={focuserState?.position.value} moving={focuserState?.moving} />}
				{running ? (
					<Button variant="secondary" disabled={pending || session!.state === 'stopping'} onClick={() => void stopAutoFocus(autoFocusRuntime, session!)}>
						{session!.state === 'stopping' ? 'Stopping…' : 'Stop'}
					</Button>
				) : (
					<Button disabled={blocker !== undefined || pending} onClick={start}>
						Run Auto Focus
					</Button>
				)}
				{blocker && <p className="m-0 text-xs leading-4 text-ink-300">{blocker}</p>}
				{running && <p className="m-0 text-xs leading-4 text-ink-300">{session!.request.restoreOnStop ? 'A stop moves the focuser back to the start position; a second stop leaves it where it stands.' : 'A stop leaves the focuser where it stands.'}</p>}
				{error && <p className="m-0 text-xs leading-4 text-danger">{error}</p>}
			</PanelSection>
		</>
	)
}

interface SessionStateProps {
	// Session shown.
	readonly session: AutoFocusSessionSummary
	// Logical position the focuser reports now, in steps.
	readonly position?: number
	// Whether the focuser reports a motion.
	readonly moving?: boolean
}

// State of the running or last session: its step, the focuser, the latest measurement, and once placed, the
// best focus the curve estimated apart from the position reached and the HFD verified there.
function SessionState({ session, position, moving }: SessionStateProps) {
	const running = autoFocusRunning(session)
	const [now, setNow] = useState(Date.now)

	// Only the elapsed time is refreshed here; the session itself runs on the server.
	useEffect(() => {
		if (!running) return
		const timer = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [running])

	const last = session.lastMeasurement
	const failed = session.state === 'failed'

	return (
		<>
			<p className={cn('m-0', failed ? 'text-danger' : 'text-ink-100')}>
				{AUTO_FOCUS_STATE_LABELS[session.state]}
				{session.target !== undefined && running && ` — ${session.target}`}
			</p>
			{(session.state === 'exposing' || (session.state === 'verifying' && session.exposure)) && <FrameProgress exposure={session.exposure} />}
			{failed && session.error && <p className="m-0 text-xs leading-4 text-danger">{session.error}</p>}
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<Row label="Focuser">{position === undefined ? '—' : `${position}${moving ? ' (moving)' : ''}`}</Row>
				{session.initialPosition !== undefined && <Row label="Start Position">{session.initialPosition}</Row>}
				<Row label="Samples">{session.measurementCount}</Row>
				{last && <Row label="Last HFD">{last.hfd === undefined ? `— at ${last.requestedPosition}` : `${last.hfd.toFixed(2)} px at ${last.requestedPosition}`}</Row>}
				{last && <Row label="Stars">{`${last.acceptedCount} / ${last.detectedCount}`}</Row>}
				<Row label="Estimated Best">{session.estimatedPosition ?? '—'}</Row>
				{session.estimatedHfd !== undefined && <Row label="Fitted HFD">{`${session.estimatedHfd.toFixed(2)} px`}</Row>}
				<Row label="Final Position">{session.finalPosition ?? '—'}</Row>
				<Row label="Verification">{session.verification === 'measured' && session.verifiedHfd !== undefined ? `${session.verifiedHfd.toFixed(2)} px measured` : session.verification === 'pending' ? 'Pending' : VERIFICATION_LABELS[session.verification]}</Row>
				<Row label="Elapsed">{formatElapsed(((session.endedAt ?? now) - session.startedAt) / 1000)}</Row>
			</dl>
			{last && last.warnings.length > 0 && <p className="m-0 text-xs leading-4 text-ink-300">{last.warnings.join(' ')}</p>}
			{session.verificationError && <p className="m-0 text-xs leading-4 text-ink-300">{session.verificationError}</p>}
			{session.state === 'cancelled' && (
				<p className="m-0 text-xs leading-4 text-ink-300">{session.restored ? 'The focuser was moved back to the start position.' : session.restored === false ? 'The focuser could not be moved back to the start position and was left where it stood.' : 'The focuser was left where the stop found it.'}</p>
			)}
		</>
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

// Formats an elapsed time in seconds as m:ss, or h:mm:ss from one hour.
function formatElapsed(seconds: number) {
	const total = Math.max(0, Math.floor(seconds))
	const s = String(total % 60).padStart(2, '0')
	const m = Math.floor(total / 60) % 60
	const h = Math.floor(total / 3600)
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
