import type { CameraCapabilities, CaptureSnoop, DarkGroup, DarkLibraryWizardGroupRun, DarkLibraryWizardPendingStep, DarkLibraryWizardSessionSummary, DeviceSummary } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { CatalogCameraNotice, useBoundCamera } from '../equipment/CatalogCameraNotice'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { RoleDevice } from '../equipment/useEquipment'
import { FileExplorerModal } from '../files/FileExplorerModal'
import { formatByteSize, formatDuration, formatExposureTime, formatPercent, formatTemperature, MISSING } from '../format'
import { operationsState } from '../operations'
import { activeProfile, darkLibraryWizardSettings, exposureSettings, profileState, setDarkLibraryWizardSettings } from '../profile/profile'
import { type CameraIdentity, DARK_LIBRARY_WIZARD_MAXIMUM_COUNT, DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS, DARK_LIBRARY_WIZARD_MAXIMUM_REJECTIONS, DEFAULT_DARK_LIBRARY_WIZARD_GROUP, type DarkLibraryWizardSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import {
	continueDarkLibraryWizard,
	DARK_LIBRARY_WIZARD_STATE_LABELS,
	DARK_PLANE_LABELS,
	DARK_SUSPICION_LABELS,
	darkGroupProblem,
	darkLibraryWizardBlocker,
	darkLibraryWizardCapture,
	darkLibraryWizardEstimate,
	darkLibraryWizardExposureLeft,
	darkLibraryWizardManualCap,
	darkLibraryWizardProtectionSummary,
	darkLibraryWizardRequest,
	darkLibraryWizardRunning,
	darkLibraryWizardRuntime,
	darkLibraryWizardWarning,
	duplicateDarkGroup,
	pauseDarkLibraryWizard,
	proposedDarkSlot,
	proposedDarkTemperature,
	resumeDarkLibraryWizard,
	startDarkLibraryWizard,
	stopDarkLibraryWizard,
} from './darklibrarywizard'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameProgress } from './FrameProgress'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of Dark Library Wizard, a camera operation of the Images camera tabs. The session leads: its
// state, the step it waits for with Continue, Pause or Resume, Stop, and the readings of the group in progress; while no
// session runs, Start with the one sentence of what the operator vouches for, or why it cannot start, and, once a session
// saved frames, the Calibration Library. The results of each group follow, then the form, each section with its summary:
// the equipment of the tab's camera, the capture plan (whether it takes darks or dark-flats, and the groups as one-line rows
// that expand for editing), how the light is blocked (devices of the setup, or an opaque cap the operator fits when none
// is selected), the thermal protocol, the output and its limits, and the camera settings. Frames take the gain, offset,
// binning, subframe, and readout mode of Camera Acquisition, but never its exposure time, which each group sets. The form
// is the camera's, kept in the profile; while a session runs the plan and the protection show what the session applied.
// Sessions are the server's, shown here whichever tab started them, and keep running when the panel unmounts. Start asks
// for no confirmation: the warning with it says what no device verifies, and a later step is confirmed only by its
// button. Every start makes a new plan, which is never listed or reused here; a plan may ask for its masters, and
// browsing, importing, and building them are the Calibration Library's.

// Classes of the session commands and the controls pressed at the scope: a touch target of 44 px on a coarse pointer.
const COMMAND_CLASS = 'pointer-coarse:min-h-[44px]'

// Classes of the icon buttons of a row: 38.5 px on a fine pointer, 44 px on a coarse one.
const ICON_COMMAND_CLASS = 'size-11 pointer-coarse:size-[44px]'

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

// Light protection a form shows: the operator's while no session runs, the one a running session applied otherwise.
type ShownProtection = Pick<DarkLibraryWizardSettings, 'useDarkFilter' | 'darkSlot' | 'closeCover' | 'panelOff' | 'verifyFirstFrame'>

// Returns the label of a group, short enough for a row of the panel; a group without a target names no temperature.
function groupLabel({ exposure, temperature }: Pick<DarkGroup, 'exposure' | 'temperature'>) {
	return `${formatExposureTime(exposure)}${temperature === undefined ? '' : `, ${formatTemperature(temperature)}`}`
}

