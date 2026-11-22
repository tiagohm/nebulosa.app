import type { CaptureSnoop, DeviceSummary, GuidingCalibrationCandidate, GuidingCalibrationFailureSummary, GuidingCommand, GuidingDarkCandidates, GuidingSessionSummary } from 'api'
import { arcsec } from 'nebulosa/src/math/units/angle'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import type { BindableDevice } from '../equipment/catalog'
import { CatalogCameraNotice } from '../equipment/CatalogCameraNotice'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import { useProfileTelescopes } from '../equipment/telescopes'
import type { RoleDevice } from '../equipment/useEquipment'
import { formatDegrees, formatExposureTime, formatFixed, formatMillimeters, formatPixelPosition, formatTemperature, formatZonedDateTime } from '../format'
import { useActiveTimeZone } from '../location/useLocation'
import { operationsState } from '../operations'
import { formatPixelScale } from '../platesolving/coordinates'
import { activeProfile, exposureSettings, guidingSettings, profileState, setGuidingSettings, starDetectionSettings } from '../profile/profile'
import { type CameraIdentity, GUIDING_MAXIMUM_PULSE, GUIDING_MAXIMUM_SEARCH_REGION, GUIDING_MINIMUM_PULSE, GUIDING_MINIMUM_SEARCH_REGION, type GuidingDitherMode, type GuidingSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { CameraStarDetectionSection } from '../stars/CameraStarDetectionSection'
import { useAstapConfigured } from '../stars/StarRequestControls'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
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
	GUIDING_CALIBRATION_FAILURES,
	guidingBlocker,
	guidingCalibrationBlocker,
	guidingCalibrationPulse,
	guidingCalibrationWarning,
	guidingCalibrationWarningsText,
	guidingCommandErrorText,
	guidingDitherRequest,
	guidingExposureRange,
	guidingPixelScale,
	guidingRequest,
	guidingRunning,
	guidingRuntime,
	guidingStartRequest,
	loadGuidingCalibrationCandidates,
	loadGuidingDarkCandidates,
	pauseGuiding,
	restoreGuidingCalibration,
	resumeGuiding,
	selectGuidingTarget,
	setGuidingDark,
	setGuidingExposure,
	setSavedCalibrationDisabled,
	startGuiding,
	startGuidingSession,
	stopGuiding,
	stopGuidingSession,
	formatCalibrationAdaptation,
	formatPulse,
	formatCalibrationPlace,
	formatCalibrationRate,
} from './guiding'
import { CalibrationProgress } from './GuidingCalibrationProgress'
import { CALIBRATION_CANDIDATE_LABELS, CALIBRATION_QUALITY_LABELS, CALIBRATION_REJECTION_LABELS, GuidingCalibrationReview, type GuidingCalibrationReviewSource } from './GuidingCalibrationReview'
import { StarProfileSection } from './GuidingStarProfile'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of Guiding, a camera operation of the Images camera tabs. The session comes first: the guider
// state in words, the guide exposure, the RMS total as the one Readout of the panel, the legs of a running calibration
// or the failure of the last one with what to do about it, the commands of the state (start and stop looping, select or
// clear the star, start and stop guiding, pause the corrections only or the exposures too, resume, dither, force a new
// calibration, clear the calibration), why looping cannot start, and the details: the lock, the calibration in use with
// its review, and the outcome of the latest command. Then the Star Profile of the guide star, Saved Calibrations, the
// guide exposure, and, collapsed with their summaries, the settings: the master dark, the star detection, tracking and
// star search, calibration, corrections, settle and dither, and the equipment. Every solved calibration is saved by the
// server, which restores a matching one at the next Start Guiding when the form allows it, so the start command says
// whether it will calibrate; a calibration the panel knows would fail (the mount at the pole, a zero guide rate) is
// warned of beside it. A run whose guiding did not start while it still holds the guide output says so and offers only
// Stop Guiding, which releases it and the mount. Saved Calibrations lists those of the same equipment with how each fits
// the session, to review, restore while not guiding, or exclude from restoring. Dark subtracts a master dark of the
// Calibration Library from the guide frames: the form's choice is sent at the start and changes the running session too,
// and while it runs a master can be pinned among those matching its frames. The camera is the panel's target and the
// guide output the GUIDE_OUTPUT of the setup, which only the Guide Camera has; a missing or unsuitable one says why. The
// frames take the camera settings of Camera Acquisition without its exposure time, shown under the guide exposure, and
// their stars are detected with the detector of the profile's Star Detection (built-in or ASTAP) and its settings, as
// Auto Focus does; the guide telescope of the Equipment Setup gives the pixel scale and the calibration step. The form is
// the camera's, kept in the profile; while a session runs, only its exposure, its dark, and the settle and dither of its
// commands change it, and the other settings are locked showing the form. The session is the server's, shown here
// whichever tab started it, and keeps running when the panel unmounts; a click on its current frame selects the star
// nearest it. Pixel values are guide-camera pixels, pulses milliseconds.

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
	// Calibration the Review Calibration dialog shows; absent while it is closed.
	const [review, setReview] = useState<GuidingCalibrationReviewSource>()
	const capabilities = watchedDeviceState(control, 'camera', device)
	const outputState = watchedDeviceState(control, 'guideOutput', guideOutput?.device)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const outputAvailability = guideOutput && roleAvailability('GUIDE_OUTPUT', guideOutput, operations, outputState && !outputState.canPulseGuide ? 'The guide output cannot pulse guide.' : undefined)
	const blocker = running ? undefined : guidingBlocker(availability, outputAvailability, settings, detection.provider === 'astap' && !astapConfigured)
	const focalLength = guideFocalLength(useProfileTelescopes(profile.settings).guideTelescope)
	const calibrationInputs = { focalLength, pixelSize: capabilities?.sensor?.pixelSize, guideRate: outputState?.hasGuideRate ? outputState.guideRate.rightAscension : undefined, declination: mountState?.declination }
	const calculateBlocker = guidingCalibrationBlocker(calibrationInputs, exposure.binX)
	const calibrationWarning = guidingCalibrationWarning(calibrationInputs, exposure.binX)
	const calibrationPulse =
		calculateBlocker === undefined && focalLength !== undefined && calibrationInputs.pixelSize !== undefined && calibrationInputs.guideRate !== undefined && calibrationInputs.declination !== undefined
			? guidingCalibrationPulse(focalLength, calibrationInputs.pixelSize, exposure.binX, calibrationInputs.guideRate, calibrationInputs.declination)
			: undefined
	// Pixel scale of the guide frames, in arcseconds per pixel: the session's, else the one the guide optics and the
	// camera give, so it stays known once the session stopped.
	const pixelScale = session?.pixelScale ?? (focalLength !== undefined && calibrationInputs.pixelSize !== undefined ? guidingPixelScale(focalLength, calibrationInputs.pixelSize, exposure.binX) : undefined)
	const saved = useCalibrationCandidates(running ? session : undefined)
	const equipmentMissing = !guideOutput || focalLength === undefined || outputAvailability?.status === 'notSelected' || outputAvailability?.status === 'unsupported'

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

	// How Start Guiding gets its calibration, for the summary of Calibration.
	const calibrationPolicy = settings.recalibrateOnEveryStart ? 'Every start' : settings.autoRestoreCalibration ? 'Restore' : 'When needed'

	return (
		<>
			<CollapsibleSection id="images.guiding.session" title="Session" summary={session && sessionSummaryText(session, pixelScale)}>
				{session && <SessionStatus session={session} pixelScale={pixelScale} />}
				{session && running ? (
					<SessionControls session={session} settings={settings} pending={pending} restorable={saved.candidates?.some(usableCandidate)} calibrationWarning={calibrationWarning} />
				) : (
					<Button title={blocker} disabled={blocker !== undefined || pending} onClick={start}>
						Start Looping
					</Button>
				)}
				{blocker && <Notice>{blocker}</Notice>}
				{!running && equipmentMissing && <EquipmentSetupButton />}
				{error && <Notice error>{error}</Notice>}
				{running && <Notice>While the session runs, only the guide exposure, the dark, and the settle and dither change; the other settings are locked.</Notice>}
				{session && <SessionDetails session={session} pixelScale={pixelScale} onReview={() => setReview({ kind: 'session', sessionId: session.sessionId })} />}
			</CollapsibleSection>
			{session?.star && <StarProfileSection star={session.star} pixelScale={session.pixelScale} frameId={session.frame?.frameId} />}
			{session && running && <SavedCalibrations session={session} saved={saved} onReview={(calibrationId) => setReview({ kind: 'saved', calibrationId })} />}
			<CameraAcquisitionSection
				id="images.guiding.acquisition"
				device={device}
				exposure={exposure}
				capabilities={capabilities}
				summary={`${formatExposureTime(settings.exposureTime)} · ${exposure.binX}×${exposure.binY}`}
				description="The guide frames are LIGHTs taken with the camera settings of Camera Acquisition, shown as the latest frame of the camera and never saved."
			>
				<ExposureTimeInput value={settings.exposureTime} exposure={guidingExposureRange(capabilities?.exposure)} disabled={pending} onChange={changeExposure} />
			</CameraAcquisitionSection>
			<DarkSection device={device} session={running ? session : undefined} enabled={settings.useCalibrationLibraryDark} disabled={pending} onEnabled={(useCalibrationLibraryDark) => update({ useCalibrationLibraryDark })} />
			<CameraStarDetectionSection
				id="images.guiding.star-detection"
				device={device}
				provider={detection.provider}
				defaultOpen={false}
				description={(detector) => (
					<>
						Stars are detected with the Star Detection settings ({detector} detector), chosen when looping starts; the guider accepts those of 5 sigma or more.
						{detection.provider === 'astap' && ' ASTAP runs as a separate program on every frame, about half a second on a full frame.'}
					</>
				)}
			/>
			<CollapsibleSection id="images.guiding.tracking" title="Tracking" summary={`${TRACKING_LABELS[settings.trackingMode]} · ${settings.searchRegion} px${settings.stickyLockPosition ? ' · sticky' : ''}`} defaultOpen={false}>
				<SegmentedControl label="Tracking" options={['singleStar', 'multiStar'] as const} value={settings.trackingMode} format={(mode) => TRACKING_LABELS[mode]} disabled={running || pending} onChange={(trackingMode) => update({ trackingMode })} />
				<NumberInput label="Search Region" value={settings.searchRegion} min={GUIDING_MINIMUM_SEARCH_REGION} max={GUIDING_MAXIMUM_SEARCH_REGION} step={4} suffix="px" disabled={running || pending} onChange={(searchRegion) => update({ searchRegion: Math.round(searchRegion) })} />
				<Checkbox label="Sticky lock position" checked={settings.stickyLockPosition} disabled={running || pending} onChange={(stickyLockPosition) => update({ stickyLockPosition })} />
				<Notice>The guide star is searched in a square of this side around the lock. A sticky lock stays where it is when guiding starts again, instead of moving to the star.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.guiding.calibration" title="Calibration" summary={`${calibrationPolicy} · ${formatPulse(settings.calibrationPulse)}`} defaultOpen={false}>
				<Checkbox label="Restore a saved calibration that matches" checked={settings.autoRestoreCalibration} disabled={running || pending} onChange={(autoRestoreCalibration) => update({ autoRestoreCalibration })} />
				<Checkbox label="Calibrate again on every start" checked={settings.recalibrateOnEveryStart} disabled={running || pending} onChange={(recalibrateOnEveryStart) => update({ recalibrateOnEveryStart })} />
				<Notice>Every calibration is saved. Start Guiding restores the best one of the same equipment, binning, pixel scale and guide rate, adapted to the declination and the side of the pier; without one, it calibrates.</Notice>
				<Checkbox label="Declination compensation" checked={settings.declinationCompensation} disabled={running || pending} onChange={(declinationCompensation) => update({ declinationCompensation })} />
				<Notice>Scales the RA response of a calibration reused at another declination. Turn it off for a mount that scales its RA guide rate by the declination itself, or one that is not equatorial.</Notice>
				<Checkbox label="Assume DEC orthogonal to RA" checked={settings.assumeDecOrthogonalToRa} disabled={running || pending} onChange={(assumeDecOrthogonalToRa) => update({ assumeDecOrthogonalToRa })} />
				<div className="flex flex-col gap-2">
					<NumberInput label="Calibration Step" value={settings.calibrationPulse} min={GUIDING_MINIMUM_PULSE} max={GUIDING_MAXIMUM_PULSE} step={50} suffix="ms" disabled={running || pending} onChange={(calibrationPulse) => update({ calibrationPulse })} className="flex-1" />
					<Button
						variant="secondary"
						disabled={running || pending || calibrationPulse === undefined}
						title={running ? 'Stop the session to change the step' : (calculateBlocker ?? (calibrationPulse === undefined ? undefined : `${calibrationPulse} ms`))}
						onClick={() => calibrationPulse !== undefined && update({ calibrationPulse })}
					>
						Calculate
					</Button>
				</div>
				{!running && calculateBlocker && <Notice warning={calibrationWarning !== undefined}>{calibrationWarning ?? calculateBlocker}</Notice>}
				<Notice>Calculate sizes the step to move the star about 25 px in 12 RA steps at the declination the mount points at.</Notice>
				<Checkbox label="Reverse DEC output after a meridian flip" checked={settings.reverseDecOutputAfterMeridianFlip} disabled={running || pending} onChange={(reverseDecOutputAfterMeridianFlip) => update({ reverseDecOutputAfterMeridianFlip })} />
				<Notice>Applies when a calibration is flipped for the other side of the pier; leave it off for a mount that reverses it itself.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.guiding.corrections" title="Corrections" summary={`RA ${formatFixed(settings.aggressivenessRA, 2)} · DEC ${formatFixed(settings.aggressivenessDEC, 2)}`} defaultOpen={false}>
				<NumberInput label="RA Aggressiveness" value={settings.aggressivenessRA} min={0} max={1} step={0.05} disabled={running || pending} onChange={(aggressivenessRA) => update({ aggressivenessRA })} />
				<NumberInput label="DEC Aggressiveness" value={settings.aggressivenessDEC} min={0} max={1} step={0.05} disabled={running || pending} onChange={(aggressivenessDEC) => update({ aggressivenessDEC })} />
				<NumberInput label="RA Max Pulse" value={settings.maximumPulseRA} min={GUIDING_MINIMUM_PULSE} max={GUIDING_MAXIMUM_PULSE} step={100} suffix="ms" disabled={running || pending} onChange={(maximumPulseRA) => update({ maximumPulseRA })} />
				<NumberInput label="DEC Max Pulse" value={settings.maximumPulseDEC} min={GUIDING_MINIMUM_PULSE} max={GUIDING_MAXIMUM_PULSE} step={100} suffix="ms" disabled={running || pending} onChange={(maximumPulseDEC) => update({ maximumPulseDEC })} />
				<SegmentedControl
					label="DEC Backlash Compensation"
					options={['off', 'adaptive'] as const}
					value={settings.decBacklash.enabled ? 'adaptive' : 'off'}
					format={(mode) => (mode === 'off' ? 'Off' : 'Adaptive')}
					disabled={running || pending}
					onChange={(mode) => update({ decBacklash: { ...settings.decBacklash, enabled: mode === 'adaptive' } })}
				/>
				{settings.decBacklash.enabled && (
					<>
						<NumberInput label="Initial Backlash" value={settings.decBacklash.initialMs} min={0} max={settings.decBacklash.maximumMs} step={50} suffix="ms" disabled={running || pending} onChange={(initialMs) => update({ decBacklash: { ...settings.decBacklash, initialMs } })} />
						<NumberInput
							label="Largest Compensation"
							value={settings.decBacklash.maximumMs}
							min={0}
							max={GUIDING_MAXIMUM_PULSE}
							step={50}
							suffix="ms"
							disabled={running || pending}
							onChange={(maximumMs) => update({ decBacklash: { ...settings.decBacklash, maximumMs, initialMs: Math.min(settings.decBacklash.initialMs, maximumMs) } })}
						/>
						<NumberInput label="Adaptation Rate" value={settings.decBacklash.adaptationRate} min={0} max={1} step={0.05} disabled={running || pending} onChange={(adaptationRate) => update({ decBacklash: { ...settings.decBacklash, adaptationRate } })} />
						{session?.calibration && session.calibration.backlash > 0 && !running && (
							<Button variant="secondary" className="self-start" disabled={pending} onClick={() => update({ decBacklash: { ...settings.decBacklash, initialMs: Math.min(Math.round(session.calibration!.backlash), settings.decBacklash.maximumMs) } })}>
								{`Start from the calibration's ${formatPulse(session.calibration.backlash)}`}
							</Button>
						)}
						{session?.decBacklashEstimate !== undefined && <DataRow label="Estimate">{formatPulse(session.decBacklashEstimate)}</DataRow>}
					</>
				)}
				<Notice>Lengthens the first DEC pulse after a reversal by the estimated backlash and learns it from the error that follows, up to the largest compensation; separate from the controller's reversal suppression. The calibration's estimate is one measurement, a starting point only.</Notice>
				<Checkbox label="Stop guiding when the mount slews" checked={settings.stopGuidingOnSlew} disabled={running || pending} onChange={(stopGuidingOnSlew) => update({ stopGuidingOnSlew })} />
			</CollapsibleSection>
			<CollapsibleSection id="images.guiding.settle-and-dither" title="Settle and Dither" summary={`${formatFixed(settings.settle.pixels, 1)} px · ${settings.settle.time} s`} defaultOpen={false}>
				<NumberInput label="Settle Within" value={settings.settle.pixels} min={0.1} max={50} step={0.1} suffix="px" disabled={pending} onChange={(pixels) => update({ settle: { ...settings.settle, pixels } })} />
				<NumberInput label="Settle For" value={settings.settle.time} min={0} max={600} step={1} suffix="s" disabled={pending} onChange={(time) => update({ settle: { ...settings.settle, time } })} />
				<NumberInput label="Settle Timeout" value={settings.settle.timeout} min={1} max={3600} step={5} suffix="s" disabled={pending} onChange={(timeout) => update({ settle: { ...settings.settle, timeout } })} />
				<NumberInput label="Dither" value={settings.ditherPixels} min={0.1} max={100} step={0.5} suffix="px" disabled={pending} onChange={(ditherPixels) => update({ ditherPixels })} />
				<Select label="Dither Pattern" options={DITHER_MODES} value={settings.ditherMode} format={(mode) => DITHER_MODE_LABELS[mode]} disabled={running || pending} onChange={(ditherMode) => update({ ditherMode })} />
				<Checkbox label="Dither in RA only" checked={settings.ditherRaOnly} disabled={pending} onChange={(ditherRaOnly) => update({ ditherRaOnly })} />
				<Checkbox label="Fast recenter after calibration or dither" checked={settings.fastRecenter} disabled={running || pending} onChange={(fastRecenter) => update({ fastRecenter })} />
			</CollapsibleSection>
			<CollapsibleSection id="images.guiding.equipment" title="Equipment" summary={`${guideOutput ? (guideOutput.device?.name ?? 'No guide output') : 'Guide Camera only'} · ${focalLength !== undefined ? formatMillimeters(focalLength) : 'no focal length'}`} defaultOpen={false}>
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Guide Output">{guideOutput ? <DeviceLink device={guideOutput.device} fallback="Not assigned" /> : 'Guide Camera only'}</DataRow>
					<DataRow label="Guide Focal Length">{focalLength !== undefined ? formatMillimeters(focalLength) : 'Not set'}</DataRow>
					{pixelScale !== undefined && <DataRow label="Pixel Scale">{formatPixelScale(arcsec(pixelScale))}</DataRow>}
				</DataList>
				{!running && outputAvailability && outputAvailability.status !== 'ready' && outputAvailability.status !== 'busy' && <Notice>{outputAvailability.message}</Notice>}
				{!running && focalLength === undefined && <Notice>Enter the Guide Telescope in Equipment Setup for the pixel scale of the RMS in arcseconds and the calibration step.</Notice>}
			</CollapsibleSection>
			<GuidingCalibrationReview source={review} pixelScale={session?.pixelScale} onClose={() => setReview(undefined)} />
		</>
	)
}

