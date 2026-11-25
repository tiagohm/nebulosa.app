import type { AutoFocusSessionSummary, CaptureSnoop, DeviceSummary } from 'api'
import { useSnapshot } from 'valtio'
import { controlRuntime, deviceStateOf, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import { type RoleDevice, useRoleDevice } from '../equipment/useEquipment'
import { formatClockDuration, formatExposureTime, formatPixelLength, formatZonedDateTime, MISSING } from '../format'
import { useActiveTimeZone } from '../location/useLocation'
import { operationsState } from '../operations'
import { activeProfile, autoFocusSettings, exposureSettings, profileState, setAutoFocusSettings, starDetectionSettings } from '../profile/profile'
import type { AutoFocusSettings, CameraIdentity } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { CameraStarDetectionSection } from '../stars/CameraStarDetectionSection'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { useNow } from '../useNow'
import {
	AUTO_FOCUS_STATE_LABELS,
	autoFocusBlocker,
	autoFocusFailureText,
	autoFocusLeftAt,
	autoFocusRemedy,
	autoFocusRequest,
	autoFocusRunning,
	autoFocusRuntime,
	autoFocusStepSize,
	autoFocusSummaryText,
	autoFocusSweep,
	FITTING_MODE_LABELS,
	FITTING_MODES,
	startAutoFocus,
	stopAutoFocus,
	VERIFICATION_LABELS,
} from './autofocus'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import { type ExposureUnit, ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of Auto Focus, a camera operation of the Images camera tabs. The session comes first: the
// state of the running or last session, with the focuser position it reached as the one Readout of the panel, how it
// ended and where it left the focuser, and the Run and Stop commands with why a run cannot start. Then the routine the
// server's runner follows (fitting, step size, positions per side, the sweep it plans from where the focuser stands,
// and the advanced settings collapsed), and, collapsed with their summaries, the equipment it uses, each device linked
// to Equipment Control, and the two sections it only mirrors: the frames are taken with the exposure time of this form
// and the camera's camera settings, edited only in Camera Acquisition, and measured with the profile's star detection
// request, edited in Images → Star Detection. The camera is the panel's target and the focuser the one associated with
// it; a camera without a focuser says how to associate one. The filter wheel, when assigned, is shown and never moved.
// The forms are the camera's, kept in the profile; the session is the server's, shown here from the server state
// whichever tab started it, and keeps running when the panel unmounts. Its frames are shown by the latest frame of the
// camera, never by a viewer of its own.

// Units of the exposure time of Auto Focus frames: a focusing frame is never shorter than a millisecond.
const EXPOSURE_UNITS: readonly ExposureUnit[] = ['m', 's', 'ms']

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
	const stepSize = autoFocusStepSize(settings.stepSize, focuserState)
	// Where the focuser stands, in steps; unknown while it is disconnected or has not reported.
	const position = focuserState?.connected ? focuserState.position.value : undefined
	const sweep = position === undefined ? undefined : autoFocusSweep(position, settings, stepSize)
	const blocker = running ? undefined : autoFocusBlocker(availability, focuser && roleAvailability('FOCUSER', focuser, operations), focuserState, sweep)
	const acquisition = running && session ? session.request.capture : exposure

	// Updates fields of the camera's Auto Focus form.
	function update(patch: Partial<AutoFocusSettings>) {
		setAutoFocusSettings(profileState, identity, patch)
	}

	function start() {
		if (!device || !focuserDevice) return
		const request = autoFocusRequest(settings, detection, exposure, { connectionId: focuserDevice.connectionId, deviceId: focuserDevice.id }, stepSize, snoop, capabilities)
		void startAutoFocus(autoFocusRuntime, device.connectionId, device.id, request)
	}

	const filter = wheelState?.connected ? wheelState.names[wheelState.position] || `Slot ${wheelState.position + 1}` : undefined
	const direction = settings.reversed ? 'inward' : 'outward'

	return (
		<>
			<CollapsibleSection id="images.auto-focus.current-session" title={running ? 'Current Session' : session ? 'Last Session' : 'Session'} summary={session && autoFocusSummaryText(session)}>
				{session && <SessionState session={session} position={position} moving={focuserState?.moving} />}
				{running ? (
					<Button
						variant="secondary"
						title={session!.request.restoreOnStop ? 'Stop the sweep and move the focuser back to the start position' : 'Stop the sweep and leave the focuser where it stands'}
						disabled={pending || session!.state === 'stopping'}
						onClick={() => void stopAutoFocus(autoFocusRuntime, session!)}
					>
						{session!.state === 'stopping' ? 'Stopping…' : 'Stop'}
					</Button>
				) : (
					<Button title={blocker} disabled={blocker !== undefined || pending} onClick={start}>
						Run Auto Focus
					</Button>
				)}
				{blocker && <Notice>{blocker}</Notice>}
				{!running && !focuserDevice && <EquipmentSetupButton />}
				{running && <Notice>{session!.request.restoreOnStop ? 'A stop moves the focuser back to the start position; a second stop leaves it where it stands.' : 'A stop leaves the focuser where it stands.'}</Notice>}
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="images.auto-focus.algorithm" summary={`${FITTING_MODE_LABELS[settings.fittingMode]} · ${stepSize} steps`} title="Algorithm">
				<Select label="Curve Fitting" options={FITTING_MODES} value={settings.fittingMode} format={(mode) => FITTING_MODE_LABELS[mode]} disabled={locked} onChange={(fittingMode) => update({ fittingMode })} />
				<NumberInput label="Step Size" value={stepSize} min={1} max={focuserState?.connected ? Math.max(1, focuserState.position.max - focuserState.position.min) : undefined} suffix="steps" disabled={locked} onChange={(value) => update({ stepSize: value })} />
				<NumberInput label="Positions per Side" value={settings.initialOffsetSteps} min={1} max={50} disabled={locked} onChange={(initialOffsetSteps) => update({ initialOffsetSteps })} />
				<Notice>
					{sweep
						? `The sweep runs from ${sweep.far} to ${sweep.near} steps, then extends until both sides of the minimum have ${settings.initialOffsetSteps} positions.`
						: `The sweep starts ${settings.initialOffsetSteps * stepSize} steps ${direction} of the focuser and extends until both sides of the minimum have ${settings.initialOffsetSteps} positions.`}
				</Notice>
				<Checkbox label="Return to the start position when stopped" checked={settings.restoreOnStop} disabled={locked} onChange={(restoreOnStop) => update({ restoreOnStop })} />
			</CollapsibleSection>
			<CollapsibleSection id="images.auto-focus.advanced-settings" title="Advanced Settings" defaultOpen={false}>
				<Checkbox label="Start the sweep inward" checked={settings.reversed} disabled={locked} onChange={(reversed) => update({ reversed })} />
				<NumberInput label="Settle Time" value={settings.settleDelay} min={0} max={600} step={0.1} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
				<NumberInput label="Measurement Timeout" value={settings.measureTimeout} min={1} max={3600} suffix="s" disabled={locked} onChange={(measureTimeout) => update({ measureTimeout })} />
				<NumberInput label="Max RMSD / HFD" value={settings.rmsdThreshold} min={0} max={10} step={0.01} disabled={locked} onChange={(rmsdThreshold) => update({ rmsdThreshold })} />
				<Notice>A fitted curve whose error exceeds this fraction of its best HFD is rejected; 0 accepts any fit. Backlash is compensated as saved for the focuser in Equipment Control.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.auto-focus.equipment" title="Equipment" summary={focuserDevice?.name ?? 'No focuser'} defaultOpen={false}>
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
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.auto-focus.acquisition"
				device={device}
				exposure={acquisition}
				capabilities={capabilities}
				defaultOpen={false}
				summary={[formatExposureTime(running && session ? session.request.capture.exposureTime : settings.exposureTime), `${acquisition.binX}×${acquisition.binY}`, ...(filter ? [filter] : [])].join(' · ')}
				description={
					<>
						Frames are LIGHT, taken with the camera settings of Camera Acquisition.
						{wheel.device && ` Filter: ${filter ?? 'not reported'}. The Auto Focus measures through the current filter and never changes it.`}
					</>
				}
			>
				<ExposureTimeInput value={settings.exposureTime} exposure={capabilities?.exposure} units={EXPOSURE_UNITS} disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
			</CameraAcquisitionSection>
			<CameraStarDetectionSection id="images.auto-focus.star-detection" device={device} defaultOpen={false} description={(detector) => <>Each frame is measured by the median HFD of its accepted stars with the Star Detection settings ({detector} detector). Frames are kept in memory only.</>} />
		</>
	)
}

interface SessionStateProps {
	// Session shown.
	readonly session: AutoFocusSessionSummary
	// Logical position the focuser reports now, in steps; undefined while unknown.
	readonly position?: number
	// Whether the focuser reports a motion.
	readonly moving?: boolean
}

// State of the running or last session: its step and, as the panel's Readout, the focuser position while it runs or
// the best focus it reached, with the HFD verified there; a session that did not complete says why and where it left
// the focuser. Then the start position, the samples, the best focus the curve estimated, and the times.
function SessionState({ session, position, moving }: SessionStateProps) {
	const running = autoFocusRunning(session)
	// Only the elapsed time is refreshed here; the session itself runs on the server.
	const now = useNow(running)
	const timeZone = useActiveTimeZone()

	const last = session.lastMeasurement
	const failed = session.state === 'failed'
	const completed = session.state === 'completed'
	const remedy = failed ? autoFocusRemedy(session) : undefined
	const leftAt = autoFocusLeftAt(session, position)
	// Samples of the first pass of the sweep: the far end, then one per step back to one step past the start.
	const firstPass = session.request.initialOffsetSteps + 2
	const { estimatedPosition, estimatedHfd } = session

	return (
		<>
			<SessionStateText failed={failed} succeeded={completed}>
				{AUTO_FOCUS_STATE_LABELS[session.state]}
			</SessionStateText>
			{(session.state === 'exposing' || session.state === 'verifying') && <FrameProgress exposure={session.exposure} />}
			{running && <FocuserReadout value={position === undefined ? MISSING : `${position} steps`} caption={`Focuser position${moving ? `, moving${session.target === undefined ? '' : ` to ${session.target} steps`}` : ''}`} />}
			{completed && session.finalPosition !== undefined && (
				<FocuserReadout value={`${session.finalPosition} steps`} caption={session.verification === 'measured' && session.verifiedHfd !== undefined ? `Best focus, ${formatPixelLength(session.verifiedHfd)} HFD verified there` : `Best focus. ${VERIFICATION_LABELS[session.verification]}.`} />
			)}
			{failed && <Notice error>{autoFocusFailureText(session)}</Notice>}
			{remedy && <Notice>{remedy}</Notice>}
			{leftAt && <Notice>{leftAt}</Notice>}
			<DataList>
				{session.initialPosition !== undefined && <DataRow label="Start Position">{`${session.initialPosition} steps`}</DataRow>}
				<DataRow label="Samples">{running && session.measurementCount < firstPass ? `${session.measurementCount} of ${firstPass} in the first pass` : session.measurementCount}</DataRow>
				{running && last && <DataRow label="Last HFD">{`${formatPixelLength(last.hfd)} at ${last.requestedPosition} steps`}</DataRow>}
				{running && last && <DataRow label="Accepted Stars">{`${last.acceptedCount} of ${last.detectedCount}`}</DataRow>}
				{(running || estimatedPosition !== undefined) && <DataRow label="Estimated Best">{estimatedPosition === undefined ? MISSING : `${estimatedPosition} steps${estimatedHfd === undefined ? '' : `, ${formatPixelLength(estimatedHfd)}`}`}</DataRow>}
				{session.endedAt !== undefined && <DataRow label="Ended">{formatZonedDateTime(session.endedAt, timeZone)}</DataRow>}
				<DataRow label={running ? 'Elapsed' : 'Duration'}>{formatClockDuration(((session.endedAt ?? now) - session.startedAt) / 1000)}</DataRow>
			</DataList>
			{running && last && last.warnings.length > 0 && <Notice>{last.warnings.join(' ')}</Notice>}
			{session.verificationError && <Notice>{session.verificationError}</Notice>}
		</>
	)
}

// The one live reading of the panel, read from across the room: a focuser position over what it is.
function FocuserReadout({ value, caption }: { readonly value: string; readonly caption: string }) {
	return (
		<div className="flex flex-col gap-0.5">
			<p className="m-0 text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{value}</p>
			<p className="m-0 text-xs leading-4 text-ink-300 tabular-nums">{caption}</p>
		</div>
	)
}
