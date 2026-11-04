import type { CameraCapabilities, CaptureSnoop, DarkGroup, DarkLibraryWizardGroupRun, DarkLibraryWizardPendingStep, DarkLibraryWizardSessionSummary, DeviceSummary } from 'api'
import { cn } from 'cn'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { Notice } from '../equipment-control/parts'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { deviceState } from '../equipment/equipment'
import type { RoleDevice } from '../equipment/useEquipment'
import { FileExplorerModal } from '../files/FileExplorerModal'
import { operationsState } from '../operations'
import { activeProfile, darkLibraryWizardSettings, exposureSettings, profileState, setDarkLibraryWizardSettings } from '../profile/profile'
import { type CameraIdentity, DARK_LIBRARY_WIZARD_MAXIMUM_COUNT, DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS, DARK_LIBRARY_WIZARD_MAXIMUM_REJECTIONS, DEFAULT_DARK_LIBRARY_WIZARD_GROUP, type DarkLibraryWizardSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { IconButton } from '../ui/IconButton'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import {
	continueDarkLibraryWizard,
	DARK_LIBRARY_WIZARD_STATE_LABELS,
	DARK_SUSPICION_LABELS,
	darkLibraryWizardBlocker,
	darkLibraryWizardCapture,
	darkLibraryWizardDuration,
	darkLibraryWizardEstimate,
	darkLibraryWizardExposureLeft,
	darkLibraryWizardRequest,
	darkLibraryWizardRunning,
	darkLibraryWizardWarning,
	darkLibraryWizardRuntime,
	duplicateDarkGroup,
	pauseDarkLibraryWizard,
	resumeDarkLibraryWizard,
	startDarkLibraryWizard,
	stopDarkLibraryWizard,
} from './darklibrarywizard'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress, formatExposure } from './FrameProgress'

// Contextual panel sections of Dark Library Wizard, a camera operation of the Images camera tabs: the equipment of the tab's
// camera, the capture plan (whether it takes darks or dark-flats, and one row per group), how the light is blocked, the
// thermal protocol, the output and its limits, and the session in progress with its Continue, Pause, Resume, and Stop
// commands. Frames take the gain, offset, binning, subframe, and readout mode of Camera Acquisition, but never its exposure
// time, which each group sets. The form is the camera's, kept in the profile; while a session runs the plan shows what the
// session applied. Sessions are the server's, shown here whichever tab started them, and keep running when the panel
// unmounts. Start asks for no confirmation: a warning above it says what no device verifies, and a later step is confirmed
// only by its button. Every start makes a new plan, which is never listed or reused here; a plan may ask for its masters,
// and browsing, importing, and building them are the Calibration Library's.

// Camera a Dark Library Wizard panel acquires with, the devices of its setup, and the forms it edits.
export interface DarkLibraryWizardTarget {
	// Camera, when present on the watched connection.
	readonly device?: DeviceSummary
	// Whether the camera can take frames now, and why not.
	readonly availability: RoleAvailability
	// Filter wheel of the setup and its state; absent for a camera without a role.
	readonly wheel?: RoleDevice
	// Flat panel of the setup and its state; absent for a camera without a role.
	readonly flatPanel?: RoleDevice
	// Dust cover of the setup and its state; absent for a camera without a role.
	readonly cover?: RoleDevice
	// Camera whose forms are edited; absent when the profile has no saved connection, so the defaults are shown and
	// nothing is kept.
	readonly settings?: CameraIdentity
	// Devices snooped into the frame headers.
	readonly snoop: CaptureSnoop
}

// Kinds of frame a plan takes: ordinary darks, or dark-flats for flats of the same exposure.
const DARK_FRAME_TYPES = ['dark', 'darkFlat'] as const

// Kind of frame a plan takes.
type DarkFrameType = (typeof DARK_FRAME_TYPES)[number]

// Label of each kind of frame.
const DARK_FRAME_TYPE_LABELS: Readonly<Record<DarkFrameType, string>> = { dark: 'Dark', darkFlat: 'Dark-Flat' }

