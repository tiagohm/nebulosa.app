import type { DeviceSummary, TppaAlignment, TppaSession, TppaSessionSummary } from 'api'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { RoleDevice } from '../equipment/useEquipment'
import { formatArcmin, formatDegrees, formatExposureTime, formatFixed, formatSignedArcmin, MISSING } from '../format'
import { operationsState } from '../operations'
import { CameraPlateSolvingSection } from '../platesolving/CameraPlateSolvingSection'
import { activeProfile, cameraPlateSolving, exposureSettings, profileState, setTppaSettings, tppaSettings } from '../profile/profile'
import { type CameraIdentity, TPPA_MAXIMUM_ROTATION, TPPA_MINIMUM_ROTATION, type TppaSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { LinkButton } from '../ui/LinkButton'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'
import { SessionStateText } from './SessionStateText'
import {
	startTppa,
	startTppaRefinement,
	stopTppa,
	stopTppaRefinement,
	TPPA_ALIGNED_ERROR,
	TPPA_DIRECTION_LABELS,
	TPPA_DIRECTIONS,
	TPPA_MINIMUM_POLAR_DISTANCE,
	TPPA_OVERLAY_FAILURE_LABELS,
	TPPA_OVERLAY_WARNING_LABELS,
	TPPA_REJECTION_LABELS,
	TPPA_STATE_LABELS,
	tppaAligned,
	tppaBlocker,
	tppaCorrectionText,
	tppaMountSupport,
	tppaNearPole,
	tppaRequest,
	tppaRunning,
	tppaRuntime,
	tppaSlewRate,
	tppaSummaryText,
} from './tppa'
import { formatTppaTolerance } from './TppaOverlay'

// Contextual panel sections of TPPA, a camera operation of the Images camera tabs. The session leads: its state, the
// polar error as the panel's one Readout with the moves of the pole in words, the commands, and why a start is blocked
// with the way to fix it; then the three points and their geometry; then the settings, collapsed with a summary
// (alignment, acquisition, plate solving), and the equipment last. Frames are taken with the exposure time of this
// form and the camera's camera settings, edited only in Camera Acquisition, and solved with the camera's plate solving
// settings, edited only in Images → Plate Solver. The camera is the panel's target and the mount the MOUNT of the
// active equipment setup; a missing or unsuitable mount says why. The forms are the camera's, kept in the profile, and
// stay locked showing the values applied while a session runs; the session is the server's, shown here whichever tab
// started it, and keeps running when the panel unmounts. Its frames are shown by the latest frame of the camera with
// the correction guide drawn over them.

// Classes of the session commands: a touch target of 44 px on a coarse pointer, since they are pressed at the mount.
const COMMAND_CLASS = 'pointer-coarse:min-h-[44px]'

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
	const blocker = running ? undefined : tppaBlocker(availability, mountAvailability, mountState, slewRate)
	const slewRates = mountState?.slewRates ?? []
	const acquisition = running && session ? session.request.capture : exposure
	const direction = TPPA_DIRECTION_LABELS[shown.direction].toLowerCase()
	// Mount whose own page fixes the blocker (no site, parked, no tracking), rather than the equipment setup.
	const blockingMount = blocker !== undefined && availability.status === 'ready' && mountAvailability.status === 'ready' ? mount.device : undefined

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
			<CollapsibleSection id="images.tppa.session" title={running ? 'Current Session' : session ? 'Last Session' : 'Session'} summary={session && tppaSummaryText(session)}>
				{session && <SessionState session={session} />}
				{session?.alignment && <PolarError alignment={session.alignment} details={details} ended={!running} />}
				{session?.state === 'refining' && <Notice>Turn the azimuth and altitude knobs until the star sits on the target; the mount is not moved. The error refreshes with every frame.</Notice>}
				{!running && blocker === undefined && (
					<Notice>
						Start rotates {mount.device?.name ?? 'the mount'} in RA only, about {2 * shown.rotation}° towards the {direction} in all; make sure it is clear to move.
					</Notice>
				)}
				{!running && blocker === undefined && session?.state !== 'failed' && tppaNearPole(mountState) && (
					<Notice warning>The telescope points within {Math.round(toDeg(TPPA_MINIMUM_POLAR_DISTANCE))}° of the celestial pole, where TPPA refuses the first point; point it farther from the pole, near the meridian, first.</Notice>
				)}
				<div className="flex flex-wrap gap-2">
					{running ? (
						<>
							{(session!.state === 'readyToRefine' || session!.state === 'refinementPaused') && (
								<Button className={COMMAND_CLASS} title="Take frames and refresh the error while you turn the knobs" disabled={pending} onClick={() => void startTppaRefinement(tppaRuntime, session!)}>
									{session!.state === 'readyToRefine' ? 'Start Refinement' : 'Resume Refinement'}
								</Button>
							)}
							{session!.state === 'refining' && (
								<Button variant="secondary" className={COMMAND_CLASS} title="Stop taking frames; the devices stay held" disabled={pending} onClick={() => void stopTppaRefinement(tppaRuntime, session!)}>
									Pause Refinement
								</Button>
							)}
							<Button variant="secondary" className={COMMAND_CLASS} title="End the session and keep its last estimate" disabled={pending || session!.state === 'stopping'} onClick={() => void stopTppa(tppaRuntime, session!)}>
								{session!.state === 'stopping' ? 'Stopping…' : 'Stop'}
							</Button>
						</>
					) : (
						<Button className={COMMAND_CLASS} title={blocker} disabled={blocker !== undefined || pending} onClick={start}>
							Start Polar Alignment
						</Button>
					)}
				</div>
				{blocker && <Notice>{blocker}</Notice>}
				{!running && (mountAvailability.status === 'notSelected' || mountAvailability.status === 'unsupported') && <EquipmentSetupButton />}
				{blockingMount && (
					<LinkButton className="self-start text-xs" onClick={() => navigate(routeState, { workspace: 'equipment', device: blockingMount.id })}>
						Open {blockingMount.name} in Equipment Control
					</LinkButton>
				)}
				{error && <Notice error>{error}</Notice>}
				{session && <SessionNotes session={session} />}
			</CollapsibleSection>
			{session && <Points session={session} details={details} />}
			<CollapsibleSection id="images.tppa.alignment" title="Alignment" summary={`${TPPA_DIRECTION_LABELS[shown.direction]} · ${shown.rotation}° · settle ${shown.settleDelay} s`} defaultOpen={false}>
				<SegmentedControl label="RA Direction" options={TPPA_DIRECTIONS} value={shown.direction} format={(direction) => TPPA_DIRECTION_LABELS[direction]} disabled={locked} onChange={(direction) => update({ direction })} />
				{slewRates.length > 0 ? (
					<Select label="Slew Rate" options={slewRates.map((rate) => rate.name)} value={slewRate ?? slewRates[0].name} format={(name) => slewRates.find((rate) => rate.name === name)?.label.trim() || name} disabled={locked} onChange={(name) => update({ slewRate: name })} />
				) : (
					<Notice>Slew Rate: {running ? shown.slewRate : 'the mount reports no preset yet.'}</Notice>
				)}
				<NumberInput label="Rotation per Point" value={shown.rotation} min={TPPA_MINIMUM_ROTATION} max={TPPA_MAXIMUM_ROTATION} step={0.5} suffix="°" disabled={locked} onChange={(rotation) => update({ rotation })} />
				<NumberInput label="Settle Time" value={shown.settleDelay} min={0} max={120} step={0.5} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
				<NumberInput label="Refinement Interval" value={shown.refinementDelay} min={0} max={600} step={0.5} suffix="s" disabled={locked} onChange={(refinementDelay) => update({ refinementDelay })} />
				<Checkbox label="Stop the tracking when the session ends" checked={shown.stopTracking} disabled={locked} onChange={(stopTracking) => update({ stopTracking })} />
				<Notice>Rotation is measured by plate solving, never assumed from the motion time.</Notice>
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.tppa.acquisition"
				device={device}
				exposure={acquisition}
				capabilities={capabilities}
				defaultOpen={false}
				summary={`${formatExposureTime(shown.exposureTime)} · ${acquisition.binX}×${acquisition.binY}`}
				description="Frames are LIGHT, taken with the exposure time above and the camera settings of Camera Acquisition, and shown as the latest frame of the camera; they are kept in memory only."
			>
				<ExposureTimeInput value={shown.exposureTime} exposure={capabilities?.exposure} disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
			</CameraAcquisitionSection>
			<CameraPlateSolvingSection
				id="images.tppa.plate-solver"
				device={device}
				solving={running && session ? session.request.solving : solving}
				defaultOpen={false}
				description={(solver, assisted) => (
					<>
						Each frame is solved with the Plate Solving settings ({solver} solver, {assisted ? 'searched around the mount position snooped into its header' : 'searched over the whole sky'}); the rotation between the three points and the polar error are measured from the solutions.
					</>
				)}
			/>
			<CollapsibleSection id="images.tppa.equipment" title="Equipment" summary={mount.device?.name ?? 'No mount'} defaultOpen={false}>
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</DataRow>
				</DataList>
				{!running && mountAvailability.status !== 'ready' && <Notice>{mountAvailability.message}</Notice>}
			</CollapsibleSection>
		</>
	)
}