// Returns a count with its noun, singular for one.
function counted(count: number, noun: string) {
	return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// Returns the groups a running session applied, to show while it runs.
function appliedGroups({ groups }: Pick<DarkLibraryWizardSessionSummary, 'groups'>): DarkGroup[] {
	return groups.map(({ exposure, temperature, count }) => ({ exposure, ...(temperature !== undefined && { temperature }), count }))
}

// Returns the light protection a running session applied, keeping the dark slot of the form when it used no filter.
function appliedProtection({ protection }: Pick<DarkLibraryWizardSessionSummary, 'protection'>, darkSlot: number): ShownProtection {
	return { useDarkFilter: protection.darkFilter !== undefined, darkSlot: protection.darkFilter?.slot ?? darkSlot, closeCover: protection.closeCover, panelOff: protection.panelOff, verifyFirstFrame: protection.verifyFirstFrame }
}

// Dark Library Wizard panel sections of a camera.
export function DarkLibraryWizardSections({ device, availability, wheel, flatPanel, cover, settings: identity, snoop }: DarkLibraryWizardTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(darkLibraryWizardRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const [choosingDirectory, setChoosingDirectory] = useState(false)
	// Group expanded for editing, by index; the others show as one-line rows.
	const [expanded, setExpanded] = useState<number>()
	const catalogCamera = useBoundCamera(device)
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
	const protection = running && session ? appliedProtection(session, settings.darkSlot) : settings
	const purpose: DarkFrameType = (running && session ? session.purpose : settings.purpose) ?? 'dark'
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
	const startBlocker = blocker ?? (catalogCamera === undefined ? 'Bind the camera to a camera of the Equipment Catalog first.' : undefined)
	const capture = running && session ? session.capture : darkLibraryWizardCapture(exposure, capabilities)
	const estimate = darkLibraryWizardEstimate(groups, capture, capabilities)
	const sensorTemperature = capabilities?.temperature === undefined ? undefined : formatTemperature(capabilities.temperature)
	const warning = darkLibraryWizardWarning(settings)
	// After a session saved frames, the Calibration Library leads and Start becomes secondary.
	const followUp = session !== undefined && !running && session.groups.some((group) => group.accepted + group.acceptedWithWarnings > 0)
	const equipment = [wheelAssigned && 'Wheel', panelAssigned && 'Panel', coverAssigned && 'Cover'].filter((name) => name !== false)
	const frameNoun = purpose === 'darkFlat' ? 'dark-flat' : 'dark'

	// Updates fields of the camera's form.
	function update(patch: Partial<DarkLibraryWizardSettings>) {
		setDarkLibraryWizardSettings(profileState, identity, patch)
	}

	// Updates fields of one group.
	function updateGroup(index: number, patch: Partial<DarkGroup>) {
		update({ groups: settings.groups.map((group, i) => (i === index ? { ...group, ...patch } : group)) })
	}

	// Moves a group one row up or down, keeping it expanded; a temperature's groups run in the order they have here.
	function moveGroup(index: number, offset: number) {
		const moved = [...settings.groups]
		const [group] = moved.splice(index, 1)
		moved.splice(index + offset, 0, group)
		update({ groups: moved })
		setExpanded(index + offset)
	}

	// Adds a copy of a group below it and expands the copy, which blocks the start until one of its settings changes.
	function duplicateGroup(index: number) {
		update({ groups: duplicateDarkGroup(settings.groups, index) })
		setExpanded(index + 1)
	}

	// Removes one group and collapses the rows, since the indexes after it shift.
	function removeGroup(index: number) {
		update({ groups: settings.groups.filter((_, i) => i !== index) })
		setExpanded(undefined)
	}

	// Appends a copy of the last group, or the default group, and expands it for editing.
	function addGroup() {
		update({ groups: [...settings.groups, settings.groups.at(-1) ?? DEFAULT_DARK_LIBRARY_WIZARD_GROUP] })
		setExpanded(settings.groups.length)
	}

	// Returns the exact ids of the assigned devices.
	function selectedEquipment() {
		return {
			...(wheelAssigned && wheel.device && { wheel: { connectionId: wheel.device.connectionId, deviceId: wheel.device.id } }),
			...(panelAssigned && flatPanel.device && { panel: { connectionId: flatPanel.device.connectionId, deviceId: flatPanel.device.id } }),
			...(coverAssigned && cover.device && { cover: { connectionId: cover.device.connectionId, deviceId: cover.device.id } }),
		}
	}

	function start() {
		if (device) void startDarkLibraryWizard(darkLibraryWizardRuntime, device.connectionId, device.id, darkLibraryWizardRequest(settings, exposure, selectedEquipment(), snoop, capabilities))
	}

	return (
		<>
			<CollapsibleSection id="images.dark-library-wizard.session" title={running ? 'Current Session' : session ? 'Last Session' : 'Session'} summary={session && DARK_LIBRARY_WIZARD_STATE_LABELS[session.state]}>
				{session && <SessionState session={session} />}
				<div className="flex flex-wrap gap-2">
					{running && session ? (
						<>
							{session.pending && <ContinueButton session={session} step={session.pending} pending={pending} />}
							{session.pauseRequested ? (
								<Button variant="secondary" className={COMMAND_CLASS} title="Resume the session: resuming is your assertion of the light protection, and the temperature is confirmed again" disabled={pending} onClick={() => void resumeDarkLibraryWizard(darkLibraryWizardRuntime, session)}>
									Resume
								</Button>
							) : (
								<Button
									variant="secondary"
									className={COMMAND_CLASS}
									title="Pause after the current frame: every device stays held, so other operations stay blocked until Resume or Stop"
									disabled={pending || session.state === 'stopping' || session.state === 'restoring'}
									onClick={() => void pauseDarkLibraryWizard(darkLibraryWizardRuntime, session)}
								>
									Pause
								</Button>
							)}
							<Button
								variant="secondary"
								className={COMMAND_CLASS}
								title="Stop the session: the exposure in flight is lost, and the frames already saved stay"
								disabled={pending || session.state === 'stopping' || session.state === 'restoring'}
								onClick={() => void stopDarkLibraryWizard(darkLibraryWizardRuntime, session)}
							>
								{session.state === 'stopping' ? 'Stopping…' : 'Stop'}
							</Button>
						</>
					) : (
						<>
							{followUp && (
								<Button className={COMMAND_CLASS} onClick={() => navigate(routeState, { workspace: 'tools', tool: 'calibration-library' })}>
									Open Calibration Library
								</Button>
							)}
							<Button variant={followUp ? 'secondary' : 'primary'} className={COMMAND_CLASS} title={startBlocker ?? warning} disabled={startBlocker !== undefined || pending || device === undefined} onClick={start}>
								{session ? 'Start Again' : 'Start'}
							</Button>
						</>
					)}
				</div>
				{!running &&
					(blocker ? (
						<Notice>{blocker}</Notice>
					) : (
						warning && (
							<Notice warning className="text-sm leading-5">
								{warning}
							</Notice>
						)
					))}
				{!running && <CatalogCameraNotice device={device} lead="Frames will be recorded against" purpose="to acquire calibration frames" />}
				{session?.pauseRequested && <Notice>A paused session keeps its devices, so other operations stay blocked until Resume or Stop.</Notice>}
				{error && <Notice error>{error}</Notice>}
				{session && running && <SessionReadings session={session} />}
			</CollapsibleSection>
			{session && <Results session={session} />}
			<CollapsibleSection id="images.dark-library-wizard.equipment" title="Equipment" summary={equipment.length > 0 ? equipment.join(' · ') : 'Manual'}>
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Filter Wheel">{wheelAssigned ? <DeviceLink device={wheel.device} /> : 'Not assigned'}</DataRow>
					<DataRow label="Flat Panel">{panelAssigned ? <DeviceLink device={flatPanel.device} /> : 'Not assigned'}</DataRow>
					<DataRow label="Cover">{coverAssigned ? <DeviceLink device={cover.device} /> : 'Not assigned'}</DataRow>
				</DataList>
				{!running && (!wheelAssigned || !panelAssigned || !coverAssigned) && wheel !== undefined && <EquipmentSetupButton />}
				{wheel === undefined && <Notice>Only the Main Camera of the equipment setup uses its filter wheel, flat panel, and cover, so for this camera only a manual cap can block the light.</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="images.dark-library-wizard.plan" title="Capture Plan" summary={`${DARK_FRAME_TYPE_LABELS[purpose]} · ${counted(groups.length, 'group')} · ${counted(estimate.frames, 'frame')}`}>
				<SegmentedControl label="Frame Type" options={DARK_FRAME_TYPES} value={purpose} format={(type) => DARK_FRAME_TYPE_LABELS[type]} disabled={locked} onChange={(type) => update({ purpose: type === 'darkFlat' ? 'darkFlat' : undefined })} />
				<Notice>
					{purpose === 'darkFlat'
						? 'Dark-flats are light-blocked frames at the exposures of your flats, which they calibrate; give each group the exposure of a filter of the Flat Wizard. The plan records them as dark-flats.'
						: 'Darks are light-blocked frames at the exposures and temperatures of your lights, which they calibrate.'}
				</Notice>
				<div className="flex flex-col">
					{groups.map((group, index) => (
						<GroupRow
							key={index}
							index={index}
							group={group}
							count={groups.length}
							problem={running ? undefined : darkGroupProblem(groups, index, capabilities)}
							temperature={capabilities === undefined || capabilities.canSetTemperature}
							sensorTemperature={capabilities?.temperature}
							exposure={capabilities?.exposure}
							open={expanded === index}
							disabled={locked}
							onToggle={(open) => setExpanded(open ? index : undefined)}
							onChange={(patch) => updateGroup(index, patch)}
							onMove={(offset) => moveGroup(index, offset)}
							onDuplicate={() => duplicateGroup(index)}
							onRemove={() => removeGroup(index)}
						/>
					))}
				</div>
				{groups.length < DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS && (
					<Button variant="secondary" className={`self-start ${COMMAND_CLASS}`} disabled={locked} onClick={addGroup}>
						Add Group
					</Button>
				)}
				{capture.subframe && <Notice>Darks of a subframe only calibrate lights of that same subframe.</Notice>}
				<DataList>
					<DataRow label="Frames">{estimate.frames}</DataRow>
					<DataRow label="Exposure">{`at least ${formatDuration(estimate.exposure)}`}</DataRow>
					{estimate.bytes !== undefined && <DataRow label="Disk Space">{`~ ${formatByteSize(estimate.bytes[0])} (mono) to ${formatByteSize(estimate.bytes[1])}`}</DataRow>}
				</DataList>
				<Notice>Estimates only: downloads, cooling, and rejected frames add to them. Groups of one temperature run together.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.dark-library-wizard.protection" title="Light Protection" summary={darkLibraryWizardProtectionSummary(protection)}>
				<Checkbox label="Use Dark Filter" className={COMMAND_CLASS} checked={protection.useDarkFilter} disabled={locked || !wheelAssigned} onChange={(useDarkFilter) => update({ useDarkFilter, ...(useDarkFilter && wheelState && { darkSlot: proposedDarkSlot(wheelState.names, settings.darkSlot) }) })} />
				{protection.useDarkFilter && wheelState && (
					<Select
						label="Dark Slot"
						options={Array.from({ length: Math.max(wheelState.count, protection.darkSlot + 1) }, (_, slot) => String(slot))}
						value={String(protection.darkSlot)}
						format={(value) => `${Number(value) + 1}: ${wheelState.names[Number(value)]?.trim() || `Filter ${Number(value) + 1}`}`}
						disabled={locked}
						onChange={(value) => update({ darkSlot: Number(value) })}
					/>
				)}
				<Checkbox label="Close Dust Cover" className={COMMAND_CLASS} checked={protection.closeCover} disabled={locked || !coverAssigned} onChange={(closeCover) => update({ closeCover })} />
				<Checkbox label="Turn Off Flat Panel" className={COMMAND_CLASS} checked={protection.panelOff} disabled={locked || !panelAssigned} onChange={(panelOff) => update({ panelOff })} />
				<Checkbox label="Verify With Test Frame" className={COMMAND_CLASS} checked={protection.verifyFirstFrame} disabled={locked} onChange={(verifyFirstFrame) => update({ verifyFirstFrame })} />
				{darkLibraryWizardManualCap(protection) && <Notice>With none of these selected, you block the light yourself with an opaque cap over the optical path.</Notice>}
				{protection.panelOff && <Notice>An unlit panel may still let daylight through, so it may need another barrier.</Notice>}
				{protection.useDarkFilter && <Notice>The name of a slot proves nothing: you confirm that it really holds an opaque filter.</Notice>}
				{protection.closeCover && <Notice>The cover closes before the first frame and opens again when the session ends, unless it was already closed. Mind the sun in an unattended daytime session.</Notice>}
				<Notice>Every frame is checked, and the first one of a group can stop for your decision. Even so, no image proves that no light reached the sensor.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.dark-library-wizard.thermal" title="Thermal Control" summary={sensorTemperature} defaultOpen={false}>
				<DataList>
					<DataRow label="Sensor">{sensorTemperature ?? 'Not reported'}</DataRow>
					<DataRow label="Cooler">{capabilities?.cooler === undefined ? 'None' : `${capabilities.cooler.enabled === false ? 'Off' : 'On'}, ${formatPercent(capabilities.cooler.power / 100)}`}</DataRow>
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
				<Notice>A group with a target starts once the sensor reports it within the tolerance for the hold time, and the session fails if that takes longer than the timeout. The cooler stays as the session leaves it: it is never switched off or warmed.</Notice>
			</CollapsibleSection>
			<CollapsibleSection id="images.dark-library-wizard.output" title="Output & Quality" summary={`${settings.directory ?? 'Default directory'} · ${counted(settings.maximumRejections, 'rejection')}${settings.generateMasters ? ' · masters' : ''}`} defaultOpen={false}>
				<div className="flex items-end gap-1">
					<TextInput label="Server Directory" className="flex-1" placeholder="~/Nebulosa/captures" value={settings.directory ?? ''} disabled={locked} onChange={(e) => update({ directory: e.target.value.trim() || undefined })} />
					<IconButton icon="folder" label="Choose directory" className={ICON_COMMAND_CLASS} disabled={locked} onClick={() => setChoosingDirectory(true)} />
				</div>
				<NumberInput label="Rejections per Group" value={settings.maximumRejections} min={0} max={DARK_LIBRARY_WIZARD_MAXIMUM_REJECTIONS} disabled={locked} onChange={(maximumRejections) => update({ maximumRejections })} />
				<Checkbox label="Generate masters after acquisition" className={COMMAND_CLASS} checked={settings.generateMasters === true} disabled={locked} onChange={(generateMasters) => update({ generateMasters: generateMasters || undefined })} />
				<Notice>Frames are saved raw in darks/, named by date, camera, exposure, and temperature, never replacing a file. Rejected frames are kept in darks/rejected and do not count; the session fails when a group rejects more than this.</Notice>
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.dark-library-wizard.acquisition"
				device={device}
				exposure={capture}
				capabilities={capabilities}
				defaultOpen={false}
				summary={`${capture.binX}×${capture.binY}`}
				description={`Frames are raw ${frameNoun} frames taken with the camera settings of Camera Acquisition; each group of the Capture Plan sets its exposure.`}
			/>
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

interface GroupRowProps {
	// Position of the group, from 0.
	readonly index: number
	// Group shown.
	readonly group: Readonly<DarkGroup>
	// Number of groups of the plan.
	readonly count: number
	// What is wrong with the group, said on its row; absent when nothing is, or while a session runs.
	readonly problem?: string
	// Whether a target temperature can be set.
	readonly temperature: boolean
	// Temperature the sensor reports, in °C, when known; turning a target on proposes it in whole degrees rounded down.
	readonly sensorTemperature?: number
	// Exposure range the camera accepts, in seconds, when known.
	readonly exposure?: CameraCapabilities['exposure']
	// Whether the row is expanded for editing.
	readonly open: boolean
	// Whether the form is locked.
	readonly disabled: boolean
	// Expands or collapses the row.
	readonly onToggle: (open: boolean) => void
	// Applies changed fields.
	readonly onChange: (patch: Partial<DarkGroup>) => void
	// Moves the group by a number of rows.
	readonly onMove: (offset: number) => void
	// Adds a copy of the group below it.
	readonly onDuplicate: () => void
	// Removes the group.
	readonly onRemove: () => void
}

// One group: a row with its exposure, target, and frame count, or what to fix, that expands into its fields and the
// commands that move, copy, and remove it.
function GroupRow({ index, group, count, problem, temperature, sensorTemperature, exposure, open, disabled, onToggle, onChange, onMove, onDuplicate, onRemove }: GroupRowProps) {
	return (
		<details open={open} onToggle={(e) => e.currentTarget.open !== open && onToggle(e.currentTarget.open)} className="border-t border-line-200 border-dashed first:border-t-0">
			<summary className="flex cursor-pointer list-none items-center gap-2 py-2 select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent pointer-coarse:min-h-[44px] [&::-webkit-details-marker]:hidden">
				<Icon name="stepForward" className="size-3.5 flex-none text-ink-300 transition-transform duration-150 motion-reduce:transition-none [details[open]>summary>&]:rotate-90" />
				<span className="min-w-0 flex-1 truncate text-ink-100 tabular-nums">{`${index + 1}. ${groupLabel(group)}`}</span>
				<span className={problem ? 'flex-none text-xs text-danger' : 'flex-none text-xs text-ink-200 tabular-nums'}>{problem ? 'Invalid group' : counted(group.count, 'frame')}</span>
			</summary>
			<div className="flex flex-col gap-2 pb-3">
				<ExposureTimeInput value={group.exposure} exposure={exposure} disabled={disabled} onChange={(value) => onChange({ exposure: value })} />
				<NumberInput label="Frames" value={group.count} min={1} max={DARK_LIBRARY_WIZARD_MAXIMUM_COUNT} disabled={disabled} onChange={(frames) => onChange({ count: frames })} />
				{temperature && <Checkbox label="Target Temperature" className={COMMAND_CLASS} checked={group.temperature !== undefined} disabled={disabled} onChange={(set) => onChange({ temperature: set ? proposedDarkTemperature(sensorTemperature) : undefined })} />}
				{group.temperature !== undefined && <NumberInput label="Temperature" value={group.temperature} min={-60} max={40} step={1} suffix="°C" disabled={disabled} onChange={(value) => onChange({ temperature: value })} />}
				{problem && <Notice error>{problem}</Notice>}
				<div className="flex items-center gap-1">
					{index > 0 && <IconButton icon="arrow" label={`Move group ${index + 1} up`} className={ICON_COMMAND_CLASS} disabled={disabled} onClick={() => onMove(-1)} />}
					{index < count - 1 && <IconButton icon="arrow" label={`Move group ${index + 1} down`} className={`${ICON_COMMAND_CLASS} rotate-180`} disabled={disabled} onClick={() => onMove(1)} />}
					{count < DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS && <IconButton icon="duplicate" label={`Duplicate group ${index + 1}`} className={ICON_COMMAND_CLASS} disabled={disabled} onClick={onDuplicate} />}
					{count > 1 && (
						<Button variant="secondary" className={`ml-auto ${COMMAND_CLASS}`} disabled={disabled} onClick={onRemove}>
							Remove Group
						</Button>
					)}
				</div>
			</div>
		</details>
	)
}

interface SessionProps {
	// Latest session of the camera.
	readonly session: DarkLibraryWizardSessionSummary
}

// State of the running or last session: its phase, the exposure in flight, a pause on its way, its failure, and the step it
// waits for, said as what Continue confirms.
function SessionState({ session }: SessionProps) {
	const failed = session.state === 'failed'
	const step = session.pending

	return (
		<>
			<SessionStateText failed={failed} succeeded={session.state === 'completed'}>
				{DARK_LIBRARY_WIZARD_STATE_LABELS[session.state]}
			</SessionStateText>
			{session.state === 'exposing' && <FrameProgress exposure={session.exposure} />}
			{session.pauseRequested && session.state !== 'paused' && <Notice>Pausing after the current frame.</Notice>}
			{failed && session.error && <Notice error>{session.error}</Notice>}
			{step?.kind === 'protectionLost' && <p className="m-0 text-sm leading-5 text-pretty text-ink-100">{`${step.message}. Put it back, then continue; no frame is taken until it is.`}</p>}
			{step?.kind === 'suspectedLight' && (
				<Notice warning className="text-sm leading-5">
					{`This frame may show external light. ${step.suspicions.map((suspicion) => DARK_SUSPICION_LABELS[suspicion]).join(' ')} Amp glow and hot pixels are normal and do not raise this warning, but it proves nothing either: check the protection, then continue or stop.`}
				</Notice>
			)}
		</>
	)
}

interface ContinueButtonProps extends SessionProps {
	// Step the session waits for.
	readonly step: DarkLibraryWizardPendingStep
	// Whether a command of this tab is waiting for the server.
	readonly pending: boolean
}

// Confirms the step a session waits for. A restored protection is the way on, so its Continue leads; a frame that may
// show light weighs equally against Stop, so continuing despite it does not.
function ContinueButton({ session, step, pending }: ContinueButtonProps) {
	const confirm = () => void continueDarkLibraryWizard(darkLibraryWizardRuntime, session, step.stepId)

	if (step.kind === 'protectionLost') {
		return (
			<Button className={COMMAND_CLASS} title="Continue once the protection is back; it is checked again before the next frame" disabled={pending} onClick={confirm}>
				Continue
			</Button>
		)
	}

	return (
		<Button variant="secondary" className={COMMAND_CLASS} title="Keep this frame, accepted with warnings, and go on; Stop discards it into darks/rejected" disabled={pending} onClick={confirm}>
			Continue Despite Warning
		</Button>
	)
}

// Readings of a running session: the group in progress, the sensor, the latest frame with its levels in DN, the exposure
// left, and why the latest frame could not be previewed.
function SessionReadings({ session }: SessionProps) {
	const run = session.groups[session.group] as DarkLibraryWizardGroupRun | undefined
	const attempt = session.lastAttempt
	const remaining = darkLibraryWizardExposureLeft(session)

	return (
		<>
			<DataList>
				{run && <DataRow label="Group">{`${groupLabel(run)} (${session.group + 1} of ${session.groups.length})`}</DataRow>}
				{session.temperature !== undefined && <DataRow label="Sensor">{formatTemperature(session.temperature)}</DataRow>}
				{attempt?.verdict && <DataRow label="Last Frame">{attempt.verdict === 'acceptedWithWarnings' ? 'Accepted with warnings' : attempt.verdict === 'accepted' ? 'Accepted' : 'Rejected'}</DataRow>}
				{attempt?.planes.map((plane) => (
					<DataRow key={plane.plane} label={DARK_PLANE_LABELS[plane.plane]}>
						{plane.median === undefined ? MISSING : `${Math.round(plane.median)} DN`}
					</DataRow>
				))}
				{remaining > 0 && <DataRow label="Exposure Left">{`at least ${formatDuration(remaining)}`}</DataRow>}
			</DataList>
			{session.previewError && <Notice>{session.previewError}</Notice>}
		</>
	)
}

// Outcome of every group of the running or last session: the frames saved of those required, what was set aside, the
// masters handed to the Calibration Library, and what could not be restored.
function Results({ session }: SessionProps) {
	const completed = session.groups.filter((group) => group.state === 'completed')

	return (
		<CollapsibleSection id="images.dark-library-wizard.results" title="Results" summary={`${completed.length} of ${counted(session.groups.length, 'group')}`}>
			<DataList>
				{session.groups.map((group) => (
					<GroupProgress key={group.groupId} group={group} />
				))}
			</DataList>
			{session.generateMasters && session.endedAt !== undefined && completed.length > 0 && <Notice>{`${counted(completed.length, 'complete group')} went to the Calibration Library to become masters.`}</Notice>}
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
	return <DataRow label={groupLabel(group)}>{`${done} of ${group.required} saved${notes ? `, ${notes}` : ''}`}</DataRow>
}
