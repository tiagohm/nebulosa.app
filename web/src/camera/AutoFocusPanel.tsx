import type { AutoFocusSessionSummary, CaptureSnoop, DeviceSummary } from 'api'
import { useSnapshot } from 'valtio'
import { controlRuntime, deviceStateOf, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import { type RoleDevice, useRoleDevice } from '../equipment/useEquipment'
import { formatClockDuration, MISSING } from '../format'
import { operationsState } from '../operations'
import { activeProfile, autoFocusSettings, exposureSettings, profileState, setAutoFocusSettings, starDetectionSettings } from '../profile/profile'
import type { AutoFocusSettings, CameraIdentity } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { CameraStarDetectionSection } from '../stars/CameraStarDetectionSection'
import { useAstapConfigured } from '../stars/StarRequestControls'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { useNow } from '../useNow'
import { AUTO_FOCUS_STATE_LABELS, autoFocusBlocker, autoFocusRequest, autoFocusRunning, autoFocusRuntime, defaultStepSize, FITTING_MODE_LABELS, FITTING_MODES, startAutoFocus, stopAutoFocus, VERIFICATION_LABELS } from './autofocus'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of Auto Focus, a camera operation of the Images camera tabs: the equipment it uses, each
// device linked to Equipment Control, the routine the server's
// runner follows (exposure time, fitting, step size, positions per side, and the advanced settings collapsed), and the
// state of the running or last session with its Run and Stop commands. Frames are taken with the exposure time of this
// form and the camera's camera settings, edited only in Camera Acquisition and shown under the exposure time, and measured with the profile's star
// detection request, edited in Images → Star Detection. The camera is the panel's target and the focuser the one
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
			<CollapsibleSection id="images.auto-focus.equipment" title="Equipment">
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Focuser">
						<DeviceLink device={focuserDevice} fallback="Not assigned" />
					</DataRow>
					{wheel.device && (
						<DataRow label="Filter Wheel">
							<DeviceLink device={wheel.device} />
						</DataRow>
					)}
				</DataList>
				{!focuser && !running && <EquipmentSetupButton />}
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.auto-focus.acquisition"
				device={device}
				exposure={running && session ? session.request.capture : exposure}
				capabilities={capabilities}
				description={
					<>
						Frames are LIGHT, taken with the exposure time above and the camera settings of Camera Acquisition.
						{wheel.device && ` Filter: ${filter ?? 'unknown'} — the Auto Focus measures through the current filter and never changes it.`}
					</>
				}
			>
				<ExposureTimeInput value={settings.exposureTime} exposure={capabilities?.exposure} disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
			</CameraAcquisitionSection>
			<CameraStarDetectionSection
				id="images.auto-focus.star-detection"
				device={device}
				provider={running && session ? session.request.detection.detector.provider : detection.detector.provider}
				description={(detector) => <>Each frame is measured by the median HFD of its accepted stars (Multi-Star) with the Star Detection settings ({detector} detector) and shown as the latest frame of the camera; frames are kept in memory only.</>}
			/>
			<CollapsibleSection id="images.auto-focus.algorithm" summary={FITTING_MODE_LABELS[settings.fittingMode]} title="Algorithm">
				<Select label="Curve Fitting" options={FITTING_MODES} value={settings.fittingMode} format={(mode) => FITTING_MODE_LABELS[mode]} disabled={locked} onChange={(fittingMode) => update({ fittingMode })} />
				<NumberInput label="Step Size" value={stepSize} min={1} max={focuserState ? Math.max(1, focuserState.position.max - focuserState.position.min) : undefined} suffix="steps" disabled={locked} onChange={(value) => update({ stepSize: value })} />
				<NumberInput label="Positions per Side" value={settings.initialOffsetSteps} min={1} max={50} disabled={locked} onChange={(initialOffsetSteps) => update({ initialOffsetSteps })} />
				<Notice>
					The sweep starts {settings.initialOffsetSteps * stepSize} steps {settings.reversed ? 'inward' : 'outward'} and extends until both sides of the minimum have {settings.initialOffsetSteps} positions.
				</Notice>
				<Checkbox label="Return to the start position when stopped" checked={settings.restoreOnStop} disabled={locked} onChange={(restoreOnStop) => update({ restoreOnStop })} />
			</CollapsibleSection>
			<CollapsibleSection id="images.auto-focus.advanced-settings" title="Advanced Settings" defaultOpen={false}>
				<Checkbox label="Start the sweep inward" checked={settings.reversed} disabled={locked} onChange={(reversed) => update({ reversed })} />
				<NumberInput label="Settle Time" value={settings.settleDelay} min={0} max={600} step={0.1} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
				<NumberInput label="Measurement Timeout" value={settings.measureTimeout} min={1} max={3600} suffix="s" disabled={locked} onChange={(measureTimeout) => update({ measureTimeout })} />
				<NumberInput label="Max RMSD / HFD" value={settings.rmsdThreshold} min={0} max={10} step={0.01} disabled={locked} onChange={(rmsdThreshold) => update({ rmsdThreshold })} />
				<Notice>A fitted curve whose error relative to its best HFD exceeds this is rejected; 0 accepts any fit. Backlash is compensated as saved for the focuser in Equipment Control.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.auto-focus.current-session" title="Current Session">
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
				{blocker && <Notice>{blocker}</Notice>}
				{running && <Notice>{session!.request.restoreOnStop ? 'A stop moves the focuser back to the start position; a second stop leaves it where it stands.' : 'A stop leaves the focuser where it stands.'}</Notice>}
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
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
	// Only the elapsed time is refreshed here; the session itself runs on the server.
	const now = useNow(running)

	const last = session.lastMeasurement
	const failed = session.state === 'failed'

	return (
		<>
			<SessionStateText failed={failed}>
				{AUTO_FOCUS_STATE_LABELS[session.state]}
				{session.target !== undefined && running && ` — ${session.target}`}
			</SessionStateText>
			{(session.state === 'exposing' || session.state === 'verifying') && <FrameProgress exposure={session.exposure} />}
			{failed && session.error && <Notice error>{session.error}</Notice>}
			<DataList>
				<DataRow label="Focuser">{position === undefined ? MISSING : `${position}${moving ? ' (moving)' : ''}`}</DataRow>
				{session.initialPosition !== undefined && <DataRow label="Start Position">{session.initialPosition}</DataRow>}
				<DataRow label="Samples">{session.measurementCount}</DataRow>
				{last && <DataRow label="Last HFD">{last.hfd === undefined ? `— at ${last.requestedPosition}` : `${last.hfd.toFixed(2)} px at ${last.requestedPosition}`}</DataRow>}
				{last && <DataRow label="Stars">{`${last.acceptedCount} / ${last.detectedCount}`}</DataRow>}
				<DataRow label="Estimated Best">{session.estimatedPosition ?? MISSING}</DataRow>
				{session.estimatedHfd !== undefined && <DataRow label="Fitted HFD">{`${session.estimatedHfd.toFixed(2)} px`}</DataRow>}
				<DataRow label="Final Position">{session.finalPosition ?? MISSING}</DataRow>
				<DataRow label="Verification">{session.verification === 'measured' && session.verifiedHfd !== undefined ? `${session.verifiedHfd.toFixed(2)} px measured` : session.verification === 'pending' ? 'Pending' : VERIFICATION_LABELS[session.verification]}</DataRow>
				<DataRow label="Elapsed">{formatClockDuration(((session.endedAt ?? now) - session.startedAt) / 1000)}</DataRow>
			</DataList>
			{last && last.warnings.length > 0 && <Notice>{last.warnings.join(' ')}</Notice>}
			{session.verificationError && <Notice>{session.verificationError}</Notice>}
			{session.state === 'cancelled' && <Notice>{session.restored ? 'The focuser was moved back to the start position.' : session.restored === false ? 'The focuser could not be moved back to the start position and was left where it stood.' : 'The focuser was left where the stop found it.'}</Notice>}
		</>
	)
}