// The form values a running session applied, as the form shows them (the rotation in degrees).
function appliedSettings({ request }: TppaSessionSummary): TppaSettings {
	return { exposureTime: request.capture.exposureTime, direction: request.direction, slewRate: request.slewRate, rotation: toDeg(request.rotation), settleDelay: request.settleDelay, refinementDelay: request.refinementDelay, stopTracking: request.stopTracking }
}

interface PointsProps {
	// Session shown.
	readonly session: TppaSessionSummary
	// Its complete record, once fetched.
	readonly details?: TppaSession
}

// The three points with the rotation reached for each, the last rejected candidate, and the geometry once judged;
// collapsed with its count once the estimate leads the session.
function Points({ session, details }: PointsProps) {
	const points = details?.points ?? []
	const attempts = details?.attempts ?? []
	const rejected = attempts.findLast((attempt) => !attempt.accepted)
	const { geometry } = session

	return (
		<CollapsibleSection id="images.tppa.measurements" title="Points" defaultOpen={session.alignment === undefined} summary={`${session.pointCount}/3${geometry ? ` · ${geometry.acceptable ? 'good' : 'rejected'} geometry` : ''}`}>
			<DataList>
				{([1, 2, 3] as const).map((n) => {
					const pose = points.find((p) => p.point === n)
					const attempt = n > 1 ? attempts.find((a) => a.point === n && a.accepted) : undefined
					return (
						<DataRow key={n} label={`Point ${n}/3`}>
							{pose ? (attempt ? `${formatDegrees(attempt.rotation, 1)} rotated` : 'Solved') : session.point === n && tppaRunning(session) ? TPPA_STATE_LABELS[session.state] : MISSING}
						</DataRow>
					)
				})}
				<DataRow label="Frames">{session.frameCount}</DataRow>
				{geometry && <DataRow label="Total Rotation">{formatDegrees(geometry.rotation13, 1)}</DataRow>}
				{geometry && <DataRow label="Geometry">{`${geometry.acceptable ? 'Good' : 'Rejected'}, quality ${formatFixed(geometry.quality, 3)}`}</DataRow>}
			</DataList>
			{rejected?.reason && !session.geometry && (
				<Notice>
					Last candidate: {formatDegrees(rejected.rotation, 1)}, {TPPA_REJECTION_LABELS[rejected.reason]}.
				</Notice>
			)}
		</CollapsibleSection>
	)
}

