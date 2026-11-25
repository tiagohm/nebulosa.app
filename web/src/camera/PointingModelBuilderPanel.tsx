import type { DeviceSummary, MountPointingSessionSummary, MountState, PointingGate, PointingModelSummary } from 'api'
import { toDeg } from 'nebulosa/src/math/units/angle'
import type { PointingPlan } from 'nebulosa/src/observation/mount/pointing.plan'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { CameraRole } from '../equipment/roles'
import type { RoleDevice } from '../equipment/useEquipment'
import { formatArcsec, formatExposureTime, formatGeographic, MISSING } from '../format'
import {
	changesMountPointingPlan,
	discardMountPointingPlan,
	MOUNT_POINTING_STATE_LABELS,
	MOUNT_POINTING_STEP_LABELS,
	mountPointingBlocker,
	mountPointingMountSupport,
	mountPointingRequest,
	mountPointingRunning,
	mountPointingRuntime,
	mountPointingSummaryText,
	mountPointingVerifyRequest,
	pauseMountPointing,
	previewMountPointingPlan,
	resumeMountPointing,
	selectPointingModel,
	startMountPointing,
	stopMountPointing,
	verifyMountPointing,
} from '../mountpointing/mountpointing'
import { operationsState } from '../operations'
import { CameraPlateSolvingSection } from '../platesolving/CameraPlateSolvingSection'
import { activeProfile, cameraPlateSolving, exposureSettings, pointingModelSettings, profileState, setPointingModelSettings } from '../profile/profile'
import { type CameraIdentity, POINTING_MODEL_MAXIMUM_POINTS, POINTING_MODEL_MINIMUM_POINTS, POINTING_MODEL_PRESETS, type PointingModelSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataList, DataRow } from '../ui/DataRow'
import { LinkButton } from '../ui/LinkButton'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of the Pointing Model Builder, a camera operation of the Images camera tabs. The session
// leads: its state and counts, the commands, why a start is blocked with the way to fix it, and, once a session ended
// with samples no fit measured yet, the way to Tools → Mount Pointing Model, where models are fitted; then what the
// latest fit measured, once there is one; then the sky the session samples with its previewed plan; then the camera,
// plate solving, and equipment, collapsed with a summary. It builds samples and never touches a model: fitting options,
// revisions, and activation belong to Tools → Mount Pointing Model. The exposure time is this form's; every other camera
// setting is edited only in Camera Acquisition, and the solver only in Images → Plate Solver, both linked from here.
// The forms are the camera's, kept in the profile, and stay locked showing the values applied while a session runs; the
// session is the server's, shown here whichever tab started it, and keeps running when the panel unmounts. Links only
// change what the tab shows: nothing here commands a device but Start, Pause, Resume, Stop, and Verify.

// Wait after the last change of the sky of the form before its plan is previewed again, in milliseconds, so the steppers
// of a held field ask for one plan instead of one per step.
const PLAN_PREVIEW_DELAY = 400

// Classes of the session commands: a touch target of 44 px on a coarse pointer, since they are pressed at the mount.
const COMMAND_CLASS = 'pointer-coarse:min-h-[44px]'

// Pattern labels of the plan.
const PATTERN_LABELS: Readonly<Record<PointingModelSettings['pattern'], string>> = { goldenSpiral: 'Golden Spiral', altAzGrid: 'Alt/Az Grid' }

// Patterns of the plan, in selector order.
const PATTERNS = Object.keys(PATTERN_LABELS) as PointingModelSettings['pattern'][]

// Label of a point count preset.
type PresetLabel = (typeof POINTING_MODEL_PRESETS)[number]['label']

// Point count presets, in selector order.
const PRESET_LABELS = POINTING_MODEL_PRESETS.map((preset) => preset.label)

// Label of each offline quality outcome of a fit.
const GATE_LABELS: Readonly<Record<PointingGate, string>> = { passed: 'Passed', failed: 'Failed', unusable: 'Unusable' }