// Returns the guider state of a session in words: its state while it lives, with the guide output it still holds when
// guiding did not start; Lost or Stopped once it ended.
function sessionStateText(session: GuidingSessionSummary): string {
	if (!session.active) return session.lost ? 'Lost' : 'Stopped'
	return outputHeldIdle(session) ? `${GUIDING_STATE_LABELS[session.state]}, guide output held` : GUIDING_STATE_LABELS[session.state]
}

// Returns whether a session's run holds the guide output (and the mount) although the guider is not guiding: a start
// whose calibration or settle failed leaves the guider looping or on its star with the run still open.
function outputHeldIdle(session: GuidingSessionSummary): boolean {
	return session.guideOutputHeld && (session.state === 'looping' || session.state === 'selected')
}

// Returns a length of the guide frame in arcseconds when the pixel scale (arcsec/px) is known, else in pixels.
function formatGuideLength(pixels: number, pixelScale: number | undefined): string {
	return pixelScale === undefined ? `${formatFixed(pixels, 2)} px` : `${formatFixed(pixels * pixelScale, 2)}″`
}

// Returns the one-line summary of the Session section while collapsed: the state, and the RMS total once guided.
function sessionSummaryText(session: GuidingSessionSummary, pixelScale: number | undefined): string {
	const { rms } = session
	return rms && rms.samples > 0 ? `${sessionStateText(session)} · RMS ${formatGuideLength(rms.total, pixelScale)}` : sessionStateText(session)
}

