import type { CameraCapabilities, DeviceSummary, MountPointingSessionSummary, MountState, PointingModelSummary } from 'api'
import { cn } from 'cn'
import { toArcsec } from 'nebulosa/src/math/units/angle'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { ConfirmButton, Notice } from '../equipment-control/parts'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { deviceState } from '../equipment/equipment'
import type { CameraRole } from '../equipment/roles'
import type { RoleDevice } from '../equipment/useEquipment'
import { cameraTabKey } from '../images/cameratabs'
import { imagesState, selectImageTool } from '../images/images'
import {
	MOUNT_POINTING_STATE_LABELS,
	MOUNT_POINTING_STEP_LABELS,
	mountPointingBlocker,
	mountPointingMountSupport,
	mountPointingRequest,
	mountPointingVerifyRequest,
	verifyMountPointing,
	mountPointingRunning,
	mountPointingRuntime,
	pauseMountPointing,
	previewMountPointingPlan,
	resumeMountPointing,
	selectPointingModel,
	startMountPointing,
	stopMountPointing,
} from '../mountpointing/mountpointing'
import { operationsState } from '../operations'
import { CameraPlateSolvingSection } from '../platesolving/CameraPlateSolvingSection'
import { useSolverConfigured } from '../platesolving/PlateSolveControls'
import { activeProfile, cameraPlateSolving, exposureSettings, pointingModelSettings, profileState, setPointingModelSettings } from '../profile/profile'
import { type CameraExposureSettings, type CameraIdentity, POINTING_MODEL_PRESETS, type PointingModelSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { cameraKey } from './capture'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'

// Contextual panel sections of the Pointing Model Builder, a camera operation of the Images camera tabs: the equipment
// it uses, the camera and plate solving settings it applies, the sky it samples, the session, and what the run measured.
// It builds samples and never touches a model: fitting options, revisions, and activation belong to Tools → Mount Pointing
// Model. The exposure time is this form's; every other camera setting is edited only in Camera Acquisition, and the solver
// only in Images → Plate Solver, both linked from here. The forms are the camera's, kept in the profile, and stay locked
// showing the values applied while a session runs; the session is the server's, shown here whichever tab started it, and
// keeps running when the panel unmounts. Links only change what the tab shows: nothing here commands a device but Start,
// Pause, Resume, and Stop.

// Pattern labels of the plan.
const PATTERN_LABELS: Readonly<Record<PointingModelSettings['pattern'], string>> = { goldenSpiral: 'Golden Spiral', altAzGrid: 'Alt/Az Grid' }

// Patterns of the plan, in selector order.
const PATTERNS = Object.keys(PATTERN_LABELS) as PointingModelSettings['pattern'][]

// Text shown for a measure that does not exist yet, never a zero.
const MISSING = '—'

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
	const configured = useSolverConfigured(solving.provider)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const running = mountPointingRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const plan = key ? runtime.plans[key] : undefined
	const locked = running || pending
	const [confirmed, setConfirmed] = useState(false)
	// While running, the form shows the values the session applied.
	const shown: Readonly<PointingModelSettings> = running && session ? appliedSettings(session) : settings
	const mountAvailability = roleAvailability('MOUNT', mount, operations, mountPointingMountSupport(mountState))
	const unknownType = mountState?.mountType === 'UNKNOWN'
	const blocker = running ? undefined : mountPointingBlocker(availability, mountAvailability, role, mountState, configured, !unknownType || confirmed)
	const model = session ? runtime.models[session.modelId] : undefined
	const mountDevice = mount.device && { connectionId: mount.device.connectionId, deviceId: mount.device.id }

	// Updates fields of the camera's form.
	function update(patch: Partial<PointingModelSettings>) {
		setPointingModelSettings(profileState, identity, patch)
	}

	function start() {
		if (!device || !mountDevice) return
		void startMountPointing(mountPointingRuntime, device.connectionId, device.id, mountPointingRequest(settings, exposure, solving, mountDevice, confirmed, capabilities))
	}

	function verify(revisionId: string, modelId: string) {
		if (!device || !mountDevice) return
		void verifyMountPointing(mountPointingRuntime, modelId, mountPointingVerifyRequest(revisionId, { connectionId: device.connectionId, deviceId: device.id }, settings, exposure, solving, mountDevice, capabilities))
	}

	function preview() {
		if (!device || !mountDevice) return
		void previewMountPointingPlan(mountPointingRuntime, cameraKey(device.connectionId, device.id), mountDevice, settings)
	}

	return (
		<>
			<CollapsibleSection id="images.pointing-model-builder.equipment" title="Equipment">
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					<Row label="Camera">
						<DeviceLink device={device} fallback="—" />
					</Row>
					<Row label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</Row>
					<Row label="Site">{formatSite(mountState)}</Row>
				</dl>
				{!running && mountAvailability.status !== 'ready' && <Notice>{mountAvailability.message}</Notice>}
				{!running && (mountAvailability.status === 'notSelected' || mountAvailability.status === 'unsupported' || role !== 'MAIN_CAMERA') && (
					<Button variant="secondary" className="self-start" onClick={() => (deviceState.open = true)}>
						Equipment Setup
					</Button>
				)}
				{!running && unknownType && <Checkbox label="This mount is equatorial" checked={confirmed} onChange={setConfirmed} />}
			</CollapsibleSection>
			<CollapsibleSection id="images.pointing-model-builder.camera-settings" title="Camera Settings">
				<ExposureTimeInput value={shown.exposureTime} exposure={capabilities?.exposure} disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
				<CameraSummary exposure={running && session ? session.request.capture : exposure} capabilities={capabilities} />
				<p className="m-0 text-xs leading-4 text-ink-300">Frames are temporary LIGHT frames, shown as the latest frame of the camera and never saved.</p>
				{device && (
					<Button variant="secondary" className="self-start" onClick={() => selectImageTool(imagesState, cameraTabKey(device.connectionId, device.id), 'camera-acquisition')}>
						Open Acquisition
					</Button>
				)}
			</CollapsibleSection>
			<CameraPlateSolvingSection id="images.pointing-model-builder.plate-solving" device={device} solving={running && session ? session.request.solving : solving} />
			<CollapsibleSection id="images.pointing-model-builder.point-generation" title="Point Generation">
				<SegmentedControl label="Pattern" options={PATTERNS} value={shown.pattern} format={(pattern) => PATTERN_LABELS[pattern]} disabled={locked} onChange={(pattern) => update({ pattern })} />
				<div className="flex flex-wrap gap-1">
					{POINTING_MODEL_PRESETS.map(({ label, count }) => (
						<Button key={label} variant={shown.count === count ? 'primary' : 'secondary'} disabled={locked} onClick={() => update({ count })}>
							{label}
						</Button>
					))}
				</div>
				<NumberInput label="Points" value={shown.count} min={6} max={120} step={1} disabled={locked} onChange={(count) => update({ count })} />
				<NumberInput label="Minimum Altitude" value={shown.minimumAltitude} min={5} max={75} step={1} suffix="°" disabled={locked} onChange={(minimumAltitude) => update({ minimumAltitude })} />
				<NumberInput label="Meridian Avoidance" value={shown.meridianAvoidance} min={0} max={30} step={1} suffix="°" disabled={locked} onChange={(meridianAvoidance) => update({ meridianAvoidance })} />
				<NumberInput label="Settle Time" value={shown.settleDelay} min={0} max={120} step={0.5} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
				<Checkbox label="Stop the tracking when the session ends" checked={shown.stopTracking} disabled={locked} onChange={(stopTracking) => update({ stopTracking })} />
				{!running && (
					<Button variant="secondary" className="self-start" disabled={!mountDevice} onClick={preview}>
						Preview Plan
					</Button>
				)}
				{!running && plan && (
					<Notice>
						{plan.waypoints.length} of {plan.requestedCount} points fit the allowed sky, {plan.pierSideCounts.WEST} east of the meridian and {plan.pierSideCounts.EAST} west; {plan.heldOutCount} are withheld from the fit.
					</Notice>
				)}
				<Notice>A model needs samples on both sides of the meridian, and semi-physical and hybrid terms need more of them. The counts are starting points, not a guarantee.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.pointing-model-builder.session" title="Session">
				{session && <SessionState session={session} />}
				{running ? (
					<>
						{session!.state === 'paused' ? (
							<Button disabled={pending} onClick={() => void resumeMountPointing(mountPointingRuntime, session!)}>
								Resume
							</Button>
						) : (
							<Button variant="secondary" disabled={pending || session!.state === 'blocked' || session!.state === 'pausing' || session!.state === 'stopping'} onClick={() => void pauseMountPointing(mountPointingRuntime, session!)}>
								Pause
							</Button>
						)}
						<Button variant="secondary" disabled={pending || session!.state === 'stopping'} onClick={() => void stopMountPointing(mountPointingRuntime, session!)}>
							Stop
						</Button>
					</>
				) : (
					<ConfirmButton
						variant="primary"
						disabled={blocker !== undefined || pending}
						title="Start the pointing session"
						confirmLabel="Start"
						onConfirm={start}
						message={`The mount will slew across the sky to about ${settings.count} positions. Nebulosa does not know about cables, obstacles, or roofs: make sure it is clear to move. Sync is never used.`}
					>
						Start
					</ConfirmButton>
				)}
				{blocker && <Notice>{blocker}</Notice>}
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
			{model && <Results model={model} verifying={running && session?.kind === 'verification'} locked={locked || blocker !== undefined} onVerify={verify} />}
		</>
	)
}

