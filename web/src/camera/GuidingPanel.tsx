import type { CaptureSnoop, DeviceSummary, GuidingCalibrationSummary, GuidingCommand, GuidingSessionSummary } from 'api'
import { arcsec } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { RoleDevice } from '../equipment/useEquipment'
import { formatDegrees, formatPixelLength, formatPixelPosition } from '../format'
import { operationsState } from '../operations'
import { formatPixelScale } from '../platesolving/coordinates'
import { activeProfile, exposureSettings, guidingSettings, profileState, setGuidingSettings, starDetectionSettings } from '../profile/profile'
import { type CameraIdentity, GUIDING_MAXIMUM_PULSE, GUIDING_MAXIMUM_SEARCH_REGION, GUIDING_MINIMUM_PULSE, GUIDING_MINIMUM_SEARCH_REGION, type GuidingDitherMode, type GuidingSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { CameraStarDetectionSection } from '../stars/CameraStarDetectionSection'
import { useAstapConfigured } from '../stars/StarRequestControls'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'
import {
	clearGuidingCalibration,
	clearGuidingTarget,
	ditherGuiding,
	GUIDING_CALIBRATION_PHASE_LABELS,
	GUIDING_STATE_LABELS,
	guideFocalLength,
	guidingBlocker,
	guidingCalibrationBlocker,
	guidingCalibrationPulse,
	guidingDitherRequest,
	guidingExposureRange,
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
import { CalibrationProgress } from './GuidingCalibrationProgress'
import { StarProfileSection } from './GuidingStarProfile'

// Contextual panel sections of Guiding, a camera operation of the Images camera tabs: the equipment it uses, the state
// of the session (the progress of the guide exposure, the lock, the solved calibration, the RMS, the outcome of the
// latest command), the Star Profile of the guide star, the guide exposure, tracking and star search, the calibration
// and controller settings, the settle and dither pattern, and the commands of each state: start and
// stop looping, select or clear the star, start and stop guiding, pause (corrections only, or the exposures too),
// resume, dither, force a new calibration, and clear the calibration. Every solved calibration is saved by the server,
// which restores a matching one at the next Start Guiding when the form allows it; the session tells where the
// calibration in use came from, whether it was saved, and how it was adapted to the mount. The camera is the panel's target and the guide output the GUIDE_OUTPUT of
// the setup, which only the Guide Camera has; a missing or unsuitable one says why. The frames take the camera
// settings of Camera Acquisition without its exposure time, shown under the guide exposure, and their stars are
// detected with the detector of the profile's Star Detection (built-in or ASTAP) and its settings, as Auto Focus does;
// the guide telescope of the Equipment Setup gives the pixel scale and the calibration step. The form is the camera's, kept in
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
	const calibrationInputs = { focalLength, pixelSize: capabilities?.sensor?.pixelSize, guideRate: outputState?.hasGuideRate ? outputState.guideRate.rightAscension : undefined, declination: mountState?.declination }
	const calculateBlocker = guidingCalibrationBlocker(calibrationInputs, exposure.binX)
	const calibrationPulse =
		calculateBlocker === undefined && focalLength !== undefined && calibrationInputs.pixelSize !== undefined && calibrationInputs.guideRate !== undefined && calibrationInputs.declination !== undefined
			? guidingCalibrationPulse(focalLength, calibrationInputs.pixelSize, exposure.binX, calibrationInputs.guideRate, calibrationInputs.declination)
			: undefined

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
		void startGuidingSession(
			guidingRuntime,
			device.connectionId,
			device.id,
			guidingRequest(settings, exposure, { guideOutput: { connectionId: guideOutput.device.connectionId, deviceId: guideOutput.device.id }, ...(mount.device && { mount: { connectionId: mount.device.connectionId, deviceId: mount.device.id } }) }, snoop, detection, focalLength, capabilities),
		)
	}

	return (
		<>
			<CollapsibleSection id="images.guiding.equipment" title="Equipment">
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Guide Output">{guideOutput ? <DeviceLink device={guideOutput.device} fallback="Not assigned" /> : 'Guide Camera only'}</DataRow>
					<DataRow label="Guide Focal Length">{focalLength !== undefined ? `${Number(focalLength.toFixed(1))} mm` : 'Not set'}</DataRow>
					{session?.pixelScale !== undefined && <DataRow label="Pixel Scale">{formatPixelScale(arcsec(session.pixelScale))}</DataRow>}
				</DataList>
				{!running && outputAvailability && outputAvailability.status !== 'ready' && outputAvailability.status !== 'busy' && <Notice>{outputAvailability.message}</Notice>}
				{!running && focalLength === undefined && <Notice>Enter the Guide Telescope in Equipment Setup for the pixel scale of the RMS in arcseconds and the calibration step.</Notice>}
				<Checkbox label="Stop guiding when the mount slews" checked={settings.stopGuidingOnSlew} disabled={running || pending} onChange={(stopGuidingOnSlew) => update({ stopGuidingOnSlew })} />
				{!running && (!guideOutput || focalLength === undefined || outputAvailability?.status === 'notSelected' || outputAvailability?.status === 'unsupported') && <EquipmentSetupButton />}
			</CollapsibleSection>
			{session && <SessionState session={session} />}
			{session?.star && <StarProfileSection star={session.star} pixelScale={session.pixelScale} frameId={session.frame?.frameId} />}
			<CameraAcquisitionSection id="images.guiding.acquisition" device={device} exposure={exposure} capabilities={capabilities} description="The guide frames are LIGHTs taken with the camera settings of Camera Acquisition, shown as the latest frame of the camera and never saved.">
				<ExposureTimeInput value={settings.exposureTime} exposure={guidingExposureRange(capabilities?.exposure)} disabled={pending} onChange={changeExposure} />
			</CameraAcquisitionSection>
			<CameraStarDetectionSection
				id="images.guiding.star-detection"
				device={device}
				provider={detection.provider}
				description={(detector) => (
					<>
						Stars are detected with the Star Detection settings ({detector} detector), chosen when looping starts; the guider accepts those of 5 sigma or more.
						{detection.provider === 'astap' && ' ASTAP runs as a separate program on every frame, about half a second on a full frame.'}
					</>
				)}
			/>
			<CollapsibleSection id="images.guiding.tracking" title="Tracking">
				<SegmentedControl label="Tracking" options={['singleStar', 'multiStar'] as const} value={settings.trackingMode} format={(mode) => TRACKING_LABELS[mode]} disabled={running || pending} onChange={(trackingMode) => update({ trackingMode })} />
				<NumberInput label="Search Region" value={settings.searchRegion} min={GUIDING_MINIMUM_SEARCH_REGION} max={GUIDING_MAXIMUM_SEARCH_REGION} step={4} suffix="px" disabled={running || pending} onChange={(searchRegion) => update({ searchRegion: Math.round(searchRegion) })} />
				<Checkbox label="Sticky lock position" checked={settings.stickyLockPosition} disabled={running || pending} onChange={(stickyLockPosition) => update({ stickyLockPosition })} />
				<Notice>The guide star is searched in a square of this side around the lock. A sticky lock stays exactly where it is when the guider starts again, instead of moving to the star.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.guiding.calibration" title="Calibration" defaultOpen={false}>
				<Checkbox label="Restore a saved calibration that matches" checked={settings.autoRestoreCalibration} disabled={running || pending} onChange={(autoRestoreCalibration) => update({ autoRestoreCalibration })} />
				<Checkbox label="Calibrate again on every start" checked={settings.recalibrateOnEveryStart} disabled={running || pending} onChange={(recalibrateOnEveryStart) => update({ recalibrateOnEveryStart })} />
				<Notice>Every calibration is saved. Start Guiding restores the best one measured with the same guide camera, guide output, mount, binning, pixel scale and guide rate, adapted to the declination and the side of the pier the mount reports; without one, it calibrates.</Notice>
				<Checkbox label="Declination compensation" checked={settings.declinationCompensation} disabled={running || pending} onChange={(declinationCompensation) => update({ declinationCompensation })} />
				<Notice>Scales the RA response of a calibration reused at another declination. Turn it off for a mount that already scales its RA guide rate by the declination, or one that is not equatorial.</Notice>
				<Checkbox label="Assume DEC orthogonal to RA" checked={settings.assumeDecOrthogonalToRa} disabled={running || pending} onChange={(assumeDecOrthogonalToRa) => update({ assumeDecOrthogonalToRa })} />
				<div className="flex flex-col gap-2">
					<NumberInput label="Calibration Step" value={settings.calibrationPulse} min={GUIDING_MINIMUM_PULSE} max={GUIDING_MAXIMUM_PULSE} step={50} suffix="ms" disabled={running || pending} onChange={(calibrationPulse) => update({ calibrationPulse })} className="flex-1" />
					<Button variant="secondary" disabled={running || pending || calibrationPulse === undefined} title={calculateBlocker ?? (calibrationPulse === undefined ? undefined : `${calibrationPulse} ms`)} onClick={() => calibrationPulse !== undefined && update({ calibrationPulse })}>
						Calculate
					</Button>
				</div>
				{!running && calculateBlocker && <Notice>{calculateBlocker}</Notice>}
				<Notice>Calculate sizes the step to move the star about 25 px in 12 RA steps at the declination the mount points at; calibrate away from the pole.</Notice>
				<Checkbox label="Reverse DEC output after a meridian flip" checked={settings.reverseDecOutputAfterMeridianFlip} disabled={running || pending} onChange={(reverseDecOutputAfterMeridianFlip) => update({ reverseDecOutputAfterMeridianFlip })} />
				<Notice>Reversing the DEC output applies when a calibration is flipped for the other side of the pier; leave it off for mounts that reverse it themselves.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.guiding.corrections" title="Corrections" defaultOpen={false}>
				<NumberInput label="RA Aggressiveness" value={settings.aggressivenessRA} min={0} max={1} step={0.05} disabled={running || pending} onChange={(aggressivenessRA) => update({ aggressivenessRA })} />
				<NumberInput label="DEC Aggressiveness" value={settings.aggressivenessDEC} min={0} max={1} step={0.05} disabled={running || pending} onChange={(aggressivenessDEC) => update({ aggressivenessDEC })} />
				<NumberInput label="RA Max Pulse" value={settings.maximumPulseRA} min={GUIDING_MINIMUM_PULSE} max={GUIDING_MAXIMUM_PULSE} step={100} suffix="ms" disabled={running || pending} onChange={(maximumPulseRA) => update({ maximumPulseRA })} />
				<NumberInput label="DEC Max Pulse" value={settings.maximumPulseDEC} min={GUIDING_MINIMUM_PULSE} max={GUIDING_MAXIMUM_PULSE} step={100} suffix="ms" disabled={running || pending} onChange={(maximumPulseDEC) => update({ maximumPulseDEC })} />
			</CollapsibleSection>
			<CollapsibleSection id="images.guiding.settle-and-dither" title="Settle and Dither" defaultOpen={false}>
				<NumberInput label="Settle Within" value={settings.settle.pixels} min={0.1} max={50} step={0.1} suffix="px" disabled={pending} onChange={(pixels) => update({ settle: { ...settings.settle, pixels } })} />
				<NumberInput label="Settle For" value={settings.settle.time} min={0} max={600} step={1} suffix="s" disabled={pending} onChange={(time) => update({ settle: { ...settings.settle, time } })} />
				<NumberInput label="Settle Timeout" value={settings.settle.timeout} min={1} max={3600} step={5} suffix="s" disabled={pending} onChange={(timeout) => update({ settle: { ...settings.settle, timeout } })} />
				<NumberInput label="Dither" value={settings.ditherPixels} min={0.1} max={100} step={0.5} suffix="px" disabled={pending} onChange={(ditherPixels) => update({ ditherPixels })} />
				<Select label="Dither Pattern" options={DITHER_MODES} value={settings.ditherMode} format={(mode) => DITHER_MODE_LABELS[mode]} disabled={running || pending} onChange={(ditherMode) => update({ ditherMode })} />
				<Checkbox label="Dither in RA only" checked={settings.ditherRaOnly} disabled={pending} onChange={(ditherRaOnly) => update({ ditherRaOnly })} />
				<Checkbox label="Fast recenter after calibration or dither" checked={settings.fastRecenter} disabled={running || pending} onChange={(fastRecenter) => update({ fastRecenter })} />
			</CollapsibleSection>
			<CollapsibleSection id="images.guiding.controls" title="Controls">
				{session && running ? (
					<SessionControls session={session} settings={settings} pending={pending} />
				) : (
					<Button disabled={blocker !== undefined || pending} onClick={start}>
						Start Looping
					</Button>
				)}
				{blocker && <Notice>{blocker}</Notice>}
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
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
	const calibrates = settings.recalibrateOnEveryStart || (!session.calibrated && !settings.autoRestoreCalibration)

	return (
		<>
			{!guiding && (
				<div className="flex flex-wrap gap-2">
					<Button disabled={busy} onClick={() => void startGuiding(guidingRuntime, session, guidingStartRequest(settings))}>
						{calibrates ? 'Calibrate and Guide' : 'Start Guiding'}
					</Button>
					{!calibrates && (
						<Button variant="secondary" disabled={busy} onClick={() => void startGuiding(guidingRuntime, session, guidingStartRequest(settings, true))}>
							Force Recalibrate
						</Button>
					)}
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

// State of a session: the progress of the guide exposure, the guider state (with the step and the legs of a running
// calibration) and its lock, the calibration, the RMS, the latest command, and why it ended.
function SessionState({ session }: { readonly session: GuidingSessionSummary }) {
	const { calibration, rms, command, pixelScale } = session

	return (
		<CollapsibleSection id="images.guiding.session" title="Session">
			{session.active && <FrameProgress exposure={session.exposureProgress} />}
			<DataList>
				<DataRow label="State" tone={session.state === 'lostLock' ? 'danger' : session.state === 'guiding' ? 'success' : 'default'}>
					{session.active ? GUIDING_STATE_LABELS[session.state] : session.lost ? 'Lost' : 'Stopped'}
				</DataRow>
				{session.state === 'calibrating' && session.calibrating && <DataRow label="Step">{GUIDING_CALIBRATION_PHASE_LABELS[session.calibrating.phase]}</DataRow>}
				{session.settling && <DataRow label="Settling">{session.dithering ? 'After a dither' : 'Yes'}</DataRow>}
				{session.lockPosition && <DataRow label="Lock">{formatPixelPosition(session.lockPosition[0], session.lockPosition[1])}</DataRow>}
				{calibration && (
					<>
						<DataRow label="Calibration" tone={calibration.assessment.quality === 'poor' ? 'danger' : 'default'}>
							{`${calibration.origin === 'restored' ? 'Restored' : 'Solved'}, ${QUALITY_LABELS[calibration.assessment.quality]}`}
						</DataRow>
						<DataRow label="Calibrated At">{formatCalibrationContext(calibration.source)}</DataRow>
						{calibration.transformations.length > 0 && <DataRow label="Adapted">{formatTransformations(calibration)}</DataRow>}
						<DataRow label="RA Rate">{`${formatRate(calibration.raRate)} at ${formatDegrees(calibration.raAngle, 1)}`}</DataRow>
						<DataRow label="DEC Rate">{`${formatRate(calibration.decRate)} at ${formatDegrees(calibration.decAngle, 1)}`}</DataRow>
						{calibration.backlash > 0 && <DataRow label="DEC Backlash">{`${Math.round(calibration.backlash)} ms`}</DataRow>}
					</>
				)}
				{rms && rms.samples > 0 && (
					<>
						<DataRow label="RMS RA">{formatPixelLength(rms.ra, pixelScale)}</DataRow>
						<DataRow label="RMS DEC">{formatPixelLength(rms.dec, pixelScale)}</DataRow>
						<DataRow label="RMS Total">{`${formatPixelLength(rms.total, pixelScale)} (${rms.samples})`}</DataRow>
					</>
				)}
				{command && (
					<DataRow label={COMMAND_LABELS[command.command]} tone={command.state === 'failed' ? 'danger' : command.state === 'succeeded' ? 'success' : 'default'}>
						{command.state === 'running' ? 'Running' : command.state === 'succeeded' ? 'Done' : 'Failed'}
					</DataRow>
				)}
			</DataList>
			{session.state === 'calibrating' && session.calibrating && <CalibrationProgress progress={session.calibrating} />}
			{command?.state === 'failed' && command.error && <Notice error>{command.error}</Notice>}
			{calibration && calibration.warnings.length > 0 && <Notice>{calibration.warnings.join(' ')}</Notice>}
			{calibration && !calibration.saved && <Notice error>{`The calibration was not saved for later sessions${calibration.saveError ? `: ${calibration.saveError}` : '.'}`}</Notice>}
			{session.interruption && <Notice error>The mount slewed while guiding, commanded outside Nebulosa, so guiding stopped and the star was cleared. Select a star and start guiding again.</Notice>}
			{session.failure && <Notice error>{session.failure.error ?? `The session ended: ${session.failure.reason}.`}</Notice>}
		</CollapsibleSection>
	)
}

// Labels of the grades of a calibration.
const QUALITY_LABELS: Readonly<Record<GuidingCalibrationSummary['assessment']['quality'], string>> = { good: 'good', warning: 'usable with warnings', poor: 'poor' }

// Formats the mount context of a calibration: its declination in degrees and its side of the pier, each when known.
function formatCalibrationContext({ declination, pierSide }: GuidingCalibrationSummary['source']) {
	const parts = [declination !== undefined ? `DEC ${formatDegrees(declination, 1)}` : 'DEC unknown', pierSide ? `pier ${pierSide.toLowerCase()}` : 'pier side unknown']
	return parts.join(', ')
}

// Formats how the calibration in use was adapted from the one measured: flipped for the other side of the pier, and its
// RA response scaled for the declination.
function formatTransformations({ transformations, declinationScale }: GuidingCalibrationSummary) {
	return transformations.map((transformation) => (transformation === 'pierFlip' ? 'flipped for the pier side' : `RA ×${declinationScale.toFixed(2)} for the declination`)).join(', ')
}

// Formats a calibration rate given in pixels per millisecond as pixels per second.
function formatRate(rate: number) {
	return `${(rate * 1000).toFixed(2)} px/s`
}
