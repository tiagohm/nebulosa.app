import type { DeviceSummary, TargetCenteringMode, TargetCenteringSessionSummary } from 'api'
import { cn } from 'cn'
import { normalizeAngle, toArcsec } from 'nebulosa/src/math/units/angle'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { Actions, ConfirmButton, Notice } from '../equipment-control/parts'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { deviceState } from '../equipment/equipment'
import type { RoleDevice } from '../equipment/useEquipment'
import { cameraTabKey } from '../images/cameratabs'
import { imagesState, selectImageTool } from '../images/images'
import { operationsState } from '../operations'
import { CameraPlateSolvingSection } from '../platesolving/CameraPlateSolvingSection'
import { type CoordinateStyle, formatAngularSize, formatDeclinationAs, formatRightAscensionAs, formatSignedAngle, MISSING } from '../platesolving/coordinates'
import { catalogTarget } from '../platesolving/measurement'
import { AngleField, useSolverConfigured } from '../platesolving/PlateSolveControls'
import { activeProfile, cameraPlateSolving, deleteFramingReference, exposureSettings, framingReferences, imageAstrometrySettings, profileState, renameFramingReference, saveFramingReference, setTargetCenteringSettings, targetCenteringSettings } from '../profile/profile'
import { type CameraIdentity, FRAMING_REFERENCES_MAXIMUM, TARGET_CENTERING_LIMITS, type TargetCenteringSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { skyState } from '../sky/sky'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { CameraSummary, SummaryRow as Row } from './CameraSummary'
import { cameraKey } from './capture'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'
import {
	startTargetCentering,
	stopTargetCentering,
	TARGET_CENTERING_GUIDING_LABELS,
	TARGET_CENTERING_STATE_LABELS,
	TARGET_CENTERING_STEP_LABELS,
	targetCenteringBlocker,
	type TargetCenteringDraft,
	targetCenteringMountSupport,
	targetCenteringRequest,
	targetCenteringRunning,
	targetCenteringRuntime,
	targetCenteringVerdict,
} from './targetcentering'
import { TargetCenteringBullseye } from './TargetCenteringBullseye'

// Contextual panel sections of Target Centering, a camera operation of the Images camera tabs: the target, the settings of
// the run, the equipment and the frames, the session, and what each attempt measured. Center, Recenter, and Verify Only are
// actions of this one tool. The target is explicit and always shown: nothing replaces it with where the mount points or with
// the latest solved center. The exposure time is this form's; every other camera setting is edited only in Camera
// Acquisition, and the solver only in Images → Plate Solver, both linked from here. The form is the camera's, kept in the
// profile with the saved framings; the session is the server's, shown here whichever tab started it, and keeps running when
// the panel unmounts. Nothing here commands a device but Center, Recenter, Verify Only, and Stop.

// Limits of the settings, as the number inputs take them.
const { tolerance: TOLERANCE, maximumCorrections: CORRECTIONS, noSolutionRetries: RETRIES, maximumFrames: FRAMES, settleDelay: SETTLE, maximumCorrection: CORRECTION } = TARGET_CENTERING_LIMITS

// Camera a Target Centering panel works with and the form it edits.
export interface TargetCenteringPanelTarget {
	// Camera, when present on the watched connection.
	readonly device?: DeviceSummary
	// Whether the camera can take frames now, and why not.
	readonly availability: RoleAvailability
	// Mount of the equipment setup and its state.
	readonly mount: RoleDevice
	// Camera whose form is edited; absent when the profile has no saved connection, so the defaults are shown and nothing is
	// kept.
	readonly settings?: CameraIdentity
}

// Target Centering panel sections of a camera.
export function TargetCenteringSections({ device, availability, mount, settings: identity }: TargetCenteringPanelTarget) {
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
	const configured = useSolverConfigured(solving.provider)
	const references = framingReferences(profile.settings)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const running = targetCenteringRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const locked = running || pending
	const framing = references.find((reference) => reference.id === settings.framingId)
	// A framing stays selected across reloads, while the target being typed is tab memory.
	const draft: TargetCenteringDraft | undefined = (key ? runtime.drafts[key] : undefined) ?? (framing && { rightAscension: framing.rightAscension, declination: framing.declination, label: framing.name })
	// While running, the panel shows the target and the values the session applied.
	const shownTarget: TargetCenteringDraft | undefined = running && session ? session.request.target : draft
	const shown: Readonly<TargetCenteringSettings> = running && session ? appliedSettings(session, settings) : settings
	const [name, setName] = useState('')
	const mountAvailability = roleAvailability('MOUNT', mount, operations)
	const blockerOf = (mode: TargetCenteringMode) => (running ? undefined : targetCenteringBlocker(mode, availability, mountAvailability, mountState, draft, framing?.id, configured))
	const catalog = catalogTarget(sky.selection)
	const mountDevice = mount.device && { connectionId: mount.device.connectionId, deviceId: mount.device.id }
	const mountName = mount.device?.name ?? 'The mount'
	const canSave = !locked && draft?.rightAscension !== undefined && draft.declination !== undefined && name.trim() !== '' && references.length < FRAMING_REFERENCES_MAXIMUM

	// Updates fields of the camera's form.
	function update(patch: Partial<TargetCenteringSettings>) {
		setTargetCenteringSettings(profileState, identity, patch)
	}

	// Replaces the target being edited, which no longer is the selected framing.
	function edit(next: TargetCenteringDraft, framingId?: string) {
		if (key) targetCenteringRuntime.drafts[key] = next
		update({ framingId })
	}

	// Selects a saved framing, or none, keeping the target being edited.
	function load(id: string) {
		const reference = references.find((each) => each.id === id)
		edit(reference ? { rightAscension: reference.rightAscension, declination: reference.declination, label: reference.name } : (draft ?? {}), reference?.id)
	}

	function save() {
		if (draft?.rightAscension === undefined || draft.declination === undefined) return
		const saved = saveFramingReference(profileState, { name, rightAscension: normalizeAngle(draft.rightAscension), declination: draft.declination, source: draft.label === undefined ? 'manual' : 'sky' })

		if (saved) {
			edit({ ...draft, label: saved.name }, saved.id)
			setName('')
		}
	}

	function run(mode: TargetCenteringMode) {
		if (!device || !mountDevice || draft?.rightAscension === undefined || draft.declination === undefined) return
		const { rightAscension, declination, label } = draft
		void startTargetCentering(targetCenteringRuntime, device.connectionId, device.id, targetCenteringRequest(mode, { rightAscension, declination, label }, settings, exposure, solving, mountDevice, capabilities))
	}

	return (
		<>
			<CollapsibleSection id="images.target-centering.target" title="Target" summary={shownTarget?.label}>
				{references.length > 0 && <Select label="Saved Framing" options={['', ...references.map((reference) => reference.id)]} value={framing?.id ?? ''} format={(id) => references.find((reference) => reference.id === id)?.name ?? 'None'} disabled={locked} onChange={load} />}
				<AngleField label="RA (J2000)" hour value={shownTarget?.rightAscension} placeholder="Such as 10h 45m 03s" disabled={locked} onChange={(rightAscension) => edit({ rightAscension, declination: draft?.declination })} />
				<AngleField label="Dec (J2000)" value={shownTarget?.declination} placeholder="Such as -59° 41′ 04″" disabled={locked} onChange={(declination) => edit({ rightAscension: draft?.rightAscension, declination })} />
				<Actions>
					<Button
						variant="secondary"
						disabled={locked || typeof catalog === 'string'}
						title={typeof catalog === 'string' ? catalog : undefined}
						onClick={() => typeof catalog !== 'string' && catalog.source === 'sky' && edit({ rightAscension: catalog.rightAscension, declination: catalog.declination, label: catalog.name })}
					>
						Use Sky Selection
					</Button>
				</Actions>
				{shownTarget?.label && <p className="m-0 text-xs leading-4 text-ink-300">{shownTarget.label}</p>}
				<TextInput label="Framing Name" value={name} disabled={locked} onChange={(event) => setName(event.target.value)} />
				<Actions>
					<Button variant="secondary" disabled={!canSave} onClick={save}>
						Save Framing
					</Button>
					{framing && (
						<>
							<Button variant="secondary" disabled={locked || name.trim() === ''} onClick={() => renameFramingReference(profileState, framing.id, name) && setName('')}>
								Rename
							</Button>
							<ConfirmButton variant="secondary" disabled={locked} title="Delete the framing" confirmLabel="Delete" onConfirm={() => deleteFramingReference(profileState, framing.id)} message={`The saved framing ${framing.name} will be deleted. Nothing is sent to the mount.`}>
								Delete
							</ConfirmButton>
						</>
					)}
				</Actions>
				<Notice>Catalog positions are J2000, epoch J2000.0, without proper motion. Solar-system bodies move, so they cannot be targets yet.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.target-centering.settings" title="Centering Settings">
				<NumberInput label="Tolerance" value={shown.tolerance} min={TOLERANCE[0]} max={TOLERANCE[1]} step={1} suffix="″" disabled={locked} onChange={(tolerance) => update({ tolerance })} />
				<NumberInput label="Corrections" value={shown.maximumCorrections} min={CORRECTIONS[0]} max={CORRECTIONS[1]} step={1} disabled={locked} onChange={(maximumCorrections) => update({ maximumCorrections })} />
				<NumberInput label="Settle Time" value={shown.settleDelay} min={SETTLE[0]} max={SETTLE[1]} step={0.5} suffix="s" disabled={locked} onChange={(settleDelay) => update({ settleDelay })} />
			</CollapsibleSection>
			<CollapsibleSection id="images.target-centering.advanced" title="Advanced" defaultOpen={false}>
				<NumberInput label="Largest Correction" value={shown.maximumCorrection} min={CORRECTION[0]} max={CORRECTION[1]} step={0.1} suffix="°" disabled={locked} onChange={(maximumCorrection) => update({ maximumCorrection })} />
				<NumberInput label="Frames" value={shown.maximumFrames} min={FRAMES[0]} max={FRAMES[1]} step={1} disabled={locked} onChange={(maximumFrames) => update({ maximumFrames })} />
				<NumberInput label="Retries Without a Solution" value={shown.noSolutionRetries} min={RETRIES[0]} max={RETRIES[1]} step={1} disabled={locked} onChange={(noSolutionRetries) => update({ noSolutionRetries })} />
				<Checkbox label="Search the whole sky after an assisted solve finds nothing" checked={shown.blindRetry} disabled={locked} onChange={(blindRetry) => update({ blindRetry })} />
				<Checkbox label="Stop guiding for the motion and restore it after, recalibrating" checked={shown.coordinateGuiding} disabled={locked} onChange={(coordinateGuiding) => update({ coordinateGuiding })} />
			</CollapsibleSection>
			<CollapsibleSection id="images.target-centering.equipment" title="Acquisition & Equipment">
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					<Row label="Camera">
						<DeviceLink device={device} fallback="—" />
					</Row>
					<Row label="Mount">
						<DeviceLink device={mount.device} fallback="Not assigned" />
					</Row>
				</dl>
				{!running && mountAvailability.status !== 'ready' && <Notice>{mountAvailability.message}</Notice>}
				{!running && mountAvailability.status === 'notSelected' && (
					<Button variant="secondary" className="self-start" onClick={() => (deviceState.open = true)}>
						Equipment Setup
					</Button>
				)}
				<ExposureTimeInput value={shown.exposureTime} exposure={capabilities?.exposure} disabled={locked} onChange={(exposureTime) => update({ exposureTime })} />
				<CameraSummary exposure={running && session ? session.request.capture : exposure} capabilities={capabilities} />
				<p className="m-0 text-xs leading-4 text-ink-300">Frames are temporary LIGHT frames, shown as the latest frame of the camera and never saved.</p>
				{device && (
					<Button variant="secondary" className="self-start" onClick={() => selectImageTool(imagesState, cameraTabKey(device.connectionId, device.id), 'camera-acquisition')}>
						Open Acquisition
					</Button>
				)}
			</CollapsibleSection>
			<CameraPlateSolvingSection id="images.target-centering.plate-solving" device={device} solving={running && session ? session.request.solving : solving} />
			<CollapsibleSection id="images.target-centering.session" title="Session">
				{session && <SessionState session={session} />}
				{running ? (
					<Button variant="secondary" disabled={pending || session!.state === 'stopping'} onClick={() => void stopTargetCentering(targetCenteringRuntime, session!)}>
						{session!.state === 'blocked' ? 'Dismiss' : 'Stop'}
					</Button>
				) : (
					<Actions>
						<ConfirmButton variant="primary" disabled={blockerOf('center') !== undefined || pending} title="Center the target" confirmLabel="Center" onConfirm={() => run('center')} message={moveMessage(mountName, draft, coordinates, 'will slew to')}>
							Center
						</ConfirmButton>
						<ConfirmButton variant="secondary" disabled={blockerOf('recenter') !== undefined || pending} title="Recenter the framing" confirmLabel="Recenter" onConfirm={() => run('recenter')} message={moveMessage(mountName, draft, coordinates, 'will be corrected, or slewed when it stands far, towards')}>
							Recenter
						</ConfirmButton>
						<Button variant="secondary" disabled={blockerOf('verifyOnly') !== undefined || pending} onClick={() => run('verifyOnly')}>
							Verify Only
						</Button>
					</Actions>
				)}
				{!running && blockerOf('center') && <Notice>{blockerOf('center')}</Notice>}
				{!running && blockerOf('center') === undefined && blockerOf('recenter') && <Notice>{blockerOf('recenter')}</Notice>}
				{!running && targetCenteringMountSupport(mountState) && blockerOf('verifyOnly') === undefined && <Notice>Verify Only still works: it commands nothing.</Notice>}
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
			{session && session.attempts.length > 0 && <Diagnostics session={session} />}
		</>
	)
}

// Returns the confirmation of a motion, naming the mount and the target.
function moveMessage(mountName: string, draft: TargetCenteringDraft | undefined, style: CoordinateStyle, action: string) {
	const target = draft?.rightAscension === undefined || draft.declination === undefined ? 'the target' : `${draft.label ? `${draft.label} at ` : ''}RA ${formatRightAscensionAs(draft.rightAscension, style)}, Dec ${formatDeclinationAs(draft.declination, style)} (J2000)`
	return `${mountName} ${action} ${target}, then corrected from plate solved frames. Nebulosa does not know about cables, obstacles, or roofs: make sure it is clear to move. Sync is never used.`
}

// The form values a running session applied, as the form shows them.
function appliedSettings({ request }: Pick<TargetCenteringSessionSummary, 'request'>, settings: Readonly<TargetCenteringSettings>): TargetCenteringSettings {
	const { capture, tolerance, maximumCorrections, noSolutionRetries, maximumFrames, settleDelay, maximumCorrection, blindRetry, guiding } = request
	return { ...settings, exposureTime: capture.exposureTime, tolerance: toArcsec(tolerance), maximumCorrections, noSolutionRetries, maximumFrames, settleDelay, maximumCorrection: (maximumCorrection * 180) / Math.PI, blindRetry, coordinateGuiding: guiding === 'coordinate' }
}

// State of the session, the attempt and its measured distance, the progress of the frame being exposed, and its outcome.
function SessionState({ session }: { readonly session: TargetCenteringSessionSummary }) {
	const { state, step, attempts, exposure, finalSeparation, positionVerified, readyForImaging, guidingRestoration, error, warnings, request } = session
	const failed = state === 'blocked' || state === 'failed'
	const ended = state === 'completed' || state === 'failed'
	const verdict = targetCenteringVerdict(session)

	return (
		<>
			<p className={cn('m-0', failed ? 'text-danger' : 'text-ink-100')}>
				{TARGET_CENTERING_STATE_LABELS[state]}
				{step && ` · ${TARGET_CENTERING_STEP_LABELS[step]}`}
			</p>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<Row label="Frame">{`${attempts.length} of ${request.maximumFrames}`}</Row>
				<Row label="Distance">{finalSeparation === undefined ? MISSING : formatAngularSize(finalSeparation)}</Row>
				{ended && verdict && <Row label="Latest Frame">{verdict === 'within' ? 'Within tolerance' : 'Outside tolerance'}</Row>}
				{ended && <Row label="Position">{positionVerified ? 'Verified' : 'Not verified'}</Row>}
				{guidingRestoration !== 'notNeeded' && <Row label="Guiding">{TARGET_CENTERING_GUIDING_LABELS[guidingRestoration]}</Row>}
				{ended && <Row label="Ready for Imaging">{readyForImaging ? 'Yes' : 'No'}</Row>}
			</dl>
			{step === 'exposing' && <FrameProgress exposure={exposure} />}
			{error && <p className="m-0 text-xs leading-4 text-danger">{error}</p>}
			{warnings.length > 0 && <p className="m-0 text-xs leading-4 text-ink-300">{warnings.at(-1)}</p>}
		</>
	)
}

// What each attempt of a session measured, in order, with the model that corrected its first slew.
function Diagnostics({ session: { attempts, model, request, provider } }: { readonly session: TargetCenteringSessionSummary }) {
	return (
		<CollapsibleSection id="images.target-centering.diagnostics" title="Diagnostics" defaultOpen={false}>
			<TargetCenteringBullseye attempts={attempts} tolerance={request.tolerance} />
			<table className="w-full border-collapse text-xs tabular-nums">
				<thead className="text-ink-300">
					<tr>
						<th className="text-left font-normal">Frame</th>
						<th className="text-left font-normal">Outcome</th>
						<th className="text-right font-normal">Distance</th>
						<th className="text-right font-normal">East</th>
						<th className="text-right font-normal">North</th>
					</tr>
				</thead>
				<tbody>
					{attempts.map(({ attempt, outcome, separation, dx, dy, error }) => (
						<tr key={attempt} title={error}>
							<td>{attempt}</td>
							<td>{outcome ?? MISSING}</td>
							<td className="text-right">{separation === undefined ? MISSING : formatAngularSize(separation)}</td>
							<td className="text-right">{dx === undefined ? MISSING : formatSignedAngle(dx)}</td>
							<td className="text-right">{dy === undefined ? MISSING : formatSignedAngle(dy)}</td>
						</tr>
					))}
				</tbody>
			</table>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<Row label="Solver">{provider}</Row>
				<Row label="Pointing Model">{model ? model.revisionId : 'None applied'}</Row>
			</dl>
			<Notice>Offsets are those of the solved center from the target, on the sky: they are not turned with the image.</Notice>
		</CollapsibleSection>
	)
}
