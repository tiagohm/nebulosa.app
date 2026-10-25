import type { CaptureSnoop, DeviceSummary, GuidingCommand, GuidingSessionSummary } from 'api'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { Notice } from '../equipment-control/parts'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { deviceState } from '../equipment/equipment'
import type { RoleDevice } from '../equipment/useEquipment'
import { operationsState } from '../operations'
import { activeProfile, exposureSettings, guidingSettings, profileState, setGuidingSettings, starDetectionSettings } from '../profile/profile'
import { type CameraIdentity, GUIDING_MAXIMUM_EXPOSURE, GUIDING_MAXIMUM_PULSE, GUIDING_MAXIMUM_SEARCH_REGION, GUIDING_MINIMUM_EXPOSURE, GUIDING_MINIMUM_PULSE, GUIDING_MINIMUM_SEARCH_REGION, type GuidingDitherMode, type GuidingSettings } from '../profile/schema'
import { PanelSection } from '../shell/ContextualPanel'
import { useAstapConfigured } from '../stars/StarRequestControls'
import { PROVIDER_LABELS } from '../stars/stars'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { cameraKey } from './capture'
import { FrameProgress } from './FrameProgress'
import {
	clearGuidingCalibration,
	clearGuidingTarget,
	ditherGuiding,
	GUIDING_STATE_LABELS,
	guideFocalLength,
	guidingBlocker,
	guidingCalibrationPulse,
	guidingDitherRequest,
	guidingRequest,
	guidingRunning,
	guidingRuntime,
	guidingStartRequest,
	pauseGuiding,
	resumeGuiding,
	selectGuidingTarget,
	setGuidingExposure,
	startGuiding,
	startGuidingSession,
	stopGuiding,
	stopGuidingSession,
} from './guiding'
import { StarProfileSection } from './GuidingStarProfile'

// Contextual panel sections of Guiding, a camera operation of the Images camera tabs: the equipment it uses, the state
// of the session (the progress of the guide exposure, the lock, the solved calibration, the RMS, the outcome of the
// latest command), the Star Profile of the guide star, the guide exposure, tracking and star search, the calibration
// and controller settings, the settle and dither pattern, and the commands of each state: start and
// stop looping, select or clear the star, start and stop guiding, pause (corrections only, or the exposures too),
// resume, dither, and clear the calibration. The camera is the panel's target and the guide output the GUIDE_OUTPUT of
// the setup, which only the Guide Camera has; a missing or unsuitable one says why. The frames take the camera
// settings of Camera Acquisition without its exposure time, and their stars are detected with the detector of the
// profile's Star Detection (built-in or ASTAP) and its settings, as Auto Focus does; the guide telescope of the Equipment
// Setup gives the pixel scale and the calibration step. The form is the camera's, kept in
// the profile; while a session runs, only its exposure changes it, and the other settings are locked showing the form.
// The session is the server's, shown here whichever tab started it, and keeps running when the panel unmounts; a click
// on its current frame selects the star nearest it. Pixel values are guide-camera pixels, pulses milliseconds.

// Camera a guiding panel guides with and the forms it edits.
export interface GuidingTarget {
	// Camera, when present on the watched connection.
	readonly device?: DeviceSummary
	// Whether the camera can take frames now, and why not.
	readonly availability: RoleAvailability
	// Guide output of the equipment setup and its state; absent when the camera is not the Guide Camera.
	readonly guideOutput?: RoleDevice
	// Mount of the equipment setup, for the declination of the calibration step.
	readonly mount: RoleDevice
	// Camera whose forms are edited; absent when the profile has no saved connection, so the defaults are shown and
	// nothing is kept.
	readonly settings?: CameraIdentity
	// Devices snooped into the guide frame headers.
	readonly snoop: CaptureSnoop
}

// Label of each durable command, as its outcome is reported.
const COMMAND_LABELS: Readonly<Record<GuidingCommand, string>> = { startGuiding: 'Start guiding', stopGuiding: 'Stop guiding', pause: 'Pause', resume: 'Resume', dither: 'Dither' }