// Returns whether a saved calibration fits the session, as it is or adapted to the mount.
function usableCandidate(candidate: GuidingCalibrationCandidate): boolean {
	return candidate.status === 'direct' || candidate.status === 'transformed'
}

// Saved calibrations of the equipment of a running session and how each fits it, as the server last told; absent while
// the first read runs or no session runs.
interface CalibrationCandidates {
	readonly candidates?: readonly GuidingCalibrationCandidate[]
	// Why the latest read or action failed.
	readonly error?: string
	// Runs an action on a saved calibration, then reads the list again.
	readonly act: (action: Promise<unknown>) => void
}

// Reads the saved calibrations of the equipment of a running session (absent while none runs): once the first frame
// tells the equipment apart, and again whenever the calibration in use, its generation, whether the run holds the guide
// output, or an action changes them.
function useCalibrationCandidates(session: GuidingSessionSummary | undefined): CalibrationCandidates {
	const [candidates, setCandidates] = useState<readonly GuidingCalibrationCandidate[]>()
	const [error, setError] = useState<string>()
	const [generation, setGeneration] = useState(0)
	const sessionId = session?.sessionId

	useEffect(() => {
		if (!sessionId) {
			setCandidates(undefined)
			return
		}

		let current = true
		loadGuidingCalibrationCandidates(sessionId).then(
			(loaded) => {
				if (!current) return
				setCandidates(loaded.candidates)
				setError(undefined)
			},
			(reason: unknown) => current && setError(reason instanceof Error ? reason.message : String(reason)),
		)

		return () => {
			current = false
		}
	}, [sessionId, session?.frame !== undefined, session?.calibration?.calibrationId, session?.calibration?.generation, session?.guideOutputHeld, generation])

	function act(action: Promise<unknown>) {
		void action.then(
			() => setGeneration((value) => value + 1),
			(reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
		)
	}

	return { candidates, error, act }
}

// Labels of the states of the master dark of a session.
const DARK_STATE_LABELS: Readonly<Record<NonNullable<GuidingSessionSummary['darkCalibration']>['state'], string>> = {
	pending: 'Waiting for a frame',
	noCompatibleDark: 'No matching dark',
	selected: 'Chosen',
	applied: 'Subtracted',
	failed: 'Not subtracted',
}

interface DarkSectionProps {
	// Guide camera, whose camera of the Equipment Catalog the darks come from.
	readonly device: BindableDevice | undefined
	// Running session, whose dark is shown and changed; absent while none runs.
	readonly session?: GuidingSessionSummary
	// Whether the form subtracts a dark.
	readonly enabled: boolean
	readonly disabled: boolean
	// Changes whether the form subtracts a dark.
	readonly onEnabled: (enabled: boolean) => void
}

// Master dark of the guide frames: whether the form subtracts one, and for a running session, which one, how it went,
// and the masters matching its frames, of which one can be pinned; collapsed, it summarizes whether and how it subtracts.
function DarkSection({ device, session, enabled, disabled, onEnabled }: DarkSectionProps) {
	const [candidates, setCandidates] = useState<GuidingDarkCandidates['candidates']>([])
	const dark = session?.darkCalibration
	const sessionId = session?.sessionId

	useEffect(() => {
		if (!sessionId) return setCandidates([])
		let current = true
		loadGuidingDarkCandidates(sessionId).then(
			(loaded) => current && setCandidates(loaded.candidates),
			() => current && setCandidates([]),
		)

		return () => {
			current = false
		}
	}, [sessionId, session?.exposure, dark?.state])

	// Changes the form, and the dark of the running session.
	function change(next: boolean) {
		onEnabled(next)
		if (session) void setGuidingDark(guidingRuntime, session, { enabled: next })
	}

	const options = ['auto', ...candidates.map(({ masterId }) => String(masterId))]
	const value = dark?.pinned && dark.masterId !== undefined ? String(dark.masterId) : 'auto'

	return (
		<CollapsibleSection id="images.guiding.dark" title="Dark" summary={!enabled ? 'Off' : dark ? DARK_STATE_LABELS[dark.state] : 'Calibration Library'} defaultOpen={false}>
			<Checkbox label="Subtract a Calibration Library dark" checked={enabled} disabled={disabled} onChange={change} />
			{enabled && <CatalogCameraNotice device={device} lead="Darks come from" purpose="to use the Calibration Library" />}
			{session && dark && (
				<>
					<DataList>
						<DataRow label="Dark" tone={dark.state === 'applied' ? 'success' : dark.state === 'failed' ? 'danger' : 'default'}>
							{`${DARK_STATE_LABELS[dark.state]}${dark.masterId !== undefined ? ` · master ${dark.masterId}` : ''}${dark.pinned ? ' (pinned)' : ''}`}
						</DataRow>
					</DataList>
					<Select
						label="Master"
						options={options.includes(value) ? options : [...options, value]}
						value={value}
						format={(option) => {
							if (option === 'auto') return 'Best match'
							const candidate = candidates.find(({ masterId }) => String(masterId) === option)
							return candidate ? `${option} · ${candidate.frames} frames${candidate.temperature !== undefined ? ` · ${formatTemperature(candidate.temperature)}` : ''}` : option
						}}
						disabled={disabled}
						onChange={(option) => void setGuidingDark(guidingRuntime, session, option === 'auto' ? { enabled: true } : { enabled: true, masterId: Number(option) })}
					/>
					{dark.reason && <Notice error={dark.state === 'failed'}>{dark.reason}</Notice>}
				</>
			)}
			<Notice>A master of the Calibration Library is matched to the frames by size, binning, gain, offset, temperature and the exact exposure time; without a match the frames are guided without one. The preview shows the frames as taken.</Notice>
		</CollapsibleSection>
	)
}

interface SavedCalibrationsProps {
	// Living session whose equipment the calibrations are of.
	readonly session: GuidingSessionSummary
	// Saved calibrations of its equipment, as the panel reads them.
	readonly saved: CalibrationCandidates
	// Opens the review of a saved calibration.
	readonly onReview: (calibrationId: string) => void
}

// Saved calibrations of the equipment of a session, newest usable first, each with how it fits the session now.
function SavedCalibrations({ session, saved: { candidates, error, act }, onReview }: SavedCalibrationsProps) {
	const timeZone = useActiveTimeZone()
	const guiding = session.guideOutputHeld
	const usable = candidates?.filter(usableCandidate).length

	return (
		<CollapsibleSection id="images.guiding.saved-calibrations" title="Saved Calibrations" summary={candidates && (candidates.length === 0 ? 'None' : `${usable} of ${candidates.length} fit`)} defaultOpen={false}>
			{candidates?.length === 0 && <Notice>No calibration of this equipment is saved yet{session.frame ? '' : ', or no frame was taken yet to compare it with'}.</Notice>}
			{candidates?.map((candidate) => {
				const fits = usableCandidate(candidate)
				const inUse = session.calibration?.storedId === candidate.calibrationId

				return (
					<div key={candidate.calibrationId} className="flex flex-col gap-1 border-b border-line-100 pb-2 last:border-b-0">
						<span className="text-sm text-ink-100 tabular-nums">{`${formatZonedDateTime(candidate.createdAt, timeZone, false)}${candidate.quality ? ` · ${CALIBRATION_QUALITY_LABELS[candidate.quality]}` : ''}${inUse ? ' · in use' : ''}`}</span>
						<span className={fits ? 'text-xs text-success' : 'text-xs text-ink-300'}>
							{CALIBRATION_CANDIDATE_LABELS[candidate.status]}
							{!fits && candidate.reasons.length > 0 && `: ${candidate.reasons.map((reason) => CALIBRATION_REJECTION_LABELS[reason]).join(', ')}`}
						</span>
						<div className="flex flex-wrap gap-2">
							{candidate.status !== 'invalid' && (
								<Button variant="secondary" onClick={() => onReview(candidate.calibrationId)}>
									Review
								</Button>
							)}
							{fits && !inUse && (
								<Button variant="secondary" disabled={guiding} title={guiding ? 'Stop guiding to restore another calibration' : undefined} onClick={() => act(restoreGuidingCalibration(guidingRuntime, session, candidate.calibrationId))}>
									Restore
								</Button>
							)}
							{candidate.status !== 'invalid' && (
								<Button variant="secondary" onClick={() => act(setSavedCalibrationDisabled(candidate.calibrationId, candidate.status !== 'disabled'))}>
									{candidate.status === 'disabled' ? 'Enable' : 'Disable'}
								</Button>
							)}
						</div>
					</div>
				)
			})}
			{error && <Notice error>{error}</Notice>}
		</CollapsibleSection>
	)
}

interface SessionControlsProps {
	// Running session.
	readonly session: GuidingSessionSummary
	// Guiding form, for the settle and dither of the commands.
	readonly settings: Readonly<GuidingSettings>
	// Whether a command of this tab waits for the server.
	readonly pending: boolean
	// Whether a saved calibration fits the session; undefined while unknown.
	readonly restorable?: boolean
	// Why a calibration started now would fail; undefined when nothing says it would.
	readonly calibrationWarning?: string
}

// Commands of a running session, those of its state only; a durable command still running disables the others. The
// start command is named by what it will do: it calibrates when the form asks for it on every start, or when the
// session has no calibration and none of the saved ones will be restored.
function SessionControls({ session, settings, pending, restorable, calibrationWarning }: SessionControlsProps) {
	const busy = pending || session.command?.state === 'running'
	const held = outputHeldIdle(session)
	const guiding = session.guideOutputHeld && !held
	const paused = session.state === 'paused'
	const calibrates = settings.recalibrateOnEveryStart || (!session.calibrated && !(settings.autoRestoreCalibration && restorable !== false))

	return (
		<>
			{!session.guideOutputHeld && (
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
						<ConfirmButton
							disabled={busy}
							title="Clear the calibration?"
							message="The session forgets the calibration it uses, so the next Start Guiding restores a saved one or calibrates again. The saved calibrations are kept."
							confirmLabel="Clear Calibration"
							onConfirm={() => void clearGuidingCalibration(guidingRuntime, session)}
						>
							Clear Calibration
						</ConfirmButton>
					)}
				</div>
			)}
			{!session.guideOutputHeld && calibrates && calibrationWarning && <Notice warning>{calibrationWarning}</Notice>}
			{held && (
				<>
					<Button className="self-start" disabled={pending} title="Release the guide output and the mount, and keep looping" onClick={() => void stopGuiding(guidingRuntime, session)}>
						Stop Guiding
					</Button>
					<Notice warning>Guiding did not start, but the guide output and the mount are still held: Stop Guiding releases them.</Notice>
				</>
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
								<Button
									variant="secondary"
									disabled={busy || session.state !== 'guiding'}
									title={busy ? undefined : session.state === 'lostLock' ? 'Available once the star is found again' : session.state !== 'guiding' ? 'Available while guiding' : undefined}
									onClick={() => void ditherGuiding(guidingRuntime, session, guidingDitherRequest(settings))}
								>
									Dither
								</Button>
							</>
						)
					)}
				</div>
			)}
			<Button variant="secondary" className="self-start" disabled={pending} title="Stop the guide exposures and end the session" onClick={() => void stopGuidingSession(guidingRuntime, session)}>
				Stop Looping
			</Button>
			{!session.guideOutputHeld && <Notice>{session.lockPosition ? 'Click another star on the current frame to move the lock to it.' : 'Click a star on the current frame to select it.'}</Notice>}
		</>
	)
}

