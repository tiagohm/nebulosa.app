import type { DeviceSummary, TppaAlignment, TppaSession, TppaSessionSummary } from 'api'
import { cn } from 'cn'
import { toArcmin, toDeg } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { Notice } from '../equipment-control/parts'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { deviceState } from '../equipment/equipment'
import type { RoleDevice } from '../equipment/useEquipment'
import { operationsState } from '../operations'
import { CameraPlateSolvingSection } from '../platesolving/CameraPlateSolvingSection'
import { useSolverConfigured } from '../platesolving/PlateSolveControls'
import { activeProfile, cameraPlateSolving, exposureSettings, profileState, setTppaSettings, tppaSettings } from '../profile/profile'
import { type CameraIdentity, TPPA_MAXIMUM_ROTATION, TPPA_MINIMUM_ROTATION, type TppaSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'
import { startTppa, startTppaRefinement, stopTppa, stopTppaRefinement, TPPA_DIRECTION_LABELS, TPPA_DIRECTIONS, TPPA_STATE_LABELS, tppaBlocker, tppaMountSupport, tppaRequest, tppaRunning, tppaRuntime, tppaSlewRate } from './tppa'

// Contextual panel sections of TPPA, a camera operation of the Images camera tabs: the equipment it uses, the
// alignment settings (exposure time, RA direction, slew-rate preset of the mount, rotation between poses, settle and
// refinement delays), the plate solving settings it applies, the three poses and their geometry, the polar error, and
// the Start, Refine, Pause, and Stop commands. Frames are taken with the exposure time of this form and the camera's
// camera settings, edited only in Camera Acquisition and shown under the exposure time, and solved with the camera's plate solving settings, edited only
// in Images → Plate Solver. The camera is the panel's target and the mount the MOUNT of the active equipment setup; a missing or unsuitable mount
// says why. The forms are the camera's, kept in the profile, and stay locked showing the values applied while a
// session runs; the session is the server's, shown here whichever tab started it, and keeps running when the panel
// unmounts. Its frames are shown by the latest frame of the camera with the correction guide drawn over them.

// Camera a TPPA panel aligns with and the forms it edits.
export interface TppaTarget {
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

// TPPA panel sections of a camera.
export function TppaSections({ device, availability, mount, settings: identity }: TppaTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(tppaRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const profile = activeProfile(profiles)
	const settings = tppaSettings(profile.settings, identity)
	const exposure = exposureSettings(profile.settings, identity)
	const solving = cameraPlateSolving(profile.settings, identity)
	const configured = useSolverConfigured(solving.provider)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const details = session ? runtime.details[session.sessionId] : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const running = tppaRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const locked = running || pending
	// While running, the form shows the values the session applied.
	const shown: Readonly<TppaSettings> = running && session ? appliedSettings(session) : settings
	const slewRate = running && session ? session.request.slewRate : tppaSlewRate(settings, mountState)
	const mountAvailability = roleAvailability('MOUNT', mount, operations, tppaMountSupport(mountState))
	const blocker = running ? undefined : tppaBlocker(availability, mountAvailability, mountState, slewRate, configured)
	const slewRates = mountState?.slewRates ?? []

	// Updates fields of the camera's TPPA form.
	function update(patch: Partial<TppaSettings>) {
		setTppaSettings(profileState, identity, patch)
	}

	function start() {
		if (!device || !mount.device || slewRate === undefined) return
		void startTppa(tppaRuntime, device.connectionId, device.id, tppaRequest(settings, exposure, solving, { connectionId: mount.device.connectionId, deviceId: mount.device.id }, slewRate, capabilities))
	}

	return (
		<>
			<CollapsibleSection id="images.tppa.equipment" title="Equipment">
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} fallback="—" />
					</DataRow>
					<DataRow label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</DataRow>
				</DataList>
				{!running && mountAvailability.status !== 'ready' && <p className="m-0 text-xs leading-4 text-ink-300">{mountAvailability.message}</p>}
				{!running && (mountAvailability.status === 'notSelected' || mountAvailability.status === 'unsupported') && (
					<Button variant="secondary" className="self-start" onClick={() => (deviceState.open = true)}>
						Equipment Setup
					</Button>
				)}
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.tppa.acquisition"
				device={device}
				exposure={running && session ? session.request.capture : exposure}
				capabilities={capabilities}
				description="Frames are LIGHT, taken with the exposure time above and the camera settings of Camera Acquisition, and shown as the latest frame of the camera; they are kept in memory only."
			>
				<ExposureTimeInput value={shown.exposureTime} exposure={capabilities?.exposure} disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
			</CameraAcquisitionSection>
			<CollapsibleSection id="images.tppa.alignment" title="Alignment">
				<SegmentedControl label="RA Direction" options={TPPA_DIRECTIONS} value={shown.direction} format={(direction) => TPPA_DIRECTION_LABELS[direction]} disabled={locked} onChange={(direction) => update({ direction })} />
				{slewRates.length > 0 ? (
					<Select label="Slew Rate" options={slewRates.map((rate) => rate.name)} value={slewRate ?? slewRates[0].name} format={(name) => slewRates.find((rate) => rate.name === name)?.label.trim() || name} disabled={locked} onChange={(name) => update({ slewRate: name })} />
				) : (
					<p className="m-0 text-xs leading-4 text-ink-300">Slew Rate: {running ? shown.slewRate : 'the mount reports no preset yet.'}</p>
				)}
				<NumberInput label="Rotation per Point" value={shown.rotation} min={TPPA_MINIMUM_ROTATION} max={TPPA_MAXIMUM_ROTATION} step={0.5} suffix="°" disabled={locked} onChange={(rotation) => update({ rotation })} />
				<NumberInput label="Settle Time" value={shown.settleDelay} min={0} max={120} step={0.5} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
				<NumberInput label="Refinement Interval" value={shown.refinementDelay} min={0} max={600} step={0.5} suffix="s" disabled={locked} onChange={(refinementDelay) => update({ refinementDelay })} />
				<Checkbox label="Stop the tracking when the session ends" checked={shown.stopTracking} disabled={locked} onChange={(stopTracking) => update({ stopTracking })} />
				<Notice>
					The mount rotates in RA only, towards the {TPPA_DIRECTION_LABELS[shown.direction].toLowerCase()}, about {2 * shown.rotation}° in all; make sure it is clear to move. Rotation is measured by plate solving, never assumed from the motion time.
				</Notice>
			</CollapsibleSection>
			<CameraPlateSolvingSection
				id="images.tppa.plate-solver"
				device={device}
				solving={running && session ? session.request.solving : solving}
				description={(solver, assisted) => (
					<>
						Each frame is solved with the Plate Solving settings ({solver} solver, {assisted ? 'searched around the mount position snooped into its header' : 'searched over the whole sky'}); the rotation between the three points and the polar error are measured from the solutions.
					</>
				)}
			/>
			{session && <Measurements session={session} details={details} />}
			{session?.alignment && <PolarError alignment={session.alignment} details={details} />}
			<CollapsibleSection id="images.tppa.controls" title="Controls">
				{session && <SessionState session={session} />}
				{running ? (
					<>
						{(session!.state === 'readyToRefine' || session!.state === 'refinementPaused') && (
							<Button disabled={pending} onClick={() => void startTppaRefinement(tppaRuntime, session!)}>
								{session!.state === 'readyToRefine' ? 'Start Refinement' : 'Resume Refinement'}
							</Button>
						)}
						{session!.state === 'refining' && (
							<Button variant="secondary" disabled={pending} onClick={() => void stopTppaRefinement(tppaRuntime, session!)}>
								Pause Refinement
							</Button>
						)}
						<Button variant="secondary" disabled={pending || session!.state === 'stopping'} onClick={() => void stopTppa(tppaRuntime, session!)}>
							{session!.state === 'stopping' ? 'Stopping…' : 'Stop'}
						</Button>
					</>
				) : (
					<Button disabled={blocker !== undefined || pending} onClick={start}>
						Start Polar Alignment
					</Button>
				)}
				{blocker && <p className="m-0 text-xs leading-4 text-ink-300">{blocker}</p>}
				{session?.state === 'refining' && <p className="m-0 text-xs leading-4 text-ink-300">Turn the azimuth and altitude knobs to bring the star onto the target; the mount is not moved.</p>}
				{error && <p className="m-0 text-xs leading-4 text-danger">{error}</p>}
			</CollapsibleSection>
		</>
	)
}

// The form values a running session applied, as the form shows them (the rotation in degrees).
function appliedSettings({ request }: TppaSessionSummary): TppaSettings {
	return { exposureTime: request.capture.exposureTime, direction: request.direction, slewRate: request.slewRate, rotation: toDeg(request.rotation), settleDelay: request.settleDelay, refinementDelay: request.refinementDelay, stopTracking: request.stopTracking }
}

interface MeasurementsProps {
	// Session shown.
	readonly session: TppaSessionSummary
	// Its complete record, once fetched.
	readonly details?: TppaSession
}

// The three poses with the rotation reached for each, the last rejected candidate, and the geometry once judged.
function Measurements({ session, details }: MeasurementsProps) {
	const points = details?.points ?? []
	const attempts = details?.attempts ?? []
	const rejected = attempts.findLast((attempt) => !attempt.accepted)
	const { geometry } = session

	return (
		<CollapsibleSection id="images.tppa.measurements" title="Measurements">
			<DataList>
				{([1, 2, 3] as const).map((n) => {
					const pose = points.find((p) => p.point === n)
					const attempt = n > 1 ? attempts.find((a) => a.point === n && a.accepted) : undefined
					return (
						<DataRow key={n} label={`Point ${n}/3`}>
							{pose ? (attempt ? `${formatDegrees(attempt.rotation)} rotated` : 'Solved') : session.point === n && tppaRunning(session) ? TPPA_STATE_LABELS[session.state] : '—'}
						</DataRow>
					)
				})}
				<DataRow label="Frames">{session.frameCount}</DataRow>
				{geometry && <DataRow label="Total Rotation">{formatDegrees(geometry.rotation13)}</DataRow>}
				{geometry && <DataRow label="Geometry">{`${geometry.acceptable ? 'Good' : 'Rejected'} (Q ${geometry.quality.toFixed(3)})`}</DataRow>}
			</DataList>
			{rejected && !session.geometry && (
				<p className="m-0 text-xs leading-4 text-ink-300">
					Last candidate: {formatDegrees(rejected.rotation)}, {rejected.reason === 'insufficientRotation' ? 'moving further' : rejected.reason}.
				</p>
			)}
		</CollapsibleSection>
	)
}

interface PolarErrorProps {
	// Latest estimate.
	readonly alignment: TppaAlignment
	// Complete record, for the overlay diagnostics.
	readonly details?: TppaSession
}

// Total, azimuth, and altitude errors of the latest estimate, the knob changes the refinement inferred, and the
// diagnostics of the correction guide.
function PolarError({ alignment, details }: PolarErrorProps) {
	const overlay = details?.overlay
	const warnings = overlay?.geometry?.diagnostics.warnings ?? []

	return (
		<CollapsibleSection id="images.tppa.polar-alignment" title="Polar Alignment">
			<DataList>
				<DataRow label="Total Error">
					<span className={cn(toArcmin(alignment.totalError) <= 1 && 'text-success')}>{formatArcmin(alignment.totalError, false)}</span>
				</DataRow>
				<DataRow label="Azimuth Error">{formatArcmin(alignment.azimuthError)}</DataRow>
				<DataRow label="Altitude Error">{formatArcmin(alignment.altitudeError)}</DataRow>
				{alignment.stage === 'refinement' && <DataRow label="Last Adjustment">{`Az ${formatArcmin(alignment.azimuthAdjustment)} · Alt ${formatArcmin(alignment.altitudeAdjustment)}`}</DataRow>}
				<DataRow label="Estimate">{alignment.stage === 'acquisition' ? 'Initial (three points)' : `Refined, frame #${alignment.frame}`}</DataRow>
			</DataList>
			{overlay?.failure && <p className="m-0 text-xs leading-4 text-ink-300">The correction guide could not be drawn ({overlay.failure}).</p>}
			{warnings.length > 0 && <p className="m-0 text-xs leading-4 text-ink-300">Guide: {warnings.join(', ')}.</p>}
		</CollapsibleSection>
	)
}

// Step of the running or last session, the progress of the frame being exposed (a refinement frame only once the
// driver reports it, since the refinement stays refining while it solves), its failure, the slew rate restoration,
// and the tracking it started.
function SessionState({ session }: { readonly session: TppaSessionSummary }) {
	const failed = session.state === 'failed'

	return (
		<>
			<p className={cn('m-0', failed ? 'text-danger' : 'text-ink-100')}>{TPPA_STATE_LABELS[session.state]}</p>
			{(session.state === 'capturing' || session.state === 'refining') && <FrameProgress exposure={session.exposure} />}
			{failed && session.error && <p className="m-0 text-xs leading-4 text-danger">{session.error}</p>}
			{session.slewRateRestored === true && session.previousSlewRate && <p className="m-0 text-xs leading-4 text-ink-300">The slew rate was restored to {session.previousSlewRate}.</p>}
			{session.trackingStarted && session.trackingStopped === undefined && (session.endedAt === undefined || !session.request.stopTracking) && (
				<p className="m-0 text-xs leading-4 text-ink-300">
					{session.endedAt !== undefined ? 'The tracking started for the session was left on.' : session.request.stopTracking ? 'The tracking was started for the session and is stopped again once it ends.' : 'The tracking was started for the session and is left on once it ends.'}
				</p>
			)}
			{session.trackingStopped === true && <p className="m-0 text-xs leading-4 text-ink-300">The tracking started for the session was stopped.</p>}
			{session.warnings.length > 0 && <p className="m-0 text-xs leading-4 text-ink-300">{session.warnings.at(-1)}</p>}
		</>
	)
}

// Formats an angle in radians as arcminutes, signed unless told otherwise.
function formatArcmin(angle: number, signed = true) {
	const value = toArcmin(angle)
	return `${signed && value > 0 ? '+' : ''}${value.toFixed(1)}′`
}

// Formats an angle in radians as degrees with one decimal.
function formatDegrees(angle: number) {
	return `${toDeg(angle).toFixed(1)}°`
}