// Dither patterns in menu order.
const DITHER_MODES: readonly GuidingDitherMode[] = ['random', 'spiral', 'golden', 'grid']

// Labels of the dither patterns.
const DITHER_MODE_LABELS: Readonly<Record<GuidingDitherMode, string>> = { random: 'Random', spiral: 'Spiral', golden: 'Golden Spiral', grid: 'Grid' }

// Labels of the tracking modes.
const TRACKING_LABELS: Readonly<Record<GuidingSettings['trackingMode'], string>> = { singleStar: 'Single Star', multiStar: 'Multi Star' }

// Guiding panel sections of a camera.
export function GuidingSections({ device, availability, guideOutput, mount, settings: identity, snoop }: GuidingTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(guidingRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const profile = activeProfile(profiles)
	const settings = guidingSettings(profile.settings, identity)
	const exposure = exposureSettings(profile.settings, identity)
	const detection = starDetectionSettings(profile.settings).detector
	const astapConfigured = useAstapConfigured()
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const running = guidingRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	const outputState = watchedDeviceState(control, 'guideOutput', guideOutput?.device)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const outputAvailability = guideOutput && roleAvailability('GUIDE_OUTPUT', guideOutput, operations, outputState && !outputState.canPulseGuide ? 'The guide output cannot pulse guide.' : undefined)
	const blocker = running ? undefined : guidingBlocker(availability, outputAvailability, settings, detection.provider === 'astap' && !astapConfigured)
	const focalLength = guideFocalLength(profile.settings.guideTelescope)
	const calibrationPulse = focalLength !== undefined && capabilities?.sensor && outputState?.hasGuideRate && mountState ? guidingCalibrationPulse(focalLength, capabilities.sensor.pixelSize, exposure.binX, outputState.guideRate.rightAscension, mountState.declination) : undefined

	// Updates fields of the camera's guiding form.
	function update(patch: Partial<GuidingSettings>) {
		setGuidingSettings(profileState, identity, patch)
	}

	// Changes the guide exposure of the form, and of the running session.
	function changeExposure(exposureTime: number) {
		update({ exposureTime })
		if (session && running) void setGuidingExposure(guidingRuntime, session, exposureTime)
	}

	function start() {
		if (!device || !guideOutput?.device) return
		void startGuidingSession(guidingRuntime, device.connectionId, device.id, guidingRequest(settings, exposure, { connectionId: guideOutput.device.connectionId, deviceId: guideOutput.device.id }, snoop, detection, focalLength, capabilities))
	}

	return (
		<>
			<PanelSection title="Equipment">
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					<Row label="Camera">
						<DeviceLink device={device} fallback="—" />
					</Row>
					<Row label="Guide Output">{guideOutput ? <DeviceLink device={guideOutput.device} fallback="Not assigned" /> : 'Guide Camera only'}</Row>
					<Row label="Guide Focal Length">{focalLength !== undefined ? `${Number(focalLength.toFixed(1))} mm` : 'Not set'}</Row>
					{session?.pixelScale !== undefined && <Row label="Pixel Scale">{`${session.pixelScale.toFixed(2)}"/px`}</Row>}
				</dl>
				{!running && outputAvailability && outputAvailability.status !== 'ready' && outputAvailability.status !== 'busy' && <Notice>{outputAvailability.message}</Notice>}
				{!running && focalLength === undefined && <Notice>Enter the Guide Telescope in Equipment Setup for the pixel scale of the RMS in arcseconds and the calibration step.</Notice>}
				{!running && (!guideOutput || focalLength === undefined || outputAvailability?.status === 'notSelected' || outputAvailability?.status === 'unsupported') && (
					<Button variant="secondary" className="self-start" onClick={() => (deviceState.open = true)}>
						Equipment Setup
					</Button>
				)}
				<Notice>The guide frames are LIGHTs taken with the camera settings of Camera Acquisition, shown as the latest frame of the camera and never saved.</Notice>
				<Notice>
					Stars are detected with the Star Detection settings (<span className="text-accent">{PROVIDER_LABELS[detection.provider]}</span> detector), chosen when looping starts; the guider accepts those of 5 sigma or more.
					{detection.provider === 'astap' && ' ASTAP runs as a separate program on every frame, about half a second on a full frame.'}
				</Notice>
			</PanelSection>
			{session && <SessionState session={session} />}
			{session?.star && <StarProfileSection star={session.star} pixelScale={session.pixelScale} frameId={session.frame?.frameId} />}
			<PanelSection title="Exposure and Tracking">
				<NumberInput label="Exposure" value={settings.exposureTime} min={GUIDING_MINIMUM_EXPOSURE} max={GUIDING_MAXIMUM_EXPOSURE} step={0.5} suffix="s" disabled={pending} onChange={changeExposure} />
				<SegmentedControl label="Tracking" options={['singleStar', 'multiStar'] as const} value={settings.trackingMode} format={(mode) => TRACKING_LABELS[mode]} disabled={running || pending} onChange={(trackingMode) => update({ trackingMode })} />
				<NumberInput label="Search Region" value={settings.searchRegion} min={GUIDING_MINIMUM_SEARCH_REGION} max={GUIDING_MAXIMUM_SEARCH_REGION} step={4} suffix="px" disabled={running || pending} onChange={(searchRegion) => update({ searchRegion: Math.round(searchRegion) })} />
				<Checkbox label="Sticky lock position" checked={settings.stickyLockPosition} disabled={running || pending} onChange={(stickyLockPosition) => update({ stickyLockPosition })} />
				<Notice>The guide star is searched in a square of this side around the lock. A sticky lock stays exactly where it is when the guider starts again, instead of moving to the star.</Notice>
			</PanelSection>
			<PanelSection title="Calibration">
				<Checkbox label="Calibrate again on every start" checked={settings.recalibrate} disabled={pending} onChange={(recalibrate) => update({ recalibrate })} />
				<div className="flex items-end gap-2">
					<NumberInput label="Calibration Step" value={settings.calibrationPulse} min={GUIDING_MINIMUM_PULSE} max={GUIDING_MAXIMUM_PULSE} step={50} suffix="ms" disabled={running || pending} onChange={(calibrationPulse) => update({ calibrationPulse })} className="flex-1" />
					<Button
						variant="secondary"
						disabled={running || pending || calibrationPulse === undefined}
						title={calibrationPulse === undefined ? 'Needs the focal length of the Guide Telescope, the pixel size of the camera, the guide rate of the output, and the declination of the mount.' : `${calibrationPulse} ms`}
						onClick={() => calibrationPulse !== undefined && update({ calibrationPulse })}
					>
						Calculate
					</Button>
				</div>
				<Checkbox label="Reverse DEC output after a meridian flip" checked={settings.reverseDecOutputAfterMeridianFlip} disabled={running || pending} onChange={(reverseDecOutputAfterMeridianFlip) => update({ reverseDecOutputAfterMeridianFlip })} />
				<Notice>Calculate sizes the step to move the star about 25 px in 12 RA steps at the declination the mount points at; calibrate away from the pole.</Notice>
				<Notice>Reversing the DEC output applies when the calibration is flipped for a meridian flip, which guiding does not do yet; leave it off for mounts that reverse it themselves.</Notice>
			</PanelSection>
			<PanelSection title="Corrections">
				<NumberInput label="RA Aggressiveness" value={settings.aggressivenessRA} min={0} max={1} step={0.05} disabled={running || pending} onChange={(aggressivenessRA) => update({ aggressivenessRA })} />
				<NumberInput label="DEC Aggressiveness" value={settings.aggressivenessDEC} min={0} max={1} step={0.05} disabled={running || pending} onChange={(aggressivenessDEC) => update({ aggressivenessDEC })} />
				<NumberInput label="RA Max Pulse" value={settings.maximumPulseRA} min={GUIDING_MINIMUM_PULSE} max={GUIDING_MAXIMUM_PULSE} step={100} suffix="ms" disabled={running || pending} onChange={(maximumPulseRA) => update({ maximumPulseRA })} />
				<NumberInput label="DEC Max Pulse" value={settings.maximumPulseDEC} min={GUIDING_MINIMUM_PULSE} max={GUIDING_MAXIMUM_PULSE} step={100} suffix="ms" disabled={running || pending} onChange={(maximumPulseDEC) => update({ maximumPulseDEC })} />
			</PanelSection>
			<PanelSection title="Settle and Dither">
				<NumberInput label="Settle Within" value={settings.settle.pixels} min={0.1} max={50} step={0.1} suffix="px" disabled={pending} onChange={(pixels) => update({ settle: { ...settings.settle, pixels } })} />
				<NumberInput label="Settle For" value={settings.settle.time} min={0} max={600} step={1} suffix="s" disabled={pending} onChange={(time) => update({ settle: { ...settings.settle, time } })} />
				<NumberInput label="Settle Timeout" value={settings.settle.timeout} min={1} max={3600} step={5} suffix="s" disabled={pending} onChange={(timeout) => update({ settle: { ...settings.settle, timeout } })} />
				<NumberInput label="Dither" value={settings.ditherPixels} min={0.1} max={100} step={0.5} suffix="px" disabled={pending} onChange={(ditherPixels) => update({ ditherPixels })} />
				<Select label="Dither Pattern" options={DITHER_MODES} value={settings.ditherMode} format={(mode) => DITHER_MODE_LABELS[mode]} disabled={running || pending} onChange={(ditherMode) => update({ ditherMode })} />
				<Checkbox label="Dither in RA only" checked={settings.ditherRaOnly} disabled={pending} onChange={(ditherRaOnly) => update({ ditherRaOnly })} />
			</PanelSection>
			<PanelSection title="Controls">
				{session && running ? (
					<SessionControls session={session} settings={settings} pending={pending} />
				) : (
					<Button disabled={blocker !== undefined || pending} onClick={start}>
						Start Looping
					</Button>
				)}
				{blocker && <Notice>{blocker}</Notice>}
				{error && <Notice error>{error}</Notice>}
			</PanelSection>
		</>
	)
}

interface SessionControlsProps {
	// Running session.
	readonly session: GuidingSessionSummary
	// Guiding form, for the settle and dither of the commands.
	readonly settings: Readonly<GuidingSettings>
	// Whether a command of this tab waits for the server.
	readonly pending: boolean
}

// Commands of a running session, those of its state only; a durable command still running disables the others.
function SessionControls({ session, settings, pending }: SessionControlsProps) {
	const busy = pending || session.command?.state === 'running'
	const guiding = session.guideOutputHeld
	const paused = session.state === 'paused'

	return (
		<>
			{!guiding && (
				<div className="flex flex-wrap gap-2">
					<Button disabled={busy} onClick={() => void startGuiding(guidingRuntime, session, guidingStartRequest(settings))}>
						{session.calibrated && !settings.recalibrate ? 'Start Guiding' : 'Calibrate and Guide'}
					</Button>
					<Button variant="secondary" disabled={busy} onClick={() => void selectGuidingTarget(guidingRuntime, session)}>
						Auto Select Star
					</Button>
					{session.lockPosition && (
						<Button variant="secondary" disabled={busy} onClick={() => void clearGuidingTarget(guidingRuntime, session)}>
							Clear Star
						</Button>
					)}
					{session.calibrated && (
						<Button variant="secondary" disabled={busy} onClick={() => void clearGuidingCalibration(guidingRuntime, session)}>
							Clear Calibration
						</Button>
					)}
				</div>
			)}
			{guiding && (
				<div className="flex flex-wrap gap-2">
					<Button disabled={pending} onClick={() => void stopGuiding(guidingRuntime, session)}>
						Stop Guiding
					</Button>
					{paused ? (
						<Button variant="secondary" disabled={busy} onClick={() => void resumeGuiding(guidingRuntime, session, { ...settings.settle })}>
							Resume
						</Button>
					) : (
						session.state !== 'calibrating' && (
							<>
								<Button variant="secondary" disabled={busy} onClick={() => void pauseGuiding(guidingRuntime, session, 'corrections')}>
									Pause Corrections
								</Button>
								<Button variant="secondary" disabled={busy} onClick={() => void pauseGuiding(guidingRuntime, session, 'all')}>
									Pause All
								</Button>
								<Button variant="secondary" disabled={busy || session.state !== 'guiding'} onClick={() => void ditherGuiding(guidingRuntime, session, guidingDitherRequest(settings))}>
									Dither
								</Button>
							</>
						)
					)}
				</div>
			)}
			<Button variant="secondary" className="self-start" disabled={pending} onClick={() => void stopGuidingSession(guidingRuntime, session)}>
				Stop Looping
			</Button>
			{!guiding && <Notice>Click a star on the current frame to select it.</Notice>}
		</>
	)
}

// State of a session: the progress of the guide exposure, the guider state and its lock, the calibration, the RMS,
// the latest command, and why it ended.
function SessionState({ session }: { readonly session: GuidingSessionSummary }) {
	const { calibration, rms, command, pixelScale } = session

	return (
		<PanelSection title="Session">
			{session.active && session.exposureProgress && <FrameProgress exposure={session.exposureProgress} />}
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<Row label="State">
					<span className={cn(session.state === 'lostLock' && 'text-danger', session.state === 'guiding' && 'text-success')}>{session.active ? GUIDING_STATE_LABELS[session.state] : session.lost ? 'Lost' : 'Stopped'}</span>
				</Row>
				{session.settling && <Row label="Settling">{session.dithering ? 'After a dither' : 'Yes'}</Row>}
				{session.lockPosition && <Row label="Lock">{`${session.lockPosition[0].toFixed(1)}, ${session.lockPosition[1].toFixed(1)} px`}</Row>}
				{calibration && (
					<>
						<Row label="RA Rate">{`${formatRate(calibration.raRate)} at ${formatAngle(calibration.raAngle)}`}</Row>
						<Row label="DEC Rate">{`${formatRate(calibration.decRate)} at ${formatAngle(calibration.decAngle)}`}</Row>
						{calibration.backlash > 0 && <Row label="DEC Backlash">{`${Math.round(calibration.backlash)} ms`}</Row>}
					</>
				)}
				{rms && rms.samples > 0 && (
					<>
						<Row label="RMS RA / DEC">{`${formatError(rms.ra, pixelScale)} / ${formatError(rms.dec, pixelScale)}`}</Row>
						<Row label="RMS Total">{`${formatError(rms.total, pixelScale)} (${rms.samples})`}</Row>
					</>
				)}
				{command && (
					<Row label={COMMAND_LABELS[command.command]}>
						<span className={cn(command.state === 'failed' && 'text-danger', command.state === 'succeeded' && 'text-success')}>{command.state === 'running' ? 'Running' : command.state === 'succeeded' ? 'Done' : 'Failed'}</span>
					</Row>
				)}
			</dl>
			{command?.state === 'failed' && command.error && <Notice error>{command.error}</Notice>}
			{calibration && calibration.warnings.length > 0 && <Notice>{calibration.warnings.join(' ')}</Notice>}
			{session.failure && <Notice error>{session.failure.error ?? `The session ended: ${session.failure.reason}.`}</Notice>}
		</PanelSection>
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

// Formats a calibration rate given in pixels per millisecond as pixels per second.
function formatRate(rate: number) {
	return `${(rate * 1000).toFixed(2)} px/s`
}

// Formats an angle given in radians in degrees.
function formatAngle(angle: number) {
	return `${((angle * 180) / Math.PI).toFixed(1)}°`
}

// Formats a guide error given in guide pixels, with its value in arcseconds when the pixel scale (arcsec/px) is known.
function formatError(pixels: number, pixelScale?: number) {
	return pixelScale === undefined ? `${pixels.toFixed(2)} px` : `${pixels.toFixed(2)} px (${(pixels * pixelScale).toFixed(2)}")`
}