// What each offline quality outcome means for the operator and what to do next.
const GATE_NOTES: Readonly<Record<PointingGate, string>> = {
	passed: 'The withheld RMS decides the offline quality: it comes from samples the fit never saw, while the fit residual says little about the rest of the sky.',
	failed: 'The samples withheld from the fit do not show that it predicts the rest of the sky, so it cannot be verified on the sky. Take more points, or fit again in Tools with another strategy.',
	unusable: 'The samples could not determine a model, so it cannot be verified on the sky. Take more points, spread over both sides of the meridian.',
}

// Camera a Pointing Model Builder panel samples with and the forms it edits.
export interface PointingModelBuilderTarget {
	// Camera, when present on the watched connection.
	readonly device?: DeviceSummary
	// Whether the camera can take frames now, and why not.
	readonly availability: RoleAvailability
	// Role of the camera in the equipment setup, if any.
	readonly role?: CameraRole
	// Mount of the equipment setup and its state.
	readonly mount: RoleDevice
	// Camera whose forms are edited; absent when the profile has no saved connection, so the defaults are shown and
	// nothing is kept.
	readonly settings?: CameraIdentity
}

// Pointing Model Builder panel sections of a camera.
export function PointingModelBuilderSections({ device, availability, role, mount, settings: identity }: PointingModelBuilderTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(mountPointingRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const profile = activeProfile(profiles)
	const settings = pointingModelSettings(profile.settings, identity)
	const exposure = exposureSettings(profile.settings, identity)
	const solving = cameraPlateSolving(profile.settings, identity)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const running = mountPointingRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const plan = key ? runtime.plans[key] : undefined
	const planError = key ? runtime.planErrors[key] : undefined
	const locked = running || pending
	const [confirmed, setConfirmed] = useState(false)
	// While running, the form shows the values the session applied.
	const shown: Readonly<PointingModelSettings> = running && session ? appliedSettings(session) : settings
	const acquisition = running && session ? session.request.capture : exposure
	const mountAvailability = roleAvailability('MOUNT', mount, operations, mountPointingMountSupport(mountState))
	const unknownType = mountState?.mountType === 'UNKNOWN'
	const blocker = running ? undefined : mountPointingBlocker(availability, mountAvailability, role, mountState, !unknownType || confirmed)
	const model = session ? runtime.models[session.modelId] : undefined
	const mountDevice = mount.device && { connectionId: mount.device.connectionId, deviceId: mount.device.id }
	const mountName = mount.device?.name ?? 'The mount'
	// Model of a session that ended with samples no fit has measured yet, so fitting them in Tools is the next step.
	const unfitted = !running && session?.kind === 'acquisition' && model && model.acceptedCount > 0 && !model.latest ? model : undefined
	// Mount whose own page fixes the blocker (no site, parked, no tracking), rather than the equipment setup.
	const blockingMount = blocker !== undefined && role === 'MAIN_CAMERA' && availability.status === 'ready' && mountAvailability.status === 'ready' ? mount.device : undefined

	// Updates fields of the camera's form, discarding the previewed plan once the sky it samples changes.
	function update(patch: Partial<PointingModelSettings>) {
		setPointingModelSettings(profileState, identity, patch)
		if (key && changesMountPointingPlan(patch)) discardMountPointingPlan(mountPointingRuntime, key)
	}

	function start() {
		if (!device || !mountDevice) return
		void startMountPointing(mountPointingRuntime, device.connectionId, device.id, mountPointingRequest(settings, exposure, solving, mountDevice, confirmed, capabilities))
	}

	function verify(revisionId: string, modelId: string) {
		if (!device || !mountDevice) return
		void verifyMountPointing(mountPointingRuntime, modelId, mountPointingVerifyRequest(revisionId, { connectionId: device.connectionId, deviceId: device.id }, settings, exposure, solving, mountDevice, capabilities))
	}

	// The plan is previewed when the panel opens, when the sky of the form or the site of the mount changes, and when a
	// session ends; never while one runs, which keeps the plan it applied.
	const { pattern, count, minimumAltitude, meridianAvoidance } = settings
	const mountConnectionId = mount.device?.connectionId
	const mountDeviceId = mount.device?.id
	const latitude = mountState?.site.latitude
	const longitude = mountState?.site.longitude

	useEffect(() => {
		if (!key || running || !mountConnectionId || !mountDeviceId || latitude === undefined || longitude === undefined) return
		const timer = setTimeout(() => void previewMountPointingPlan(mountPointingRuntime, key, { connectionId: mountConnectionId, deviceId: mountDeviceId }, { pattern, count, minimumAltitude, meridianAvoidance }), PLAN_PREVIEW_DELAY)
		return () => clearTimeout(timer)
	}, [key, running, mountConnectionId, mountDeviceId, latitude, longitude, pattern, count, minimumAltitude, meridianAvoidance])

	return (
		<>
			<CollapsibleSection id="images.pointing-model-builder.session" title={running ? 'Current Session' : session ? 'Last Session' : 'Session'} summary={session && mountPointingSummaryText(session)}>
				{session && <SessionState session={session} />}
				{unfitted && (
					<Notice>
						The {unfitted.acceptedCount} samples are kept in {unfitted.label}. Fit them in Tools → Mount Pointing Model to measure the model; Verify on the Sky follows once the fit passes.
					</Notice>
				)}
				{!running && unknownType && <Checkbox label="This mount is equatorial" checked={confirmed} onChange={setConfirmed} />}
				<div className="flex flex-wrap gap-2">
					{running ? (
						<>
							{session!.state === 'paused' ? (
								<Button className={COMMAND_CLASS} title="Go on with the next point" disabled={pending} onClick={() => void resumeMountPointing(mountPointingRuntime, session!)}>
									Resume
								</Button>
							) : (
								<Button
									variant="secondary"
									className={COMMAND_CLASS}
									title="Stop after the current point; the samples are kept"
									disabled={pending || session!.state === 'blocked' || session!.state === 'pausing' || session!.state === 'stopping'}
									onClick={() => void pauseMountPointing(mountPointingRuntime, session!)}
								>
									{session!.state === 'pausing' ? 'Pausing…' : 'Pause'}
								</Button>
							)}
							<Button variant="secondary" className={COMMAND_CLASS} title="End the session and keep its samples" disabled={pending || session!.state === 'stopping'} onClick={() => void stopMountPointing(mountPointingRuntime, session!)}>
								{session!.state === 'stopping' ? 'Stopping…' : 'Stop'}
							</Button>
						</>
					) : (
						<>
							{unfitted && (
								<Button className={COMMAND_CLASS} onClick={() => openModel(unfitted.modelId)}>
									Open Mount Pointing Model
								</Button>
							)}
							<ConfirmButton
								variant={unfitted ? 'secondary' : 'primary'}
								className={COMMAND_CLASS}
								disabled={blocker !== undefined || pending}
								tooltip={blocker}
								title={`Slew ${mount.device?.name ?? 'the mount'} across the sky?`}
								confirmLabel="Start Sampling"
								onConfirm={start}
								message={startMessage(mountName, plan, settings)}
							>
								Start Sampling
							</ConfirmButton>
						</>
					)}
				</div>
				{blocker && <Notice>{blocker}</Notice>}
				{!running && (mountAvailability.status === 'notSelected' || mountAvailability.status === 'unsupported' || role !== 'MAIN_CAMERA') && <EquipmentSetupButton />}
				{blockingMount && (
					<LinkButton className="self-start text-xs" onClick={() => navigate(routeState, { workspace: 'equipment', device: blockingMount.id })}>
						Open {blockingMount.name} in Equipment Control
					</LinkButton>
				)}
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
			{model?.latest && <Results model={model} verifying={running && session?.kind === 'verification'} locked={locked || blocker !== undefined} blocker={blocker} onVerify={verify} />}
			<CollapsibleSection id="images.pointing-model-builder.point-generation" title="Point Generation" summary={`${PATTERN_LABELS[shown.pattern]} · ${shown.count} points · ≥${shown.minimumAltitude}°`}>
				<SegmentedControl label="Pattern" options={PATTERNS} value={shown.pattern} format={(pattern) => PATTERN_LABELS[pattern]} disabled={locked} onChange={(pattern) => update({ pattern })} />
				<SegmentedControl<PresetLabel | 'custom'>
					label="Preset"
					options={PRESET_LABELS}
					value={POINTING_MODEL_PRESETS.find((preset) => preset.count === shown.count)?.label ?? 'custom'}
					disabled={locked}
					onChange={(label) => {
						const preset = POINTING_MODEL_PRESETS.find((p) => p.label === label)
						if (preset) update({ count: preset.count })
					}}
				/>
				<NumberInput label="Points" value={shown.count} min={POINTING_MODEL_MINIMUM_POINTS} max={POINTING_MODEL_MAXIMUM_POINTS} step={1} disabled={locked} onChange={(count) => update({ count })} />
				<NumberInput label="Minimum Altitude" value={shown.minimumAltitude} min={5} max={75} step={1} suffix="°" disabled={locked} onChange={(minimumAltitude) => update({ minimumAltitude })} />
				<NumberInput label="Meridian Avoidance" value={shown.meridianAvoidance} min={0} max={30} step={1} suffix="°" disabled={locked} onChange={(meridianAvoidance) => update({ meridianAvoidance })} />
				<NumberInput label="Settle Time" value={shown.settleDelay} min={0} max={120} step={0.5} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
				<Checkbox label="Stop the tracking when the session ends" checked={shown.stopTracking} disabled={locked} onChange={(stopTracking) => update({ stopTracking })} />
				{!running && <PlanState plan={plan} error={blocker === undefined ? planError : undefined} refused={planError !== undefined} connected={mountDevice !== undefined && mountState !== undefined} />}
				{running && plan && <PlanSummary plan={plan} />}
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.pointing-model-builder.acquisition"
				device={device}
				exposure={acquisition}
				capabilities={capabilities}
				defaultOpen={false}
				summary={`${formatExposureTime(shown.exposureTime)} · ${acquisition.binX}×${acquisition.binY}`}
				description="Frames are temporary LIGHT frames, shown as the latest frame of the camera and never saved."
			>
				<ExposureTimeInput value={shown.exposureTime} exposure={capabilities?.exposure} disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
			</CameraAcquisitionSection>
			<CameraPlateSolvingSection
				id="images.pointing-model-builder.plate-solving"
				device={device}
				solving={running && session ? session.request.solving : solving}
				defaultOpen={false}
				description={(solver, assisted) => (
					<>
						Each frame is solved by the {solver} solver, {assisted ? 'searching around its commanded point' : 'searching the whole sky'}. The solution and the position the mount reports make the sample.
					</>
				)}
			/>
			<CollapsibleSection id="images.pointing-model-builder.equipment" title="Equipment" summary={mount.device?.name ?? 'No mount'} defaultOpen={false}>
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</DataRow>
					<DataRow label="Site">{formatSite(mountState)}</DataRow>
				</DataList>
				{!running && mountAvailability.status !== 'ready' && <Notice>{mountAvailability.message}</Notice>}
			</CollapsibleSection>
		</>
	)
}

// Shows a model in Tools → Mount Pointing Model, where it is fitted and activated.
function openModel(modelId: string) {
	selectPointingModel(mountPointingRuntime, modelId)
	navigate(routeState, { workspace: 'tools', tool: 'mount-pointing-model' })
}

// Returns what Start does to the mount, for its confirmation: the exact points of a previewed plan, or about the count of
// the form, the altitude limit, and what the operator answers for.
function startMessage(mountName: string, plan: Readonly<PointingPlan> | undefined, settings: Readonly<PointingModelSettings>) {
	const points = plan ? `the ${plan.waypoints.length} points of the plan` : `about ${settings.count} points`
	const tracking = settings.stopTracking ? 'the tracking is stopped at the end' : 'the tracking is left on at the end'
	return `${mountName} slews to ${points} above ${settings.minimumAltitude}° and tracks while it samples; ${tracking}. Nebulosa does not know about cables, obstacles, or roofs: make sure it is clear to move. Sync is never used.`
}

// The form values a running session applied, as the form shows them (angles in degrees).
function appliedSettings({ request }: Pick<MountPointingSessionSummary, 'request'>): PointingModelSettings {
	const { capture, plan, settleDelay, stopTracking } = request
	return { exposureTime: capture.exposureTime, pattern: plan.pattern, count: plan.count, minimumAltitude: toDeg(plan.minimumAltitude), meridianAvoidance: toDeg(plan.meridianAvoidance), settleDelay, stopTracking }
}

// Formats the site a mount reports, in degrees to about a kilometre, or a dash without one.
function formatSite(state: MountState | undefined) {
	if (!state || (state.site.latitude === 0 && state.site.longitude === 0)) return MISSING
	return formatGeographic(toDeg(state.site.latitude), toDeg(state.site.longitude), 2)
}

// Returns a server message as a sentence: its first letter in upper case and a final period.
function sentence(text: string) {
	const capitalized = text.charAt(0).toUpperCase() + text.slice(1)
	return capitalized.endsWith('.') ? capitalized : `${capitalized}.`
}

interface PlanStateProps {
	// Plan of the form, once the server answered.
	readonly plan?: Readonly<PointingPlan>
	// Why the server refused to plan, shown unless the session's blocker already says it.
	readonly error?: string
	// Whether the server refused to plan, even when the refusal is not shown.
	readonly refused: boolean
	// Whether the mount is connected and reports its state, so the plan is asked for.
	readonly connected: boolean
}

// The plan of the form while no session runs: its summary, why it was refused, that it is on its way, or that it waits
// for the mount. A refusal the blocker already explains shows nothing.
function PlanState({ plan, error, refused, connected }: PlanStateProps) {
	if (plan) return <PlanSummary plan={plan} />
	if (error) return <Notice error>{sentence(error)}</Notice>
	if (refused) return null
	return <Notice>{connected ? 'Planning the points…' : 'The plan shows once the mount is connected.'}</Notice>
}

// What a previewed plan holds: the points that fit the allowed sky, per pier side, and those withheld to test the fit,
// with a warning when every point falls on one side of the meridian.
function PlanSummary({ plan }: { readonly plan: Readonly<PointingPlan> }) {
	const { waypoints, requestedCount, heldOutCount, pierSideCounts } = plan
	const oneSided = waypoints.length > 0 && (pierSideCounts.EAST === 0 || pierSideCounts.WEST === 0)

	return (
		<>
			<Notice>
				{waypoints.length} of {requestedCount} points fit the allowed sky, {pierSideCounts.WEST} east of the meridian and {pierSideCounts.EAST} west; {heldOutCount} are withheld from the fit to test it.
			</Notice>
			{oneSided && <Notice warning>Every point falls on one side of the meridian, so the model would hold there only. Lower the Minimum Altitude or the Meridian Avoidance.</Notice>}
		</>
	)
}

// Step of the session, its counts, the progress of the frame being exposed, and why it stopped.
function SessionState({ session }: { readonly session: MountPointingSessionSummary }) {
	const { state, step, waypoint, plannedCount, acceptedCount, rejectedCount, skippedCount, exposure, error, warnings } = session
	const failed = state === 'blocked'

	return (
		<>
			<SessionStateText failed={failed}>
				{MOUNT_POINTING_STATE_LABELS[state]}
				{step && ` · ${MOUNT_POINTING_STEP_LABELS[step]}`}
			</SessionStateText>
			<DataList>
				{waypoint !== undefined && <DataRow label="Point">{`${waypoint + 1} of ${plannedCount}`}</DataRow>}
				<DataRow label="Accepted" title="Samples measured, including those withheld from the fit to test it">{`${acceptedCount} of ${plannedCount}`}</DataRow>
				<DataRow label="Rejected">{rejectedCount}</DataRow>
				<DataRow label="Skipped">{skippedCount}</DataRow>
			</DataList>
			{step === 'exposing' && <FrameProgress exposure={exposure} />}
			{error && <Notice error>{sentence(error)}</Notice>}
			{warnings.length > 0 && <Notice warning>{warnings.at(-1)}</Notice>}
		</>
	)
}

interface ResultsProps {
	// Model of the session, with a fit.
	readonly model: PointingModelSummary
	// Whether a verification runs.
	readonly verifying: boolean
	// Whether a verification cannot start now.
	readonly locked: boolean
	// Why no session can start now, shown as the tooltip of Verify; absent when one can.
	readonly blocker?: string
	// Tests a revision of the model on the sky.
	readonly onVerify: (revisionId: string, modelId: string) => void
}

// What the latest fit of a model measured, led by its offline quality and the withheld RMS that decides it, what that
// outcome means and what to do next, and the test of a revision on the sky, which only a revision that passed offline can
// take. A measure that does not exist is a dash, never a zero.
function Results({ model, verifying, locked, blocker, onVerify }: ResultsProps) {
	const { latest } = model
	if (!latest) return null
	const { offline, gate } = latest

	return (
		<CollapsibleSection id="images.pointing-model-builder.results" title="Results" summary={`${GATE_LABELS[gate]} · ${formatArcsec(offline.heldOutRms)}`}>
			<DataList>
				<DataRow label="Offline Quality" tone={gate === 'passed' ? 'success' : 'danger'}>
					{GATE_LABELS[gate]}
				</DataRow>
				<DataRow label="Withheld RMS" title="Error the fit leaves on samples it never saw; it decides the offline quality">
					{formatArcsec(offline.heldOutRms)}
				</DataRow>
				<DataRow label="Raw RMS" title="Error of the samples before correction">
					{formatArcsec(offline.rawRms)}
				</DataRow>
				<DataRow label="Leave-One-Out RMS">{formatArcsec(offline.looRms)}</DataRow>
				<DataRow label="Fit Residual RMS">{formatArcsec(offline.trainingRms)}</DataRow>
				<DataRow label="Verified on the Sky" tone={latest.verified ? 'success' : undefined}>
					{latest.verified ? 'Yes' : 'No'}
				</DataRow>
			</DataList>
			<Notice>{GATE_NOTES[gate]}</Notice>
			<div className="flex flex-wrap gap-2">
				{gate === 'passed' && (
					<ConfirmButton
						variant="secondary"
						className={COMMAND_CLASS}
						disabled={locked || verifying}
						tooltip={blocker}
						title="Verify this revision on the sky?"
						confirmLabel="Verify"
						onConfirm={() => onVerify(latest.revisionId, model.modelId)}
						message="The mount will slew to independent targets, each one uncorrected and then corrected by this revision, to measure the difference. Nothing is activated, and nothing is synced. Make sure it is clear to move."
					>
						{latest.verified ? 'Verify Again' : 'Verify on the Sky'}
					</ConfirmButton>
				)}
				<Button variant="secondary" className={COMMAND_CLASS} onClick={() => openModel(model.modelId)}>
					Open Mount Pointing Model
				</Button>
			</div>
		</CollapsibleSection>
	)
}