interface PolarErrorProps {
	// Latest estimate.
	readonly alignment: TppaAlignment
	// Complete record, for the correction guide and its diagnostics.
	readonly details?: TppaSession
	// Whether the session ended, so the estimate is its last one.
	readonly ended: boolean
}

// The polar error of the latest estimate as the panel's Readout, read from the mount: the total error, whether it is
// within TPPA_ALIGNED_ERROR in words, the moves of the pole in azimuth and altitude, the knob changes the refinement
// inferred, the key of the correction guide drawn over the frame, and why the guide is missing or approximate.
function PolarError({ alignment, details, ended }: PolarErrorProps) {
	const overlay = details?.overlay
	const warnings = overlay?.geometry?.diagnostics.warnings ?? []
	const aligned = tppaAligned(alignment.totalError)
	const correction = tppaCorrectionText(alignment)
	const estimate = alignment.stage === 'acquisition' ? 'from the three points' : `refined at frame ${alignment.frame}`

	return (
		<>
			<div className="flex flex-col gap-0.5">
				<p className="m-0 text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{formatArcmin(alignment.totalError)}</p>
				<p className="m-0 text-xs leading-4 text-ink-300">
					{aligned && <span className="text-success">Aligned within {formatArcmin(TPPA_ALIGNED_ERROR, 0)} · </span>}
					{`${ended ? 'Last polar error' : 'Polar error'}, ${estimate}`}
				</p>
			</div>
			<DataList>
				<DataRow label="Azimuth">{correction.azimuth}</DataRow>
				<DataRow label="Altitude">{correction.altitude}</DataRow>
				{alignment.stage === 'refinement' && <DataRow label="Last Turn">{`Az ${formatSignedArcmin(alignment.azimuthAdjustment)} · Alt ${formatSignedArcmin(alignment.altitudeAdjustment)}`}</DataRow>}
			</DataList>
			{overlay?.geometry && <Notice>{guideKey(overlay.geometry.contours.filter((contour) => contour.visible).map((contour) => contour.tolerance))}</Notice>}
			{overlay?.failure && <Notice warning>The correction guide could not be drawn: {TPPA_OVERLAY_FAILURE_LABELS[overlay.failure]}.</Notice>}
			{warnings.length > 0 && <Notice warning>Guide: {warnings.map((warning) => TPPA_OVERLAY_WARNING_LABELS[warning]).join('; ')}.</Notice>}
		</>
	)
}

