import type { DeviceSummary, IPolarSession, IPolarSessionSummary } from 'api'
import { toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { RoleDevice } from '../equipment/useEquipment'
import { formatArcmin, formatArcsec, formatClockTime, formatDegrees, formatGeographic, formatSignedArcmin, MISSING } from '../format'
import { useActiveSite, useDisplayZone } from '../location/useLocation'
import { operationsState } from '../operations'
import { CameraPlateSolvingSection } from '../platesolving/CameraPlateSolvingSection'
import { useSolverConfigured } from '../platesolving/PlateSolveControls'
import { activeProfile, cameraPlateSolving, exposureSettings, ipolarSettings, profileState, setIPolarSettings } from '../profile/profile'
import { type CameraIdentity, IPOLAR_MAXIMUM_ROTATION, IPOLAR_MINIMUM_ROTATION, type IPolarSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
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
// oxfmt-ignore
import { confirmIPolarRotation, finishIPolar, IPOLAR_DIRECTION_LABELS, IPOLAR_DIRECTIONS, IPOLAR_MODE_LABELS, IPOLAR_MODES, IPOLAR_REJECTION_LABELS, IPOLAR_STATE_LABELS, ipolarBlocker, ipolarMountSupport, ipolarRequest, ipolarRunning, ipolarRuntime, ipolarSlewRate, startIPolar, startIPolarRefinement, stopIPolar, stopIPolarRefinement } from './ipolar'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of iPolar, a camera operation of the Images camera tabs: the equipment and the mode (the
// operator turns the RA axis by hand, or the setup's mount turns it), the frame exposure, the rotation, the site, the
// plate solving settings it applies, the calibration, the polar error and its convergence, and the commands (Start,
// Rotation Done, Refine, Pause, Finish, Stop). Frames are taken with the exposure time of this form and the camera's
// camera settings, edited only in Camera Acquisition, and solved with the camera's plate solving settings; the site is
// the profile's active observing site, shown read-only. The camera is the panel's target and the mount the MOUNT of the
// active equipment setup, required only for the automatic rotation. The forms are the camera's, kept in the profile, and
// stay locked showing the values applied while a session runs; before an automatic rotation, a notice beside Start asks
// the operator to check the mount is clear to turn. The session is the server's, shown here whichever tab started it, and keeps
// running when the panel unmounts. Errors are the signed on-sky components the server measured; no knob direction is
// inferred.

// Camera an iPolar panel aligns with and the forms it edits.
export interface IPolarTarget {
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

// iPolar panel sections of a camera.
export function IPolarSections({ device, availability, mount, settings: identity }: IPolarTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(ipolarRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const site = useActiveSite()
	const profile = activeProfile(profiles)
	const settings = ipolarSettings(profile.settings, identity)
	const exposure = exposureSettings(profile.settings, identity)
	const solving = cameraPlateSolving(profile.settings, identity)
	const configured = useSolverConfigured(solving.provider)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const details = session ? runtime.details[session.sessionId] : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const running = ipolarRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const locked = running || pending
	// While running, the form shows the values the session applied.
	const shown: Readonly<IPolarSettings> = running && session ? appliedSettings(session) : settings
	const automatic = shown.mode === 'automatic'
	const slewRate = running && session ? session.request.slewRate : ipolarSlewRate(settings, mountState)
	const mountAvailability = roleAvailability('MOUNT', mount, operations, automatic ? ipolarMountSupport(mountState) : undefined)
	const blocker = running ? undefined : ipolarBlocker({ camera: availability, mount: mountAvailability, mode: settings.mode, mountState, slewRate, site, solverConfigured: configured })
	const slewRates = mountState?.slewRates ?? []

	// Updates fields of the camera's iPolar form.
	function update(patch: Partial<IPolarSettings>) {
		setIPolarSettings(profileState, identity, patch)
	}

	function start() {
		if (!device || !site) return
		// A manual session uses the setup's mount only when it is ready; without one, nothing is held but the camera.
		const used = mount.device && mountAvailability.status === 'ready' ? { connectionId: mount.device.connectionId, deviceId: mount.device.id } : undefined
		void startIPolar(ipolarRuntime, device.connectionId, device.id, ipolarRequest(settings, exposure, solving, site, used, slewRate, capabilities))
	}

	return (
		<>
			<CollapsibleSection id="images.ipolar.equipment" title="Equipment">
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</DataRow>
				</DataList>
				<SegmentedControl label="RA Rotation" options={IPOLAR_MODES} value={shown.mode} format={(mode) => IPOLAR_MODE_LABELS[mode]} disabled={locked} onChange={(mode) => update({ mode })} />
				<Notice>The camera must be fixed to the part of the mount that turns in RA. Do not move DEC, the camera, or the optics once the session starts: that needs a new calibration.</Notice>
				{!running && automatic && mountAvailability.status !== 'ready' && <Notice>{mountAvailability.message}</Notice>}
				{!running && automatic && (mountAvailability.status === 'notSelected' || mountAvailability.status === 'unsupported') && <EquipmentSetupButton />}
				{!automatic && mountAvailability.status !== 'ready' && <Notice>Without a mount, its declination and pier side cannot be watched: the software cannot prove the motion was RA only.</Notice>}
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.ipolar.acquisition"
				device={device}
				exposure={running && session ? session.request.capture : exposure}
				capabilities={capabilities}
				description="Frames are LIGHT, taken with the exposure time above and the camera settings of Camera Acquisition, and shown as the latest frame of the camera; they are kept in memory only. Keep the binning and the subframe unchanged during a session."
			>
				<ExposureTimeInput value={shown.exposureTime} exposure={capabilities?.exposure} disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
			</CameraAcquisitionSection>
			<CollapsibleSection id="images.ipolar.rotation" title="Rotation">
				{automatic ? (
					<>
						<SegmentedControl label="RA Direction" options={IPOLAR_DIRECTIONS} value={shown.direction} format={(direction) => IPOLAR_DIRECTION_LABELS[direction]} disabled={locked} onChange={(direction) => update({ direction })} />
						{slewRates.length > 0 ? (
							<Select label="Slew Rate" options={slewRates.map((rate) => rate.name)} value={slewRate ?? slewRates[0].name} format={(name) => slewRates.find((rate) => rate.name === name)?.label.trim() || name} disabled={locked} onChange={(name) => update({ slewRate: name })} />
						) : (
							<Notice>Slew Rate: {running ? shown.slewRate : 'the mount reports no preset yet.'}</Notice>
						)}
						<NumberInput label="RA Rotation" value={shown.rotation} min={IPOLAR_MINIMUM_ROTATION} max={IPOLAR_MAXIMUM_ROTATION} step={1} suffix="°" disabled={locked} onChange={(rotation) => update({ rotation })} />
						<NumberInput label="Settle Time" value={shown.settleDelay} min={0} max={120} step={0.5} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
						<Notice>
							The mount turns in RA only, towards the {IPOLAR_DIRECTION_LABELS[shown.direction].toLowerCase()}, about {shown.rotation.toFixed(1)}° in bounded steps. Rotation is measured by plate solving, never assumed from the motion time.
						</Notice>
					</>
				) : (
					<>
						<NumberInput label="Settle Time" value={shown.settleDelay} min={0} max={120} step={0.5} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
						<Notice>
							After the first frame, turn the RA axis by hand {IPOLAR_MINIMUM_ROTATION}° to {IPOLAR_MAXIMUM_ROTATION}° (20° to 40° is best), then press Rotation Done. Nothing is moved by the software.
						</Notice>
					</>
				)}
			</CollapsibleSection>
			<CollapsibleSection id="images.ipolar.site" title="Site">
				<DataList>
					<DataRow label="Observing Site">{site?.name ?? MISSING}</DataRow>
					<DataRow label="Coordinates">{site ? formatGeographic(site.latitude, site.longitude) : MISSING}</DataRow>
					<DataRow label="Pole">{site ? (site.latitude >= 0 ? 'North celestial pole' : 'South celestial pole') : MISSING}</DataRow>
				</DataList>
				<Checkbox label="Correct for atmospheric refraction" checked={shown.refraction} disabled={locked} onChange={(refraction) => update({ refraction })} />
				{!site && <Notice>The profile has no active observing site; choose one in the status bar.</Notice>}
			</CollapsibleSection>
			<CameraPlateSolvingSection
				id="images.ipolar.plate-solver"
				device={device}
				solving={running && session ? session.request.solving : solving}
				description={(solver, assisted) => (
					<>
						Each frame is solved with the Plate Solving settings ({solver} solver, {assisted ? 'searched around the mount position snooped into its header during an automatic rotation, else over the whole sky' : 'searched over the whole sky'}); the rotation and the polar error are measured from the
						solutions.
					</>
				)}
			/>
			<CollapsibleSection id="images.ipolar.refinement" title="Refinement">
				<NumberInput label="Refinement Interval" value={shown.refinementDelay} min={0} max={600} step={0.5} suffix="s" disabled={locked} onChange={(refinementDelay) => update({ refinementDelay })} />
				<NumberInput label="Target Error" value={shown.completionThreshold} min={1} max={3600} step={5} suffix="″" disabled={locked} onChange={(completionThreshold) => update({ completionThreshold })} />
			</CollapsibleSection>
			{session && <Calibration session={session} details={details} />}
			{session?.measurement && <PolarError session={session} timeZone={site?.timeZone} />}
			<CollapsibleSection id="images.ipolar.controls" title="Controls">
				{session && <SessionState session={session} />}
				{running ? (
					<>
						{session!.state === 'waitingForRotation' && (
							<Button disabled={pending} onClick={() => void confirmIPolarRotation(ipolarRuntime, session!)}>
								Rotation Done
							</Button>
						)}
						{(session!.state === 'readyToRefine' || session!.state === 'refinementPaused') && (
							<Button disabled={pending} onClick={() => void startIPolarRefinement(ipolarRuntime, session!)}>
								{session!.state === 'readyToRefine' ? 'Start Refinement' : 'Resume Refinement'}
							</Button>
						)}
						{session!.state === 'refining' && (
							<Button variant="secondary" disabled={pending} onClick={() => void stopIPolarRefinement(ipolarRuntime, session!)}>
								Pause Refinement
							</Button>
						)}
						{session!.calibration && session!.state !== 'stopping' && (
							<Button variant="secondary" disabled={pending} onClick={() => void finishIPolar(ipolarRuntime, session!)}>
								Finish
							</Button>
						)}
						<Button variant="secondary" disabled={pending || session!.state === 'stopping'} onClick={() => void stopIPolar(ipolarRuntime, session!)}>
							{session!.state === 'stopping' ? 'Stopping…' : 'Stop'}
						</Button>
					</>
				) : (
					<Button disabled={blocker !== undefined || pending} onClick={start}>
						Start Polar Alignment
					</Button>
				)}
				{!running && automatic && <Notice>Pressing Start turns the mount in RA by itself: make sure counterweights, cables, the pier, and the roof leave it clear.</Notice>}
				{blocker && <Notice>{blocker}</Notice>}
				{session?.state === 'waitingForRotation' && <Notice>Turn the RA axis by hand now, keeping DEC still, then press Rotation Done.</Notice>}
				{session?.state === 'refining' && <Notice>Adjust the altitude and azimuth of the mount base to bring the pole marker onto the axis marker; the mount is not moved.</Notice>}
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
		</>
	)
}

// The form values a running session applied, as the form shows them (degrees and arcseconds).
function appliedSettings({ request }: IPolarSessionSummary): IPolarSettings {
	return {
		exposureTime: request.capture.exposureTime,
		mode: request.mode,
		direction: request.direction,
		slewRate: request.slewRate,
		rotation: toDeg(request.rotation),
		settleDelay: request.settleDelay,
		refinementDelay: request.refinementDelay,
		completionThreshold: toArcsec(request.completionThreshold),
		refraction: request.refraction,
	}
}

interface CalibrationProps {
	// Session shown.
	readonly session: IPolarSessionSummary
	// Its complete record, once fetched.
	readonly details?: IPolarSession
}

// The calibration: frames and candidates, the rotation fitted, its quality, and the last rejected candidate.
function Calibration({ session, details }: CalibrationProps) {
	const { calibration } = session
	const rejected = details?.attempts.at(-1)

	return (
		<CollapsibleSection id="images.ipolar.calibration" title="Calibration">
			<DataList>
				<DataRow label="Frames">{session.frameCount}</DataRow>
				<DataRow label="Second-Pose Candidates">{session.attemptCount}</DataRow>
				<DataRow label="RA Rotation">{calibration ? `${formatDegrees(calibration.rotation, 1)}${calibration.preferred ? '' : ' (outside 20°–40°)'}` : MISSING}</DataRow>
				<DataRow label="Fit Residual">{calibration ? formatArcsec(calibration.residual) : MISSING}</DataRow>
				<DataRow label="Axis from Pole">{calibration ? formatArcmin(calibration.axisOffset) : MISSING}</DataRow>
				<DataRow label="RA-Only Motion">{calibration ? (calibration.verified ? 'Watched on the mount' : 'Operator stated') : MISSING}</DataRow>
			</DataList>
			{!calibration && rejected && (
				<Notice>
					Last candidate{rejected.rotation !== undefined ? ` (${formatDegrees(rejected.rotation, 1)})` : ''}: {IPOLAR_REJECTION_LABELS[rejected.reason]}
					{rejected.retry ? '; try again.' : '.'}
				</Notice>
			)}
		</CollapsibleSection>
	)
}

interface PolarErrorProps {
	// Session with a measurement.
	readonly session: IPolarSessionSummary
	// Zone of the active site, for the time of the measurement.
	readonly timeZone?: string
}

// Total, azimuth, and altitude errors of the latest measurement, whether it is current, and the convergence streak.
function PolarError({ session, timeZone }: PolarErrorProps) {
	const { zone } = useDisplayZone(timeZone ? { timeZone } : undefined)
	const measurement = session.measurement!
	const { convergence, rejection } = session

	return (
		<CollapsibleSection id="images.ipolar.polar-error" title="Polar Error">
			<DataList>
				<DataRow label="Total Error" tone={session.current && convergence.converged ? 'success' : 'default'}>
					{session.current ? formatArcmin(measurement.totalError) : `${formatArcmin(measurement.totalError)} (stale)`}
				</DataRow>
				<DataRow label="Azimuth (+ East)">{formatSignedArcmin(measurement.azimuthError)}</DataRow>
				<DataRow label="Altitude (+ Above)">{formatSignedArcmin(measurement.altitudeError)}</DataRow>
				<DataRow label="Measured">{`${formatClockTime(measurement.time, zone, { seconds: true })}, frame #${measurement.frame}`}</DataRow>
				<DataRow label="Within Target">{`${convergence.streak} of 3${convergence.converged ? ' ✓' : ''}`}</DataRow>
			</DataList>
			{!session.current && rejection && (
				<Notice>
					Frame #{rejection.frame} gave no measurement: {IPOLAR_REJECTION_LABELS[rejection.reason]}. The values above are not current.
				</Notice>
			)}
			<Notice>The target error is a requested threshold, not a measure of accuracy.</Notice>
		</CollapsibleSection>
	)
}

// Step of the running or last session, the progress of the frame being exposed, its failure, the slew rate restoration,
// and the latest warning.
function SessionState({ session }: { readonly session: IPolarSessionSummary }) {
	const failed = session.state === 'failed'

	return (
		<>
			<SessionStateText failed={failed}>{IPOLAR_STATE_LABELS[session.state]}</SessionStateText>
			{(session.state === 'capturing' || session.state === 'refining') && <FrameProgress exposure={session.exposure} />}
			{failed && session.error && <Notice error>{session.error}</Notice>}
			{session.slewRateRestored === true && session.previousSlewRate && <Notice>The slew rate was restored to {session.previousSlewRate}.</Notice>}
			{session.warnings.length > 0 && <Notice>{session.warnings.at(-1)}</Notice>}
		</>
	)
}