interface SessionStatusProps {
	readonly session: GuidingSessionSummary
	// Pixel scale of the guide frames, in arcseconds per pixel; absent while unknown.
	readonly pixelScale?: number
}

// Status of a session above its commands: the guider state in words, the progress of the guide exposure, the RMS total
// as the panel's Readout once it guided, the legs of a running calibration, or, while the session lives, the failure of
// the last one with what to do about it, and why the session stopped guiding or ended.
function SessionStatus({ session, pixelScale }: SessionStatusProps) {
	const { rms, calibrationFailure } = session
	const calibrating = session.state === 'calibrating'

	return (
		<>
			<SessionStateText failed={session.state === 'lostLock' || session.lost || session.failure !== undefined} succeeded={session.state === 'guiding'}>
				{sessionStateText(session)}
			</SessionStateText>
			{session.active && <FrameProgress exposure={session.exposureProgress} />}
			{rms && rms.samples > 0 && !calibrating && <GuidingReadout value={formatGuideLength(rms.total, pixelScale)} caption={`RMS total of the last ${rms.samples === 1 ? 'step' : `${rms.samples} steps`} · RA ${formatGuideLength(rms.ra, pixelScale)} · DEC ${formatGuideLength(rms.dec, pixelScale)}`} />}
			{calibrating && session.calibrating && (
				<>
					<DataList>
						<DataRow label="Step">{GUIDING_CALIBRATION_PHASE_LABELS[session.calibrating.phase]}</DataRow>
					</DataList>
					<CalibrationProgress progress={session.calibrating} />
				</>
			)}
			{session.active && !calibrating && calibrationFailure && <CalibrationFailure failure={calibrationFailure} />}
			{session.interruption && <Notice error>The mount slewed while guiding, commanded outside Nebulosa, so guiding stopped and the star was cleared. Select a star and start guiding again.</Notice>}
			{session.failure && <Notice error>{session.failure.error ? guidingCommandErrorText(session.failure.error) : `The session ended: ${session.failure.reason}.`}</Notice>}
		</>
	)
}

