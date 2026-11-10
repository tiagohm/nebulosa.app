import type { CalibrationMasterSummary, DeviceSummary, IPolarSession, IPolarSessionSummary } from 'api'
import { toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { RoleDevice } from '../equipment/useEquipment'
import { formatArcmin, formatArcsec, formatClockTime, formatDegrees, formatExposureTime, formatSignedArcmin, formatTemperature, MISSING } from '../format'
import { useActiveSite, useDisplayZone } from '../location/useLocation'
import { operationsState } from '../operations'
import { CameraPlateSolvingSection } from '../platesolving/CameraPlateSolvingSection'
import { useSolverConfigured } from '../platesolving/PlateSolveControls'
import { activeProfile, cameraPlateSolving, exposureSettings, ipolarSettings, profileState, setIPolarSettings } from '../profile/profile'
import { type CameraIdentity, DEFAULT_IPOLAR_DARK_SETTINGS, IPOLAR_MAXIMUM_ROTATION, IPOLAR_MINIMUM_ROTATION, type IPolarDarkSettings, type IPolarSettings } from '../profile/schema'
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
import {
	confirmIPolarRotation,
	finishIPolar,
	ipolarDarkText,
	IPOLAR_DIRECTION_LABELS,
	IPOLAR_DIRECTIONS,
	IPOLAR_MODE_LABELS,
	IPOLAR_MODES,
	IPOLAR_REJECTION_LABELS,
	IPOLAR_STATE_LABELS,
	ipolarBlocker,
	ipolarMountSupport,
	ipolarRequest,
	ipolarRunning,
	ipolarRuntime,
	ipolarSlewRate,
	startIPolar,
	startIPolarRefinement,
	stopIPolar,
	stopIPolarRefinement,
} from './ipolar'
import { loadLiveMasters } from './livestacking'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of iPolar, a camera operation of the Images camera tabs: the equipment and the mode (the
// operator turns the RA axis by hand, or the setup's mount turns it), the frame exposure, the rotation, the plate solving
// settings it applies, the refinement, the calibration, the polar error and its convergence, and the commands (Start,
// Rotation Done, Refine, Pause, Finish, Stop). Frames are taken with the exposure time of this form and the camera's
// camera settings, edited only in Camera Acquisition, and solved with the camera's plate solving settings; the site is
// always the profile's active observing site, which the panel does not show. The camera is the panel's target and the mount the MOUNT of the
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
	const blocker = running ? undefined : ipolarBlocker({ camera: availability, mount: mountAvailability, mode: settings.mode, mountState, slewRate, site, solverConfigured: configured, dark: settings.dark })
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
			<DarkSection dark={shown.dark ?? DEFAULT_IPOLAR_DARK_SETTINGS} exposureTime={shown.exposureTime} locked={locked} session={running ? session : undefined} onChange={(patch) => update({ dark: { ...(settings.dark ?? DEFAULT_IPOLAR_DARK_SETTINGS), ...patch } })} />
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
				<Checkbox label="Correct for atmospheric refraction" checked={shown.refraction} disabled={locked} onChange={(refraction) => update({ refraction })} />
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
		...(request.dark && { dark: { enabled: true, ...request.dark } }),
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

interface DarkSectionProps {
	// Master dark of the form, or the one a running session applies.
	readonly dark: IPolarDarkSettings
	// Exposure time of the frames, in seconds, which a master must have exactly.
	readonly exposureTime: number
	// Whether the form is locked by a session or a command in flight.
	readonly locked: boolean
	// Running session, whose latest frame's dark outcome is shown.
	readonly session?: IPolarSessionSummary
	// Updates fields of the form's dark.
	readonly onChange: (patch: Partial<IPolarDarkSettings>) => void
}

// Option of the master selector meaning no master chosen yet.
const NO_MASTER = ''

// The master dark of the Calibration Library the frames are solved less: the operator pins one (nothing identifies the
// camera a master came from, so none is chosen automatically), what a frame it does not fit does, and, while a session
// runs, how it went for the latest frame. The masters are listed from the library; the server checks the pinned one
// against the header of every frame.
function DarkSection({ dark, exposureTime, locked, session, onChange }: DarkSectionProps) {
	const [masters, setMasters] = useState<readonly CalibrationMasterSummary[]>()
	const exposure = Math.round(exposureTime * 1e6)

	useEffect(() => {
		if (!dark.enabled || session) return
		let current = true
		void loadLiveMasters('dark').then((loaded) => current && setMasters(loaded))
		return () => {
			current = false
		}
	}, [dark.enabled, session])

	const ids = (masters ?? []).map((master) => String(master.masterId))
	const selected = dark.masterId === undefined ? NO_MASTER : String(dark.masterId)
	const listed = selected === NO_MASTER || ids.includes(selected)

	function describe(id: string) {
		if (id === NO_MASTER) return 'Choose a master dark'
		const master = masters?.find((candidate) => String(candidate.masterId) === id)
		if (!master) return `#${id}`
		const { metadata } = master
		const temperature = metadata.setTemperature.value ?? metadata.sensorTemperature.value
		const parts = [
			`#${master.masterId}`,
			metadata.exposure.value === undefined ? MISSING : formatExposureTime(metadata.exposure.value / 1e6),
			metadata.gain.value === undefined ? undefined : `gain ${metadata.gain.value}`,
			metadata.binX.value === undefined ? undefined : `bin ${metadata.binX.value}×${metadata.binY.value ?? metadata.binX.value}`,
			temperature === undefined ? undefined : formatTemperature(temperature),
			`${master.frames} frames`,
			metadata.cameraName,
		]
		return parts.filter(Boolean).join(' · ')
	}

	function choose(id: string) {
		const master = masters?.find((candidate) => String(candidate.masterId) === id)
		if (master) onChange({ masterId: master.masterId, digest: master.contentDigest })
	}

	return (
		<CollapsibleSection id="images.ipolar.dark" title="Dark">
			<Checkbox label="Subtract a Calibration Library dark" checked={dark.enabled} disabled={locked} onChange={(enabled) => onChange({ enabled })} />
			{dark.enabled && (
				<>
					{session ? (
						<DataList>
							<DataRow label="Master">{dark.masterId === undefined ? MISSING : `#${dark.masterId}`}</DataRow>
						</DataList>
					) : (
						<Select
							label="Master"
							options={[NO_MASTER, ...ids]}
							value={listed ? selected : NO_MASTER}
							format={describe}
							disabledReason={(id) => (id === NO_MASTER ? undefined : masters?.find((candidate) => String(candidate.masterId) === id)?.metadata.exposure.value !== exposure ? 'Exposure differs from the frames' : undefined)}
							disabled={locked}
							onChange={choose}
						/>
					)}
					<SegmentedControl label="When It Does Not Fit" options={['continue', 'stop'] as const} value={dark.onUnavailable} format={(policy) => (policy === 'continue' ? 'Solve Without' : 'Stop')} disabled={locked} onChange={(onUnavailable) => onChange({ onUnavailable })} />
					{!session && masters !== undefined && masters.length === 0 && <Notice>The Calibration Library has no master dark yet; make one with the Dark Library Wizard.</Notice>}
					{!session && !listed && <Notice>The dark #{dark.masterId} is no longer in the Calibration Library; choose another one.</Notice>}
					{session?.dark && <Notice error={session.dark.state === 'failed' || (session.dark.state === 'notApplied' && dark.onUnavailable === 'stop')}>{ipolarDarkText(session.dark, dark.onUnavailable)}</Notice>}
					<Notice>The camera a master came from cannot be verified; the server checks the master against the exposure, size, gain, offset, binning, and temperature of every frame, and only the frame itself is shown.</Notice>
				</>
			)}
		</CollapsibleSection>
	)
}