// The form values a running session applied, as the form shows them (angles in degrees).
function appliedSettings({ request }: Pick<MountPointingSessionSummary, 'request'>): PointingModelSettings {
	const { capture, plan, settleDelay, stopTracking } = request
	return { exposureTime: capture.exposureTime, pattern: plan.pattern, count: plan.count, minimumAltitude: (plan.minimumAltitude * 180) / Math.PI, meridianAvoidance: (plan.meridianAvoidance * 180) / Math.PI, settleDelay, stopTracking }
}

// Formats the site a mount reports, in degrees, or a dash without one.
function formatSite(state: MountState | undefined) {
	if (!state || (state.site.latitude === 0 && state.site.longitude === 0)) return MISSING
	return `${((state.site.latitude * 180) / Math.PI).toFixed(2)}°, ${((state.site.longitude * 180) / Math.PI).toFixed(2)}°`
}

interface CameraSummaryProps {
	// Camera settings applied.
	readonly exposure: Omit<CameraExposureSettings, 'exposureTime'>
	// What the camera reports.
	readonly capabilities?: CameraCapabilities
}

// The camera settings Camera Acquisition owns, shown only.
function CameraSummary({ exposure: { gain, offset, binX, binY, subframe, width, height, frameFormat }, capabilities }: CameraSummaryProps) {
	const format = capabilities?.frameFormats.find((each) => each.name === frameFormat)?.label ?? (frameFormat || 'Default')

	return (
		<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
			<Row label="Gain">{gain}</Row>
			<Row label="Offset">{offset}</Row>
			<Row label="Binning">{`${binX} × ${binY}`}</Row>
			<Row label="Frame">{subframe ? `${width} × ${height}` : 'Full sensor'}</Row>
			<Row label="Format">{format}</Row>
		</dl>
	)
}