// Formats a size in bytes for an estimate.
function formatBytes(bytes: number) {
	return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

// Returns the label of a group, short enough for a row of the panel; a group without a target names no temperature.
function groupLabel({ exposure, temperature }: Pick<DarkGroup, 'exposure' | 'temperature'>) {
	return `${formatExposure(exposure)}${temperature === undefined ? '' : `, ${temperature} °C`}`
}

// Returns the groups a running session applied, to show while it runs.
function appliedGroups({ groups }: Pick<DarkLibraryWizardSessionSummary, 'groups'>): DarkGroup[] {
	return groups.map(({ exposure, temperature, count }) => ({ exposure, ...(temperature !== undefined && { temperature }), count }))
}

// Dark Library Wizard panel sections of a camera.
export function DarkLibraryWizardSections({ device, availability, wheel, flatPanel, cover, settings: identity, snoop }: DarkLibraryWizardTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(darkLibraryWizardRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const [choosingDirectory, setChoosingDirectory] = useState(false)
	const profile = activeProfile(profiles)
	const settings = darkLibraryWizardSettings(profile.settings, identity)
	const exposure = exposureSettings(profile.settings, identity)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const running = darkLibraryWizardRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const locked = running || pending
	const groups = running && session ? appliedGroups(session) : settings.groups
	const wheelAssigned = wheel !== undefined && wheel.status !== 'notSelected'
	const panelAssigned = flatPanel !== undefined && flatPanel.status !== 'notSelected'
	const coverAssigned = cover !== undefined && cover.status !== 'notSelected'
	const wheelState = wheelAssigned ? watchedDeviceState(control, 'wheel', wheel.device) : undefined
	const coverState = coverAssigned ? watchedDeviceState(control, 'cover', cover.device) : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	const availabilities = {
		camera: availability,
		...(wheelAssigned && { wheel: roleAvailability('FILTER_WHEEL', wheel, operations) }),
		...(panelAssigned && { panel: roleAvailability('FLAT_PANEL', flatPanel, operations) }),
		...(coverAssigned && { cover: roleAvailability('COVER', cover, operations, coverState && !coverState.canPark ? 'The cover cannot be opened and closed.' : undefined) }),
	}
	const blocker = running ? undefined : darkLibraryWizardBlocker(availabilities, settings, wheelState, capabilities)
	const capture = running && session ? session.capture : darkLibraryWizardCapture(exposure, capabilities)
	const estimate = darkLibraryWizardEstimate(groups, capture, capabilities)
	const sensorTemperature = capabilities?.temperature === undefined ? undefined : `${capabilities.temperature.toFixed(1)} °C`
	const warning = darkLibraryWizardWarning(settings)

	// Updates fields of the camera's form.
	function update(patch: Partial<DarkLibraryWizardSettings>) {
		setDarkLibraryWizardSettings(profileState, identity, patch)
	}

	// Updates fields of one group.
	function updateGroup(index: number, patch: Partial<DarkGroup>) {
		update({ groups: settings.groups.map((group, i) => (i === index ? { ...group, ...patch } : group)) })
	}

	// Moves a group one row up or down; a temperature's groups run in the order they have here.
	function moveGroup(index: number, offset: number) {
		const moved = [...settings.groups]
		const [group] = moved.splice(index, 1)
		moved.splice(index + offset, 0, group)
		update({ groups: moved })
	}

	// Returns the exact ids of the assigned devices.
	function equipment() {
		return {
			...(wheelAssigned && wheel.device && { wheel: { connectionId: wheel.device.connectionId, deviceId: wheel.device.id } }),
			...(panelAssigned && flatPanel.device && { panel: { connectionId: flatPanel.device.connectionId, deviceId: flatPanel.device.id } }),
			...(coverAssigned && cover.device && { cover: { connectionId: cover.device.connectionId, deviceId: cover.device.id } }),
		}
	}

	function start() {
		if (device) void startDarkLibraryWizard(darkLibraryWizardRuntime, device.connectionId, device.id, darkLibraryWizardRequest(settings, exposure, equipment(), snoop, capabilities))
	}

	return (
		<>
			<CollapsibleSection id="images.dark-library-wizard.equipment" title="Equipment">
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} fallback="—" />
					</DataRow>
					<DataRow label="Filter Wheel">{wheelAssigned ? <DeviceLink device={wheel.device} fallback="—" /> : 'Not assigned'}</DataRow>
					<DataRow label="Flat Panel">{panelAssigned ? <DeviceLink device={flatPanel.device} fallback="—" /> : 'Not assigned'}</DataRow>
					<DataRow label="Cover">{coverAssigned ? <DeviceLink device={cover.device} fallback="—" /> : 'Not assigned'}</DataRow>
				</DataList>
				{!running && (!wheelAssigned || !panelAssigned || !coverAssigned) && wheel !== undefined && (
					<Button variant="secondary" className="self-start" onClick={() => (deviceState.open = true)}>
						Equipment Setup
					</Button>
				)}
				{wheel === undefined && <Notice>Only the Main Camera of the equipment setup uses its filter wheel, flat panel, and cover, so for this camera only a manual cap can block the light.</Notice>}
				<Notice>The cover closes before the first frame and opens again when the session ends, unless it was already closed.</Notice>
			</CollapsibleSection>
			<CameraAcquisitionSection id="images.dark-library-wizard.acquisition" device={device} exposure={capture} capabilities={capabilities} description="Frames are raw DARK frames taken with the camera settings of Camera Acquisition; each group of the Capture Plan sets its exposure." />
			<CollapsibleSection id="images.dark-library-wizard.plan" summary={`${groups.length} groups`} title="Capture Plan">
				<SegmentedControl label="Frame Type" options={DARK_FRAME_TYPES} value={settings.purpose ?? 'dark'} format={(type) => DARK_FRAME_TYPE_LABELS[type]} disabled={locked} onChange={(type) => update({ purpose: type === 'darkFlat' ? 'darkFlat' : undefined })} />
				<Notice>
					{settings.purpose === 'darkFlat'
						? 'Dark-flats are light-blocked frames at the exposures of your flats, which they calibrate; give each group the exposure of a filter of the Flat Wizard. The plan records them as dark-flats.'
						: 'Darks are light-blocked frames at the exposures and temperatures of your lights, which they calibrate.'}
				</Notice>
				{groups.map((group, index) => (
					<GroupForm
						key={index}
						index={index}
						group={group}
						count={groups.length}
						temperature={capabilities === undefined || capabilities.canSetTemperature}
						exposure={capabilities?.exposure}
						disabled={locked}
						onChange={(patch) => updateGroup(index, patch)}
						onMove={(offset) => moveGroup(index, offset)}
						onDuplicate={() => update({ groups: duplicateDarkGroup(settings.groups, index) })}
						onRemove={() => update({ groups: settings.groups.filter((_, i) => i !== index) })}
					/>
				))}
				{groups.length < DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS && (
					<Button variant="secondary" className="self-start" disabled={locked} onClick={() => update({ groups: [...settings.groups, settings.groups.at(-1) ?? DEFAULT_DARK_LIBRARY_WIZARD_GROUP] })}>
						Add Group
					</Button>
				)}
				{capture.subframe && <Notice>Darks of a subframe only calibrate lights of that same subframe.</Notice>}
				<DataList>
					<DataRow label="Frames">{estimate.frames}</DataRow>
					<DataRow label="Exposure">{`at least ${darkLibraryWizardDuration(estimate.exposure)}`}</DataRow>
					{estimate.bytes !== undefined && <DataRow label="Disk Space">{`~ ${formatBytes(estimate.bytes[0])} (mono) to ${formatBytes(estimate.bytes[1])}`}</DataRow>}
				</DataList>
				<Notice>Estimates only: downloads, cooling, and rejected frames add to them. Groups of one temperature run together.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.dark-library-wizard.protection" title="Light Protection">
				<Checkbox label="Use Dark Filter" checked={settings.useDarkFilter} disabled={locked || !wheelAssigned} onChange={(useDarkFilter) => update({ useDarkFilter })} />
				{settings.useDarkFilter && wheelState && (
					<Select
						label="Dark Slot"
						options={Array.from({ length: Math.max(wheelState.count, settings.darkSlot + 1) }, (_, slot) => String(slot))}
						value={String(settings.darkSlot)}
						format={(value) => `${Number(value) + 1}: ${wheelState.names[Number(value)]?.trim() || `Filter ${Number(value) + 1}`}`}
						disabled={locked}
						onChange={(value) => update({ darkSlot: Number(value) })}
					/>
				)}
				<Checkbox label="Close Dust Cover" checked={settings.closeCover} disabled={locked || !coverAssigned} onChange={(closeCover) => update({ closeCover })} />
				<Checkbox label="Turn Off Flat Panel" checked={settings.panelOff} disabled={locked || !panelAssigned} onChange={(panelOff) => update({ panelOff })} />
				<Checkbox label="Manual Opaque Cap" checked={settings.manualCap} disabled={locked} onChange={(manualCap) => update({ manualCap })} />
				<Checkbox label="Verify With Test Frame" checked={settings.verifyFirstFrame} disabled={locked} onChange={(verifyFirstFrame) => update({ verifyFirstFrame })} />
				{settings.panelOff && <Notice>An unlit panel may still let daylight through, so it may need another barrier.</Notice>}
				{settings.useDarkFilter && <Notice>The name of a slot proves nothing: you confirm that it really holds an opaque filter.</Notice>}
				{settings.closeCover && <Notice>The cover opens again when the session ends, unless it was already closed. Mind the sun in an unattended daytime session.</Notice>}
				<Notice>Every frame is checked, and the first one of a group can stop for your decision. Even so, no image proves that no light reached the sensor.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.dark-library-wizard.thermal" title="Thermal Control" summary={sensorTemperature} defaultOpen={false}>
				<DataList>
					<DataRow label="Sensor">{sensorTemperature ?? 'Not reported'}</DataRow>
					<DataRow label="Cooler">{capabilities?.cooler === undefined ? 'None' : `${capabilities.cooler.enabled === false ? 'Off' : 'On'}, ${Math.round(capabilities.cooler.power)} %`}</DataRow>
				</DataList>
				<div className="flex flex-col gap-2">
					<NumberInput label="Tolerance" value={settings.tolerance} min={0.1} max={5} step={0.1} suffix="°C" disabled={locked} onChange={(tolerance) => update({ tolerance })} />
					<NumberInput label="Hold" value={settings.hold} min={0} max={3600} suffix="s" disabled={locked} onChange={(hold) => update({ hold })} />
					<NumberInput label="Timeout" value={settings.timeout} min={1} max={14400} suffix="s" disabled={locked} onChange={(timeout) => update({ timeout })} />
				</div>
				{capabilities?.temperature === undefined ? (
					<Notice>The camera reports no temperature, so its frames cannot be matched by temperature.</Notice>
				) : (
					!capabilities.canSetTemperature && <Notice>The camera reports its temperature but cannot set one: groups stay uncontrolled and the readings are recorded.</Notice>
				)}
				<Notice>Groups with a temperature wait for what the sensor reports, not for the command. The cooler stays as the session leaves it: it is never switched off or warmed.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.dark-library-wizard.output" title="Output & Quality">
				<div className="flex items-end gap-1">
					<TextInput label="Server Directory" className="flex-1" placeholder="~/Nebulosa/captures" value={settings.directory ?? ''} disabled={locked} onChange={(e) => update({ directory: e.target.value.trim() || undefined })} />
					<IconButton icon="folder" label="Choose directory" className="size-11" disabled={locked} onClick={() => setChoosingDirectory(true)} />
				</div>
				<NumberInput label="Rejections per Group" value={settings.maximumRejections} min={0} max={DARK_LIBRARY_WIZARD_MAXIMUM_REJECTIONS} disabled={locked} onChange={(maximumRejections) => update({ maximumRejections })} />
				<Checkbox label="Generate masters after acquisition" checked={settings.generateMasters === true} disabled={locked} onChange={(generateMasters) => update({ generateMasters: generateMasters || undefined })} />
				<Notice>Frames are saved raw in darks/, named by date, camera, exposure, and temperature, never replacing a file. Rejected frames are kept in darks/rejected and do not count.</Notice>
			</CollapsibleSection>
			{session && <Progress session={session} pending={pending} />}
			<CollapsibleSection id="images.dark-library-wizard.controls" title="Controls">
				{running && session ? (
					<div className="flex gap-2">
						{session.pauseRequested ? (
							<Button variant="secondary" className="flex-1" disabled={pending} onClick={() => void resumeDarkLibraryWizard(darkLibraryWizardRuntime, session)}>
								Resume
							</Button>
						) : (
							<Button variant="secondary" className="flex-1" disabled={pending || session.state === 'stopping' || session.state === 'restoring'} onClick={() => void pauseDarkLibraryWizard(darkLibraryWizardRuntime, session)}>
								Pause
							</Button>
						)}
						<Button variant="secondary" className="flex-1" disabled={pending || session.state === 'stopping' || session.state === 'restoring'} onClick={() => void stopDarkLibraryWizard(darkLibraryWizardRuntime, session)}>
							Stop
						</Button>
					</div>
				) : (
					<>
						{warning && <p className="m-0 text-xs leading-4 text-warning">{warning}</p>}
						<Button disabled={blocker !== undefined || pending || device === undefined} onClick={start}>
							Start
						</Button>
					</>
				)}
				{blocker && <Notice>{blocker}</Notice>}
				{running && <Notice>{session?.pauseRequested ? 'A paused session keeps its devices, so other operations stay blocked until Resume or Stop.' : 'Pausing waits for the current frame and keeps every device held. Stopping aborts the exposure in flight; the frames already saved stay.'}</Notice>}
				{error && <Notice error>{error}</Notice>}
			</CollapsibleSection>
			<FileExplorerModal
				open={choosingDirectory}
				mode="directory"
				title="Dark Directory"
				initialPath={settings.directory}
				onClose={() => setChoosingDirectory(false)}
				onChoose={(directory) => {
					setChoosingDirectory(false)
					update({ directory })
				}}
			/>
		</>
	)
}

interface GroupFormProps {
	// Position of the group, from 0.
	readonly index: number
	// Group shown.
	readonly group: Readonly<DarkGroup>
	// Number of groups of the plan.
	readonly count: number
	// Whether a target temperature can be set.
	readonly temperature: boolean
	// Exposure range the camera accepts, in seconds, when known.
	readonly exposure?: CameraCapabilities['exposure']
	// Whether the form is locked.
	readonly disabled: boolean
	// Applies changed fields.
	readonly onChange: (patch: Partial<DarkGroup>) => void
	// Moves the group by a number of rows.
	readonly onMove: (offset: number) => void
	// Adds a copy of the group below it.
	readonly onDuplicate: () => void
	// Removes the group.
	readonly onRemove: () => void
}

// Fields of one group.
function GroupForm({ index, group, count, temperature, exposure, disabled, onChange, onMove, onDuplicate, onRemove }: GroupFormProps) {
	return (
		<fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 border-t border-line-100 border-dashed p-0 pt-2 not-first:mt-2 mb-1 first:border-t-0 first:pt-0">
			<div className="flex items-center gap-1">
				<p className="m-0 flex-1 truncate text-ink-100">{`Group ${index + 1}`}</p>
				{index > 0 && <IconButton icon="arrow" label={`Move group ${index + 1} up`} className="size-11" disabled={disabled} onClick={() => onMove(-1)} />}
				{index < count - 1 && <IconButton icon="arrow" label={`Move group ${index + 1} down`} className="size-11 rotate-180" disabled={disabled} onClick={() => onMove(1)} />}
				{count < DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS && <IconButton icon="duplicate" label={`Duplicate group ${index + 1}`} className="size-11" disabled={disabled} onClick={onDuplicate} />}
				{count > 1 && <IconButton icon="close" label={`Remove group ${index + 1}`} className="size-11" disabled={disabled} onClick={onRemove} />}
			</div>
			<ExposureTimeInput value={group.exposure} exposure={exposure} disabled={disabled} onChange={(value) => onChange({ exposure: value })} />
			<NumberInput label="Frames" value={group.count} min={1} max={DARK_LIBRARY_WIZARD_MAXIMUM_COUNT} disabled={disabled} onChange={(frames) => onChange({ count: frames })} />
			{temperature && <Checkbox label="Target Temperature" checked={group.temperature !== undefined} disabled={disabled} onChange={(set) => onChange({ temperature: set ? 0 : undefined })} />}
			{group.temperature !== undefined && <NumberInput label="Temperature" value={group.temperature} min={-60} max={40} step={1} suffix="°C" disabled={disabled} onChange={(value) => onChange({ temperature: value })} />}
		</fieldset>
	)
}

interface ProgressProps {
	// Latest session of the camera.
	readonly session: DarkLibraryWizardSessionSummary
	// Whether a command of this tab is waiting for the server.
	readonly pending: boolean
}

// State of the running or last session: its phase, the group in progress, the latest frame, and the step it waits for.
function Progress({ session, pending }: ProgressProps) {
	const run = session.groups[session.group] as DarkLibraryWizardGroupRun | undefined
	const attempt = session.lastAttempt
	const failed = session.state === 'failed'
	const remaining = darkLibraryWizardExposureLeft(session)
	const running = session.endedAt === undefined

	return (
		<CollapsibleSection id="images.dark-library-wizard.session" title="Session">
			<p className={cn('m-0', failed ? 'text-danger' : 'text-ink-100')}>{DARK_LIBRARY_WIZARD_STATE_LABELS[session.state]}</p>
			{session.state === 'exposing' && <FrameProgress exposure={session.exposure} />}
			{session.pauseRequested && session.state !== 'paused' && <Notice>Pausing after the current frame.</Notice>}
			{failed && session.error && <Notice error>{session.error}</Notice>}
			{session.pending && <StepPrompt session={session} step={session.pending} pending={pending} />}
			<DataList>
				{run && <DataRow label="Group">{`${groupLabel(run)} (${session.group + 1} of ${session.groups.length})`}</DataRow>}
				{session.temperature !== undefined && <DataRow label="Sensor">{`${session.temperature.toFixed(1)} °C`}</DataRow>}
				{attempt?.verdict && <DataRow label="Last Frame">{attempt.verdict === 'acceptedWithWarnings' ? 'Accepted with warnings' : attempt.verdict === 'accepted' ? 'Accepted' : 'Rejected'}</DataRow>}
				{attempt?.planes.map((plane) => (
					<DataRow key={plane.plane} label={`Level ${plane.plane}`}>
						{plane.median === undefined ? '—' : `${Math.round(plane.median)} DN`}
					</DataRow>
				))}
				{running && remaining > 0 && <DataRow label="Exposure Left">{`at least ${darkLibraryWizardDuration(remaining)}`}</DataRow>}
			</DataList>
			<DataList>
				{session.groups.map((group) => (
					<GroupProgress key={group.groupId} group={group} />
				))}
			</DataList>
			{session.previewError && <Notice>{session.previewError}</Notice>}
			{session.cleanupWarnings.map((warning) => (
				<Notice key={warning} error>
					{warning}
				</Notice>
			))}
		</CollapsibleSection>
	)
}

// Counts of one group of a session.
function GroupProgress({ group }: { readonly group: DarkLibraryWizardGroupRun }) {
	const done = group.accepted + group.acceptedWithWarnings
	const notes = [group.acceptedWithWarnings > 0 && `${group.acceptedWithWarnings} with warnings`, group.rejected > 0 && `${group.rejected} rejected`, group.failedTransfer > 0 && `${group.failedTransfer} failed`].filter(Boolean).join(', ')
	return <DataRow label={groupLabel(group)}>{`${done}/${group.required}${notes ? `, ${notes}` : ''}`}</DataRow>
}

interface StepPromptProps extends ProgressProps {
	// Step the session waits for.
	readonly step: DarkLibraryWizardPendingStep
}

// Explains a step and offers its confirmation. Refusing a step is Stop, in the controls.
function StepPrompt({ session, step, pending }: StepPromptProps) {
	const confirm = () => void continueDarkLibraryWizard(darkLibraryWizardRuntime, session, step.stepId)

	if (step.kind === 'protectionLost') {
		return (
			<>
				<Notice error>{`${step.message}. Put it back, then continue; no frame is taken until it is.`}</Notice>
				<Button disabled={pending} onClick={confirm}>
					Continue
				</Button>
			</>
		)
	}

	return (
		<>
			<Notice error>{`This frame may show external light. ${step.suspicions.map((suspicion) => DARK_SUSPICION_LABELS[suspicion]).join(' ')} Amp glow and hot pixels are normal and do not raise this warning, but it proves nothing either: check the protection.`}</Notice>
			<Button disabled={pending} onClick={confirm}>
				Continue Despite Warning
			</Button>
		</>
	)
}