// The one live reading of the panel, read from across the room: the RMS total over what it is.
function GuidingReadout({ value, caption }: { readonly value: string; readonly caption: string }) {
	return (
		<div className="flex flex-col gap-0.5">
			<p className="m-0 text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{value}</p>
			<p className="m-0 text-xs leading-4 text-ink-300 tabular-nums">{caption}</p>
		</div>
	)
}

// The last calibration that failed: what went wrong, where, the legs as it left them, and what to do about it. The
// progress of its last step reports the failed phase, so the legs are drawn at the phase it failed in.
function CalibrationFailure({ failure }: { readonly failure: GuidingCalibrationFailureSummary }) {
	const { problem, remedy } = GUIDING_CALIBRATION_FAILURES[failure.code]
	const label = failure.phase === 'idle' || failure.phase === 'completed' || failure.phase === 'failed' ? undefined : GUIDING_CALIBRATION_PHASE_LABELS[failure.phase]
	// The phase label in the middle of a sentence: its first letter lowercased, the axis names kept.
	const phase = label && label[0].toLowerCase() + label.slice(1)

	return (
		<>
			<Notice error>{`Calibration failed${phase ? ` while ${phase}` : ''}: ${problem}`}</Notice>
			{failure.progress && <CalibrationProgress progress={{ ...failure.progress, phase: failure.phase }} failed />}
			<Notice>{remedy}</Notice>
		</>
	)
}