// Step of the session, its counts, the progress of the frame being exposed, and why it stopped.
function SessionState({ session }: { readonly session: MountPointingSessionSummary }) {
	const { state, step, waypoint, plannedCount, acceptedCount, rejectedCount, skippedCount, exposure, error, warnings } = session
	const failed = state === 'blocked'

	return (
		<>
			<p className={cn('m-0', failed ? 'text-danger' : 'text-ink-100')}>
				{MOUNT_POINTING_STATE_LABELS[state]}
				{step && ` · ${MOUNT_POINTING_STEP_LABELS[step]}`}
			</p>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				{waypoint !== undefined && <Row label="Point">{`${waypoint + 1} of ${plannedCount}`}</Row>}
				<Row label="Accepted">{`${acceptedCount} of ${plannedCount}`}</Row>
				<Row label="Rejected">{rejectedCount}</Row>
				<Row label="Skipped">{skippedCount}</Row>
			</dl>
			{step === 'exposing' && <FrameProgress exposure={exposure} />}
			{error && <p className="m-0 text-xs leading-4 text-danger">{error}</p>}
			{warnings.length > 0 && <p className="m-0 text-xs leading-4 text-ink-300">{warnings.at(-1)}</p>}
		</>
	)
}

interface ResultsProps {
	// Model of the session.
	readonly model: PointingModelSummary
	// Whether a verification runs.
	readonly verifying: boolean
	// Whether a verification cannot start now.
	readonly locked: boolean
	// Tests a revision of the model on the sky.
	readonly onVerify: (revisionId: string, modelId: string) => void
}

// What the latest fit of a model measured, with the measure on samples the fit never saw told apart, and the test of a
// revision on the sky, which only a revision that passed offline can take. A measure that does not exist is a dash, never
// a zero.
function Results({ model, verifying, locked, onVerify }: ResultsProps) {
	const { latest } = model
	const offline = latest?.offline

	return (
		<CollapsibleSection id="images.pointing-model-builder.results" title="Results">
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<Row label="Raw RMS">{formatArcsec(offline?.rawRms)}</Row>
				<Row label="Fit Residual RMS">{formatArcsec(offline?.trainingRms)}</Row>
				<Row label="Leave-One-Out RMS">{formatArcsec(offline?.looRms)}</Row>
				<Row label="Withheld RMS">{formatArcsec(offline?.heldOutRms)}</Row>
				<Row label="Offline Quality">{latest ? (latest.gate === 'passed' ? 'Passed' : latest.gate === 'failed' ? 'Failed' : 'Unusable') : 'Not fitted'}</Row>
				<Row label="Verified on the Sky">{latest?.verified ? 'Yes' : 'No'}</Row>
			</dl>
			<Notice>The fit residual says little about the rest of the sky; the withheld RMS comes from samples the fit never saw.</Notice>
			{latest?.gate === 'passed' && (
				<ConfirmButton
					variant="secondary"
					className="self-start"
					disabled={locked || verifying}
					title="Verify on the sky"
					confirmLabel="Verify"
					onConfirm={() => onVerify(latest.revisionId, model.modelId)}
					message="The mount will slew to independent targets, each one uncorrected and then corrected by this revision, to measure the difference. Nothing is activated, and nothing is synced. Make sure it is clear to move."
				>
					{latest.verified ? 'Verify Again' : 'Verify on the Sky'}
				</ConfirmButton>
			)}
			<Button
				variant="secondary"
				className="self-start"
				onClick={() => {
					selectPointingModel(mountPointingRuntime, model.modelId)
					navigate(routeState, { workspace: 'tools', tool: 'mount-pointing-model' })
				}}
			>
				Open Mount Pointing Model
			</Button>
		</CollapsibleSection>
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

// Formats an angle in radians as arcseconds, or a dash when it does not exist.
function formatArcsec(angle: number | undefined) {
	return angle === undefined ? MISSING : `${toArcsec(angle).toFixed(1)}″`
}
