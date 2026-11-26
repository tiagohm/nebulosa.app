import type { DeviceSummary, TargetCenteringSessionSummary } from 'api'
import { imageTopPositionAngle } from 'nebulosa/src/astrometry/wcs/orientation'
import { deg, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { deviceAvailability, type RoleAvailability, roleAvailability } from '../equipment/availability'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { RoleDevice } from '../equipment/useEquipment'
import { formatAngularSize, formatExposureTime, formatFixed, formatSignedAngle, MISSING } from '../format'
import { framingsState, sortedFramings } from '../framing/framings'
import { operationsState } from '../operations'
import { CameraPlateSolvingSection } from '../platesolving/CameraPlateSolvingSection'
import { type CoordinateStyle, formatDeclinationAs, formatRightAscensionAs } from '../platesolving/coordinates'
import { catalogTarget } from '../platesolving/measurement'
import { AngleField } from '../platesolving/PlateSolveControls'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { activeProfile, cameraPlateSolving, exposureSettings, imageAstrometrySettings, profileState, setTargetCenteringSettings, targetCenteringSettings } from '../profile/profile'
import { type CameraIdentity, TARGET_CENTERING_LIMITS, type TargetCenteringSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { navigate, routeState } from '../shell/route'
import { skyState } from '../sky/sky'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataList, DataRow } from '../ui/DataRow'
import { LinkButton } from '../ui/LinkButton'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { Cell, Row, Table, type TableColumn } from '../ui/Table'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'
import { SessionStateText } from './SessionStateText'
import {
	formatSignedDegrees,
	startTargetCentering,
	stopTargetCentering,
	TARGET_CENTERING_GUIDING_LABELS,
	TARGET_CENTERING_OUTCOME_LABELS,
	TARGET_CENTERING_SENSE_SOURCE_LABELS,
	targetCenteringBlocker,
	type TargetCenteringDraft,
	targetCenteringFrameCount,
	targetCenteringMountBlocker,
	type TargetCenteringPosition,
	targetCenteringPosition,
	targetCenteringRequest,
	targetCenteringRunning,
	targetCenteringRuntime,
	targetCenteringSlews,
	targetCenteringStale,
	targetCenteringStateText,
} from './targetcentering'
import { framingAngle, setTargetCenteringDraft } from './targetcentering.handoff'
import { TargetCenteringBullseye } from './TargetCenteringBullseye'

// Contextual panel sections of Target Centering, a camera operation of the Images camera tabs. The session leads with its
// verdict and the commands, then the target with where it stands for the mount, what each attempt measured, and the
// settings, collapsed with their summaries. Center and Verify Only are the two actions of this one tool: Center slews only
// when the mount stands farther than a correction may go, which the panel tells before it is confirmed. The target is
// explicit and always shown: nothing replaces it with where the mount points or with the latest solved center. The exposure
// time is this form's; every other camera setting is edited only in Camera Acquisition, and the solver only in Images →
// Plate Solver, both linked from here. The form is the camera's, kept in the profile; the session is the server's, shown
// here whichever tab started it, and keeps running when the panel unmounts. Nothing here commands a device but Center,
// Verify Only, and Stop. A target may also ask for an orientation, the position angle of the image top, typed or taken from
// the latest solved frame of the tab: Verify Only measures it, and Center turns the rotator of the setup toward it.

// Limits of the settings, as the number inputs take them.
const { tolerance: TOLERANCE, maximumCorrections: CORRECTIONS, noSolutionRetries: RETRIES, maximumFrames: FRAMES, settleDelay: SETTLE, maximumCorrection: CORRECTION, orientationTolerance: ORIENTATION_TOLERANCE } = TARGET_CENTERING_LIMITS

// Classes of the session commands: a touch target of 44 px on a coarse pointer, since they are pressed at the mount.
const COMMAND_CLASS = 'pointer-coarse:min-h-[44px]'

// Camera a Target Centering panel works with and the form it edits.
export interface TargetCenteringPanelTarget {
	// Camera, when present on the watched connection.
	readonly device?: DeviceSummary
	// Whether the camera can take frames now, and why not.
	readonly availability: RoleAvailability
	// Mount of the equipment setup and its state.
	readonly mount: RoleDevice
	// Guide output of the equipment setup, which drives the mount; the session coordinates the guiding through it.
	readonly guideOutput: RoleDevice
	// Camera whose form is edited; absent when the profile has no saved connection, so the defaults are shown and nothing is
	// kept.
	readonly settings?: CameraIdentity
	// Rotator of the equipment setup that turns the camera; absent when the camera is not its Main Camera or it has none.
	readonly rotator?: RoleDevice
	// Whether the setup has a Guide Camera and a Rotator and no answer yet whether the guide camera turns with it.
	readonly guideRotationUnanswered?: boolean
	// Image the camera tab shows, whose latest solution can give the orientation; absent without one.
	readonly imageId?: string
}

// Target Centering panel sections of a camera.
export function TargetCenteringSections({ device, availability, mount, guideOutput, settings: identity, rotator, guideRotationUnanswered = false, imageId }: TargetCenteringPanelTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(targetCenteringRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const sky = useSnapshot(skyState)
	const profile = activeProfile(profiles)
	const settings = targetCenteringSettings(profile.settings, identity)
	const exposure = exposureSettings(profile.settings, identity)
	const solving = cameraPlateSolving(profile.settings, identity)
	const { coordinates } = imageAstrometrySettings(profile.settings)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const running = targetCenteringRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const locked = running || pending
	// The target being typed stays across reloads of the tab.
	const draft: TargetCenteringDraft | undefined = key ? runtime.drafts[key] : undefined
	// While running, the panel shows the target and the values the session applied.
	const shownTarget: TargetCenteringDraft | undefined = running && session ? session.request.target : draft
	const shown: Readonly<TargetCenteringSettings> = running && session ? appliedSettings(session, settings) : settings
	const acquisition = running && session ? session.request.capture : exposure
	// The mount is named by the device the setup assigns, or by its role while none is.
	const mountAvailability = mount.device ? deviceAvailability(mount.device.name, mount, operations) : roleAvailability('MOUNT', mount, operations)
	// Recomputed with every state the mount reports, so the altitude follows the sky while the panel is open.
	const position = targetCenteringPosition(mountState, shownTarget, Date.now())
	const rotatorAvailability = rotator && (rotator.device ? deviceAvailability(rotator.device.name, rotator, operations) : roleAvailability('ROTATOR', rotator, operations))
	const rotation = { ...(rotatorAvailability && { rotator: rotatorAvailability }), guideRotationUnanswered }
	const centerBlocker = running ? undefined : targetCenteringBlocker('center', availability, mountAvailability, mountState, draft, position, rotation)
	const verifyBlocker = running ? undefined : targetCenteringBlocker('verifyOnly', availability, mountAvailability, mountState, draft, position, rotation)
	// Latest solution of the frame the tab shows, whose orientation the form can take.
	const latest = usePlateSolution(imageId).solution
	const latestAngle = latest && imageTopPositionAngle(latest, (latest.widthInPixels + 1) / 2, (latest.heightInPixels + 1) / 2)
	// Saved framings, whose rotation is the position angle of the image top they plan; the Equipment Setup's are never saved.
	const framingsSnapshot = useSnapshot(framingsState)
	const framings = sortedFramings(framingsSnapshot)
	const [framingId, setFramingId] = useState<string>()
	const framing = framings.find(({ id }) => id === framingId) ?? framings[0]
	// Mount whose own page fixes the blocker (disconnected, no site, parked, no tracking), rather than the equipment setup.
	const blockingMount = !running && availability.status === 'ready' && mountAvailability.status !== 'notSelected' && mountAvailability.status !== 'busy' && targetCenteringMountBlocker('center', mountAvailability, mountState) !== undefined ? mount.device : undefined
	const catalog = catalogTarget(sky.selection)
	const mountDevice = mount.device && { connectionId: mount.device.connectionId, deviceId: mount.device.id }
	const mountName = mount.device?.name ?? 'The mount'
	const guided = guideOutput.device !== undefined
	const stale = session !== undefined && targetCenteringStale(session, draft)

	// Updates fields of the camera's form.
	function update(patch: Partial<TargetCenteringSettings>) {
		setTargetCenteringSettings(profileState, identity, patch)
	}

	// Replaces the target being edited, clearing a refusal that spoke for the previous one.
	function edit(next: TargetCenteringDraft) {
		if (key) setTargetCenteringDraft(targetCenteringRuntime, key, next)
	}

	function run(mode: 'center' | 'verifyOnly') {
		if (!device || !mountDevice || draft?.rightAscension === undefined || draft.declination === undefined) return
		const { rightAscension, declination, label } = draft
		const positionAngle = draft.oriented ? draft.positionAngle : undefined
		const devices = {
			mount: mountDevice,
			...(guideOutput.device && { guideOutput: { connectionId: guideOutput.device.connectionId, deviceId: guideOutput.device.id } }),
			...(rotator?.device && { rotator: { connectionId: rotator.device.connectionId, deviceId: rotator.device.id } }),
		}
		void startTargetCentering(targetCenteringRuntime, device.connectionId, device.id, targetCenteringRequest(mode, { rightAscension, declination, label, positionAngle }, settings, exposure, solving, devices, capabilities))
	}

	return (
		<>
			<CollapsibleSection id="images.target-centering.session" title={running ? 'Current Session' : session ? 'Last Session' : 'Session'} summary={session && targetCenteringStateText(session)}>
				{session && <SessionState session={session} style={coordinates} />}
				{stale && <Notice>This result is for the previous target; Center or Verify Only measures the one entered now.</Notice>}
				<div className="flex flex-wrap gap-2">
					{running ? (
						<Button
							variant="secondary"
							className={COMMAND_CLASS}
							title={session!.state === 'blocked' ? 'Dismiss the session; check the mount first' : 'Stop the session and the mount'}
							disabled={pending || session!.state === 'stopping'}
							onClick={() => void stopTargetCentering(targetCenteringRuntime, session!)}
						>
							{session!.state === 'blocked' ? 'Dismiss' : session!.state === 'stopping' ? 'Stopping…' : 'Stop'}
						</Button>
					) : (
						<>
							<ConfirmButton
								variant="primary"
								className={COMMAND_CLASS}
								disabled={centerBlocker !== undefined || pending}
								tooltip={centerBlocker}
								title={`Center ${draft?.label ?? 'the target'} with ${mountName}?`}
								confirmLabel="Center"
								onConfirm={() => run('center')}
								message={<CenterMessage mountName={mountName} draft={draft} position={position} settings={settings} guided={guided} style={coordinates} rotatorName={draft?.oriented ? rotator?.device?.name : undefined} />}
							>
								Center
							</ConfirmButton>
							<Button variant="secondary" className={COMMAND_CLASS} title={verifyBlocker ?? 'Expose and solve to measure the distance; the mount is not moved'} disabled={verifyBlocker !== undefined || pending} onClick={() => run('verifyOnly')}>
								Verify Only
							</Button>
						</>
					)}
				</div>
				{!running && <BlockerNotice center={centerBlocker} verify={verifyBlocker} maximumCorrection={settings.maximumCorrection} />}
				{!running && mountAvailability.status === 'notSelected' && <EquipmentSetupButton />}
				{blockingMount && (
					<LinkButton className="self-start text-xs" onClick={() => navigate(routeState, { workspace: 'equipment', device: blockingMount.id })}>
						Open {blockingMount.name} in Equipment Control
					</LinkButton>
				)}
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="images.target-centering.target" title="Target" summary={shownTarget?.label ?? targetText(shownTarget, coordinates)}>
				<AngleField label="RA (J2000)" hour value={shownTarget?.rightAscension} placeholder="Such as 10h 45m 03s" disabled={locked} onChange={(rightAscension) => edit({ ...draft, rightAscension })} />
				<AngleField label="Dec (J2000)" value={shownTarget?.declination} placeholder="Such as -59° 41′ 04″" disabled={locked} onChange={(declination) => edit({ ...draft, declination })} />
				<Actions>
					<Button
						variant="secondary"
						disabled={locked || typeof catalog === 'string'}
						title={typeof catalog === 'string' ? catalog : undefined}
						onClick={() => typeof catalog !== 'string' && catalog.source === 'sky' && edit({ ...draft, rightAscension: catalog.rightAscension, declination: catalog.declination, label: catalog.name })}
					>
						Use Sky Selection
					</Button>
				</Actions>
				{(shownTarget?.label || position) && (
					<DataList>
						{shownTarget?.label && <DataRow label="Object">{shownTarget.label}</DataRow>}
						{position && (
							<DataRow label="Altitude" tone={position.altitude < 0 ? 'danger' : 'default'} title="Geometric altitude at the site the mount reports, now">
								{position.altitude < 0 ? `${formatDegrees(position.altitude)} · below the horizon` : formatDegrees(position.altitude)}
							</DataRow>
						)}
						{position && (
							<DataRow label="From the Mount" title="Distance from where the mount reports it points">
								{formatAngularSize(position.distance)}
							</DataRow>
						)}
					</DataList>
				)}
				<Notice>Positions are J2000, without proper motion. Solar-system bodies move, so they cannot be targets yet.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.target-centering.orientation" title="Orientation" summary={orientationText(running && session ? session.request.orientation?.positionAngle : draft?.oriented ? draft.positionAngle : undefined)} defaultOpen={false}>
				<Checkbox label="Set orientation" checked={running && session ? session.request.orientation !== undefined : draft?.oriented === true} disabled={locked} onChange={(oriented) => edit({ ...draft, oriented, positionAngle: draft?.positionAngle ?? 0 })} />
				{(running && session ? session.request.orientation !== undefined : draft?.oriented) && (
					<>
						<NumberInput
							label="PA of Image Top (N→E)"
							value={toDeg((running && session ? session.request.orientation?.positionAngle : draft?.positionAngle) ?? 0)}
							min={0}
							max={359.99}
							step={0.1}
							suffix="°"
							disabled={locked}
							onChange={(angle) => edit({ ...draft, positionAngle: deg(angle), orientationSource: undefined })}
						/>
						{!running && draft?.orientationSource && <p className="m-0 text-xs leading-4 text-ink-300">From {draft.orientationSource}</p>}
						<Actions>
							<Button
								variant="secondary"
								disabled={locked || latestAngle === undefined}
								title={latestAngle === undefined ? 'The frame shown has no solution' : undefined}
								onClick={() => latestAngle !== undefined && edit({ ...draft, positionAngle: latestAngle, orientationSource: 'the latest solved frame' })}
							>
								Use Latest Solved Frame
							</Button>
						</Actions>
						{framing && (
							<>
								<Select label="Framing" options={framings.map(({ id }) => id)} value={framing.id} format={(id) => framingLabel(framings.find((each) => each.id === id))} disabled={locked} onChange={setFramingId} />
								<Actions>
									<Button variant="secondary" disabled={locked} title="Takes the rotation of the framing as the position angle of the image top" onClick={() => edit({ ...draft, positionAngle: framingAngle(framing.rotation), orientationSource: `framing ${framing.name}` })}>
										Use Framing
									</Button>
								</Actions>
							</>
						)}
						{latest?.parity === 'FLIPPED' && <Notice warning>The frame shown is mirrored. A position angle taken from Framing describes an unmirrored field.</Notice>}
						<Notice>{rotator?.device ? `Center turns ${rotator.device.name}; Verify Only measures without turning it.` : 'Verify Only measures the orientation; Center needs a Rotator in the Equipment Setup.'} Take flats after the final framing: a rotation turns the camera on the telescope.</Notice>
					</>
				)}
			</CollapsibleSection>
			{session && session.attempts.length > 0 && <Diagnostics session={session} />}
			<CollapsibleSection id="images.target-centering.settings" title="Centering Settings" summary={`${shown.tolerance}″ · ${shown.maximumCorrections} corrections · settle ${shown.settleDelay} s`} defaultOpen={false}>
				<NumberInput label="Tolerance" value={shown.tolerance} min={TOLERANCE[0]} max={TOLERANCE[1]} step={1} suffix="″" disabled={locked} onChange={(tolerance) => update({ tolerance })} />
				<NumberInput label="Corrections" value={shown.maximumCorrections} min={CORRECTIONS[0]} max={CORRECTIONS[1]} step={1} disabled={locked} onChange={(maximumCorrections) => update({ maximumCorrections })} />
				<NumberInput label="Settle Time" value={shown.settleDelay} min={SETTLE[0]} max={SETTLE[1]} step={0.5} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
				<Checkbox label="Stop guiding for the motion and restore it after, recalibrating" checked={shown.coordinateGuiding} disabled={locked} onChange={(coordinateGuiding) => update({ coordinateGuiding })} />
				<NumberInput label="PA Tolerance" value={shown.orientationTolerance} min={ORIENTATION_TOLERANCE[0]} max={ORIENTATION_TOLERANCE[1]} step={0.05} suffix="°" disabled={locked} onChange={(orientationTolerance) => update({ orientationTolerance })} />
				<Checkbox label="Allow 180° flip: a PA and the one opposite frame the same field" checked={shown.halfTurn} disabled={locked} onChange={(halfTurn) => update({ halfTurn })} />
			</CollapsibleSection>
			<CollapsibleSection id="images.target-centering.advanced" title="Advanced" summary={`≤${shown.maximumCorrection}° · ${shown.maximumFrames} frames`} defaultOpen={false}>
				<NumberInput label="Largest Correction" value={shown.maximumCorrection} min={CORRECTION[0]} max={CORRECTION[1]} step={0.1} suffix="°" disabled={locked} onChange={(maximumCorrection) => update({ maximumCorrection })} />
				<Notice>Center slews first only when the mount stands farther from the target than this, and refuses a larger correction.</Notice>
				<NumberInput label="Frames" value={shown.maximumFrames} min={FRAMES[0]} max={FRAMES[1]} step={1} disabled={locked} onChange={(maximumFrames) => update({ maximumFrames })} />
				<NumberInput label="Retries Without a Solution" value={shown.noSolutionRetries} min={RETRIES[0]} max={RETRIES[1]} step={1} disabled={locked} onChange={(noSolutionRetries) => update({ noSolutionRetries })} />
				<Checkbox label="Search the whole sky after an assisted solve finds nothing" checked={shown.blindRetry} disabled={locked} onChange={(blindRetry) => update({ blindRetry })} />
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.target-centering.acquisition"
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
				id="images.target-centering.plate-solving"
				device={device}
				solving={running && session ? session.request.solving : solving}
				defaultOpen={false}
				description={(solver, assisted) => (
					<>
						Each frame is solved by the {solver} solver, {assisted ? 'searching around the position in its header, or around the target once the mount was sent there' : 'searching the whole sky'}; the offset of the solution from the target is the next correction.
						{assisted && shown.blindRetry && ' A frame left unsolved is searched again over the whole sky.'}
					</>
				)}
			/>
			<CollapsibleSection id="images.target-centering.equipment" title="Equipment" summary={mount.device?.name ?? 'No mount'} defaultOpen={false}>
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</DataRow>
					<DataRow label="Guide Output">
						<DeviceLink device={guideOutput.device} fallback="None" />
					</DataRow>
				</DataList>
			</CollapsibleSection>
		</>
	)
}

// Formats an altitude in radians as degrees to a tenth.
function formatDegrees(angle: number) {
	return `${formatFixed(toDeg(angle), 1)}°`
}

// Returns the option of a framing in the picker: its name and rotation.
function framingLabel(framing: { readonly name: string; readonly rotation: number } | undefined) {
	return framing ? `${framing.name} · PA ${formatFixed(framing.rotation, 1)}°` : ''
}

// Returns the summary of an orientation: its position angle in degrees, or Off without one.
function orientationText(positionAngle: number | undefined) {
	return positionAngle === undefined ? 'Off' : `PA ${formatFixed(toDeg(positionAngle), 2)}°`
}

// Returns a target as its coordinates, or undefined while it is incomplete.
function targetText(target: TargetCenteringDraft | undefined, style: CoordinateStyle) {
	if (target?.rightAscension === undefined || target.declination === undefined) return undefined
	return `RA ${formatRightAscensionAs(target.rightAscension, style)}, Dec ${formatDeclinationAs(target.declination, style)}`
}

interface CenterMessageProps {
	// Name of the mount that moves.
	readonly mountName: string
	// Target being centered.
	readonly draft?: TargetCenteringDraft
	// Where the target stands for the mount now; absent while unknown.
	readonly position?: TargetCenteringPosition
	// Form the session will run with.
	readonly settings: Readonly<TargetCenteringSettings>
	// Whether the setup has a guide output, whose guiding the session coordinates.
	readonly guided: boolean
	// Style of the coordinates.
	readonly style: CoordinateStyle
	// Name of the rotator turned toward the orientation; absent without one.
	readonly rotatorName?: string
}

// Confirmation of a Center: whether the mount slews or is only corrected, and how far; the altitude of the target; the
// rotation toward an orientation; what becomes of guiding; and what the operator answers for.
function CenterMessage({ mountName, draft, position, settings, guided, style, rotatorName }: CenterMessageProps) {
	const coordinates = targetText(draft, style)
	const target = draft?.label ? `${draft.label} (${coordinates} J2000)` : coordinates ? `${coordinates} (J2000)` : 'the target'
	const maximumCorrection = settings.maximumCorrection * (Math.PI / 180)
	const slews = targetCenteringSlews(position, maximumCorrection)
	const motion = !position
		? `${mountName} slews to ${target} first; the GoTo may turn it to the other pier side.`
		: slews
			? `${mountName} stands ${formatAngularSize(position.distance)} from ${target}, so it slews there first; the GoTo may turn it to the other pier side.`
			: `${mountName} stands ${formatAngularSize(position.distance)} from ${target}, within the ${settings.maximumCorrection}° a correction may go, so it does not slew.`
	const guiding = !guided ? undefined : settings.coordinateGuiding ? 'Guiding is stopped for the motion and restored after, recalibrated.' : 'Guiding is not touched: the session is refused while it may pulse the mount.'

	return (
		<div className="flex flex-col gap-2">
			<p className="m-0">{motion}</p>
			<p className="m-0">
				Plate solved frames then correct it until the target is within {settings.tolerance}″.{position && ` The target stands ${formatDegrees(position.altitude)} above the horizon.`}
			</p>
			{rotatorName && draft?.positionAngle !== undefined && (
				<p className="m-0">
					{rotatorName} turns the camera until the image top is at PA {formatFixed(toDeg(draft.positionAngle), 2)}°{settings.halfTurn ? ` or ${formatFixed((toDeg(draft.positionAngle) + 180) % 360, 2)}°` : ''}, within {settings.orientationTolerance}°.
				</p>
			)}
			{guiding && <p className="m-0">{guiding}</p>}
			<p className="m-0">Nebulosa does not know about cables, obstacles, or roofs: make sure it is clear to move. Sync is never used.</p>
		</div>
	)
}

interface BlockerNoticeProps {
	// Why Center cannot start; absent when it can.
	readonly center?: string
	// Why Verify Only cannot start; absent when it can.
	readonly verify?: string
	// Largest correction of the form, in degrees.
	readonly maximumCorrection: number
}

// The one line under the commands: why they cannot start, that Verify Only still works when only Center cannot, or, when
// both can, what each one moves.
function BlockerNotice({ center, verify, maximumCorrection }: BlockerNoticeProps) {
	if (center && verify) return <Notice>{center}</Notice>
	if (center) return <Notice>{`${center} Verify Only still works: it moves nothing.`}</Notice>
	return <Notice>Center slews only when the mount stands farther than {maximumCorrection}° from the target, then corrects from plate solved frames. Verify Only measures without moving the mount.</Notice>
}

// The form values a running session applied, as the form shows them.
function appliedSettings({ request }: Pick<TargetCenteringSessionSummary, 'request'>, settings: Readonly<TargetCenteringSettings>): TargetCenteringSettings {
	const { capture, tolerance, maximumCorrections, noSolutionRetries, maximumFrames, settleDelay, maximumCorrection, blindRetry, guiding, orientation } = request
	const oriented = orientation && { orientationTolerance: toDeg(orientation.tolerance), halfTurn: orientation.halfTurn }
	return { ...settings, exposureTime: capture.exposureTime, tolerance: toArcsec(tolerance), maximumCorrections, noSolutionRetries, maximumFrames, settleDelay, maximumCorrection: toDeg(maximumCorrection), blindRetry, coordinateGuiding: guiding === 'coordinate', ...oriented }
}

// State of the session as a verdict, its target in a coordinate style, the frames and the measured distance, the progress
// of the frame being exposed, and how it left guiding and imaging.
function SessionState({ session, style }: { readonly session: TargetCenteringSessionSummary; readonly style: CoordinateStyle }) {
	const { state, step, exposure, finalSeparation, finalPositionAngleError, positionVerified, orientationVerified, readyForImaging, guidingRestoration, error, warnings, request, endedAt, rotatorName, senseSource } = session
	const ended = endedAt !== undefined
	const target = request.target.label ?? targetText(request.target, style)

	return (
		<>
			<SessionStateText failed={state === 'blocked' || state === 'failed'} succeeded={state === 'completed' && readyForImaging}>
				{targetCenteringStateText(session)}
			</SessionStateText>
			<DataList>
				<DataRow label={request.mode === 'verifyOnly' ? 'Measuring' : 'Centering'}>{target}</DataRow>
				<DataRow label="Frames">{`${targetCenteringFrameCount(session)} of ${request.maximumFrames}`}</DataRow>
				<DataRow label="Distance">{finalSeparation === undefined ? MISSING : formatAngularSize(finalSeparation)}</DataRow>
				{request.orientation && <DataRow label="PA Error">{finalPositionAngleError === undefined ? MISSING : formatSignedDegrees(finalPositionAngleError)}</DataRow>}
				{ended && state === 'completed' && (
					<DataRow label="Position" tone={positionVerified ? 'success' : 'warning'}>
						{positionVerified ? 'Verified' : 'Not verified'}
					</DataRow>
				)}
				{ended && state === 'completed' && request.orientation && (
					<DataRow label="Orientation" tone={orientationVerified ? 'success' : 'warning'}>
						{orientationVerified ? 'Verified' : 'Not verified'}
					</DataRow>
				)}
				{rotatorName && <DataRow label="Rotator">{rotatorName}</DataRow>}
				{guidingRestoration !== 'notNeeded' && (
					<DataRow label="Guiding" tone={guidingRestoration === 'restored' ? 'default' : 'warning'}>
						{TARGET_CENTERING_GUIDING_LABELS[guidingRestoration]}
					</DataRow>
				)}
				{ended && (
					<DataRow label="Ready for Imaging" tone={readyForImaging ? 'success' : 'default'}>
						{readyForImaging ? 'Yes' : 'No'}
					</DataRow>
				)}
			</DataList>
			{step === 'exposing' && <FrameProgress exposure={exposure} />}
			{error && <Notice error>{error}</Notice>}
			{warnings.length > 0 && <Notice warning>{warnings.at(-1)}</Notice>}
			{senseSource && senseSource !== 'stored' && <Notice>{`Rotation sense of ${rotatorName ?? 'the rotator'}: ${TARGET_CENTERING_SENSE_SOURCE_LABELS[senseSource]}.`}</Notice>}
		</>
	)
}

// Columns of the attempts of a session: distances and offsets, in angles, aligned to the end; a frame without a
// solution says what became of it in place of its distance.
const DIAGNOSTIC_COLUMNS: readonly TableColumn[] = ['#', { key: 'distance', label: 'Distance', numeric: true }, { key: 'east', label: 'East', numeric: true }, { key: 'north', label: 'North', numeric: true }]

// Columns of the attempts of a session with an orientation: those of DIAGNOSTIC_COLUMNS, then the measured position angle,
// its error, and the mechanical angle of the rotator during the exposure.
const ORIENTED_DIAGNOSTIC_COLUMNS: readonly TableColumn[] = [...DIAGNOSTIC_COLUMNS, { key: 'pa', label: 'PA', numeric: true }, { key: 'paError', label: 'PA Error', numeric: true }, { key: 'rotator', label: 'Rotator', numeric: true }]

// What each attempt of a session measured, in order, with the model that corrected its first slew.
function Diagnostics({ session: { attempts, model, request, finalSeparation } }: { readonly session: TargetCenteringSessionSummary }) {
	const solved = attempts.filter(({ outcome }) => outcome === 'solved').length

	return (
		<CollapsibleSection id="images.target-centering.diagnostics" title="Diagnostics" summary={`${solved} solved${finalSeparation === undefined ? '' : ` · ${formatAngularSize(finalSeparation)}`}`} defaultOpen={false}>
			<TargetCenteringBullseye attempts={attempts} tolerance={request.tolerance} />
			<Table columns={request.orientation ? ORIENTED_DIAGNOSTIC_COLUMNS : DIAGNOSTIC_COLUMNS}>
				{attempts.map(({ attempt, outcome, separation, dx, dy, error, positionAngle, positionAngleError, rotatorAngle, rotation }) => (
					<Row key={attempt} title={[error, rotation && `Rotated ${formatFixed(rotation.from, 2)}° → ${formatFixed(rotation.to, 2)}°`].filter(Boolean).join(' · ') || undefined}>
						<Cell>{attempt}</Cell>
						<Cell numeric>{separation !== undefined ? formatAngularSize(separation) : outcome ? TARGET_CENTERING_OUTCOME_LABELS[outcome] : 'Pending'}</Cell>
						<Cell numeric>{dx === undefined ? MISSING : formatSignedAngle(dx)}</Cell>
						<Cell numeric>{dy === undefined ? MISSING : formatSignedAngle(dy)}</Cell>
						{request.orientation && <Cell numeric>{positionAngle === undefined ? MISSING : `${formatFixed(toDeg(positionAngle), 2)}°`}</Cell>}
						{request.orientation && <Cell numeric>{positionAngleError === undefined ? MISSING : formatSignedDegrees(positionAngleError)}</Cell>}
						{request.orientation && <Cell numeric>{rotatorAngle === undefined ? MISSING : `${formatFixed(rotatorAngle, 2)}°${rotation ? ` → ${formatFixed(rotation.to, 2)}°` : ''}`}</Cell>}
					</Row>
				))}
			</Table>
			<DataList>
				<DataRow label="Pointing Model">{model ? model.revisionId : 'None applied'}</DataRow>
			</DataList>
			<Notice>Offsets are those of the solved center from the target, on the sky: they are not turned with the image.{request.orientation && ' The PA is that of the image top at the pixel of the target; the rotator angle is mechanical.'}</Notice>
		</CollapsibleSection>
	)
}