// Headline of the running or last session: its state, the progress of the frame being exposed (a refinement frame only
// once the driver reports it, since the refinement stays refining while it solves), and its failure.
function SessionState({ session }: { readonly session: TppaSessionSummary }) {
	const failed = session.state === 'failed'
	const exposing = session.state === 'capturing' || session.state === 'refining'

	return (
		<>
			<SessionStateText failed={failed}>{TPPA_STATE_LABELS[session.state]}</SessionStateText>
			{exposing && <FrameProgress exposure={session.exposure} />}
			{failed && session.error && <Notice error>{sentence(session.error)}</Notice>}
		</>
	)
}

// What the session did to the mount besides rotating it (the slew rate restored, the tracking it started) and its
// latest warning, under the commands.
function SessionNotes({ session }: { readonly session: TppaSessionSummary }) {
	return (
		<>
			{session.slewRateRestored === true && session.previousSlewRate && <Notice>The slew rate was restored to {session.previousSlewRate}.</Notice>}
			{session.trackingStarted && session.trackingStopped === undefined && (session.endedAt === undefined || !session.request.stopTracking) && (
				<Notice>{session.endedAt !== undefined ? 'The tracking started for the session was left on.' : session.request.stopTracking ? 'The tracking was started for the session and is stopped again once it ends.' : 'The tracking was started for the session and is left on once it ends.'}</Notice>
			)}
			{session.trackingStopped === true && <Notice>The tracking started for the session was stopped.</Notice>}
			{session.warnings.length > 0 && <Notice warning>{session.warnings.at(-1)}</Notice>}
		</>
	)
}

// Returns the key of the correction guide in words, with the residual errors of the rings drawn (radians).
function guideKey(tolerances: readonly number[]) {
	const rings = tolerances.length === 0 ? '' : `; rings, ${tolerances.map(formatTppaTolerance).join(', ')} of error left`
	return `On the frame: ember line, the azimuth move; green line, the altitude move to the target; dashed line, the whole move${rings}.`
}

// Returns a failure detail as a sentence: its first letter in upper case and a final period.
function sentence(text: string) {
	const capitalized = text.charAt(0).toUpperCase() + text.slice(1)
	return capitalized.endsWith('.') ? capitalized : `${capitalized}.`
}