interface SessionDetailsProps {
	readonly session: GuidingSessionSummary
	// Pixel scale of the guide frames, in arcseconds per pixel; absent while unknown.
	readonly pixelScale?: number
	// Opens the review of the calibration the session uses.
	readonly onReview: () => void
}

// Details of a session under its commands: the settling, the lock, the calibration in use with its review, and the
// outcome of the latest command; a failed start whose calibration failed is told by the failure above, not again here.
function SessionDetails({ session, pixelScale, onReview }: SessionDetailsProps) {
	const { calibration, command } = session
	const failureShown = command?.state === 'failed' && command.command === 'startGuiding' && session.calibrationFailure !== undefined

	return (
		<>
			<DataList>
				{session.settling && session.state !== 'calibrating' && <DataRow label="Settling">{session.dithering ? 'After a dither' : 'Yes'}</DataRow>}
				{session.lockPosition && <DataRow label="Lock">{formatPixelPosition(session.lockPosition[0], session.lockPosition[1])}</DataRow>}
				{calibration && (
					<>
						<DataRow label="Calibration" tone={calibration.assessment.quality === 'poor' ? 'danger' : 'default'}>
							{`${calibration.origin === 'restored' ? 'Restored' : 'Solved'} · ${CALIBRATION_QUALITY_LABELS[calibration.assessment.quality]}`}
						</DataRow>
						<DataRow label="Calibrated At">{formatCalibrationPlace(calibration.source)}</DataRow>
						{calibration.transformations.length > 0 && <DataRow label="Adapted">{formatCalibrationAdaptation(calibration)}</DataRow>}
						<DataRow label="RA Rate">{`${formatCalibrationRate(calibration.raRate, pixelScale)} at ${formatDegrees(calibration.raAngle, 1)}`}</DataRow>
						<DataRow label="DEC Rate">{`${formatCalibrationRate(calibration.decRate, pixelScale)} at ${formatDegrees(calibration.decAngle, 1)}`}</DataRow>
						{calibration.backlash > 0 && <DataRow label="DEC Backlash">{formatPulse(calibration.backlash)}</DataRow>}
					</>
				)}
				{command && (
					<DataRow label={COMMAND_LABELS[command.command]} tone={command.state === 'failed' ? 'danger' : command.state === 'succeeded' ? 'success' : 'default'}>
						{command.state === 'running' ? 'Running' : command.state === 'succeeded' ? 'Done' : 'Failed'}
					</DataRow>
				)}
			</DataList>
			{command?.state === 'failed' && command.error && !failureShown && <Notice error>{guidingCommandErrorText(command.error)}</Notice>}
			{calibration && calibration.warnings.length > 0 && <Notice>{guidingCalibrationWarningsText(calibration.warnings)}</Notice>}
			{calibration && (
				<Button variant="secondary" className="self-start" onClick={onReview}>
					Review Calibration
				</Button>
			)}
			{calibration && !calibration.saved && <Notice error>{`The calibration was not saved for later sessions${calibration.saveError ? `: ${calibration.saveError}` : '.'}`}</Notice>}
		</>
	)
}
