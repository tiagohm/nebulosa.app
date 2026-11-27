import type { CaptureSnoop, DeviceSummary, FlatWizardFilter, FlatWizardSessionSummary, WheelState } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { CatalogCameraNotice, useBoundCamera } from '../equipment/CatalogCameraNotice'
import { EquipmentSetupButton } from '../equipment/EquipmentSetupButton'
import type { RoleDevice } from '../equipment/useEquipment'
import { FileExplorerModal } from '../files/FileExplorerModal'
import { formatExposureTime, MISSING } from '../format'
import { cameraTabKey } from '../images/cameratabs'
import { imagesState, selectImageTool } from '../images/images'
import { operationsState } from '../operations'
import { activeProfile, exposureSettings, flatWizardSettings, profileState, setDarkLibraryWizardSettings, setFlatWizardSettings } from '../profile/profile'
import { type CameraIdentity, DEFAULT_FLAT_WIZARD_EFFECTIVE_CLIP, DEFAULT_FLAT_WIZARD_FILTER, FLAT_WIZARD_MAXIMUM_COUNT, FLAT_WIZARD_MAXIMUM_EXPOSURE, FLAT_WIZARD_MAXIMUM_FILTERS, FLAT_WIZARD_MAXIMUM_REJECTIONS, FLAT_WIZARD_MAXIMUM_TRIALS, type FlatWizardSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { CameraAcquisitionSection } from './CameraAcquisitionSection'
import { cameraKey } from './capture'
import {
	continueFlatWizard,
	darkFlatGroups,
	FLAT_WIZARD_DIAGNOSTIC_LABELS,
	FLAT_WIZARD_FILTER_STATE_LABELS,
	FLAT_WIZARD_PLANE_LABELS,
	FLAT_WIZARD_STABILITY_FRAMES,
	FLAT_WIZARD_STATE_LABELS,
	FLAT_WIZARD_VERDICT_LABELS,
	flatWizardBlocker,
	flatWizardFilterName,
	flatWizardFilterProblems,
	flatWizardPreflight,
	flatWizardRequest,
	flatWizardResultNotes,
	flatWizardRunning,
	flatWizardRuntime,
	flatWizardShowsStep,
	flatWizardStepText,
	startFlatWizard,
	stopFlatWizard,
} from './flatwizard'
import { FrameProgress } from './FrameProgress'
import { SessionStateText } from './SessionStateText'

// Contextual panel sections of Flat Wizard, a camera operation of the Images camera tabs. The session leads: its state,
// the manual step it waits for with Continue, Stop, the readings of the filter in progress, and, once ended, what comes
// next (matching dark-flats, the Calibration Library); while no session runs, Start with the one sentence of what it will
// move and ask for, or why it cannot start. The results of each filter follow, then the form: the equipment it uses (the
// tab's camera, and the filter wheel, flat panel, and cover of the setup when the camera has a role, else manual filters
// and light and an untouched cover), the filter groups as one-line rows that expand for editing (slot or name, frame
// count, exposure bounds, DN target, panel brightness), the output (directory and masters), the limits of the search,
// and the camera settings, the last ones collapsed with their summaries. Frames take the camera settings of Camera
// Acquisition, but never its exposure time, which the wizard searches. Levels are the camera's original digital numbers
// (DN), never the stretched view. The form is the camera's, kept in the profile, and shows the values applied while a
// session runs; the session is the server's, shown here whichever tab started it, and keeps running when the panel
// unmounts. A manual step is confirmed only by its Continue button.

// Classes of the session commands: a touch target of 44 px on a coarse pointer, since they are pressed at the scope.
const COMMAND_CLASS = 'pointer-coarse:min-h-[44px]'

// Camera a Flat Wizard panel acquires with, the devices of its setup, and the forms it edits.
export interface FlatWizardTarget {
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

// Flat Wizard panel sections of a camera.
export function FlatWizardSections({ device, availability, wheel, flatPanel, cover, settings: identity, snoop }: FlatWizardTarget) {
	const profiles = useSnapshot(profileState)
	const runtime = useSnapshot(flatWizardRuntime)
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const [choosingDirectory, setChoosingDirectory] = useState(false)
	// Filter group expanded for editing, by index; the others show as one-line rows.
	const [expanded, setExpanded] = useState<number>()
	const catalogCamera = useBoundCamera(device)
	const profile = activeProfile(profiles)
	const settings = flatWizardSettings(profile.settings, identity)
	const exposure = exposureSettings(profile.settings, identity)
	const key = device && cameraKey(device.connectionId, device.id)
	const session = key ? runtime.sessions[key] : undefined
	const running = flatWizardRunning(session)
	const pending = key !== undefined && runtime.pending[key] === true
	const error = key ? runtime.errors[key] : undefined
	const locked = running || pending
	// While running, the form shows the values the session applied.
	const shown: Readonly<FlatWizardSettings> = running && session ? appliedSettings(session) : settings
	// A wheel or a panel is used when the setup assigns one; an unassigned one makes that step manual.
	const wheelAssigned = wheel !== undefined && wheel.status !== 'notSelected'
	const panelAssigned = flatPanel !== undefined && flatPanel.status !== 'notSelected'
	const wheelAvailability = wheelAssigned ? roleAvailability('FILTER_WHEEL', wheel, operations) : undefined
	const panelAvailability = panelAssigned ? roleAvailability('FLAT_PANEL', flatPanel, operations) : undefined
	const coverAssigned = cover !== undefined && cover.status !== 'notSelected'
	const coverState = coverAssigned ? watchedDeviceState(control, 'cover', cover.device) : undefined
	const coverAvailability = coverAssigned ? roleAvailability('COVER', cover, operations, coverState && !coverState.canPark ? 'The cover cannot be opened and closed.' : undefined) : undefined
	const wheelState = wheelAssigned ? watchedDeviceState(control, 'wheel', wheel.device) : undefined
	const blocker = running ? undefined : flatWizardBlocker(availability, wheelAvailability, panelAvailability, settings, wheelState, coverAvailability)
	const panelState = panelAssigned ? watchedDeviceState(control, 'flatPanel', flatPanel.device) : undefined
	const capabilities = watchedDeviceState(control, 'camera', device)
	// Slot names of the wheel the filters are named by; absent without a wheel, when the typed names are used.
	const wheelNames = wheelAssigned ? (wheelState?.names ?? []) : undefined
	const filterNames = shown.filters.map((filter) => flatWizardFilterName(wheelNames, filter.slot, filter.name))
	const frames = shown.filters.reduce((total, filter) => total + filter.count, 0)
	const startBlocker = blocker ?? (catalogCamera === undefined ? 'Bind the camera to a camera of the Equipment Catalog first.' : undefined)
	// After a session saved flats, its follow-ups lead and Start becomes secondary.
	const followUp = session !== undefined && !running && session.filters.some((run) => run.accepted > 0)
	// What Start moves and asks for: said under it, or, once follow-ups lead, as its tooltip.
	const preflight = flatWizardPreflight({ wheel: wheelAssigned ? wheel.device?.name : undefined, panel: panelAssigned ? flatPanel.device?.name : undefined, cover: coverAssigned ? cover.device?.name : undefined }, filterNames, frames)
	const equipment = [wheelAssigned && 'Wheel', panelAssigned && 'Panel', coverAssigned && 'Cover'].filter((name) => name !== false)

	// Updates fields of the camera's Flat Wizard form.
	function update(patch: Partial<FlatWizardSettings>) {
		setFlatWizardSettings(profileState, identity, patch)
	}

	// Fills the Dark Library Wizard with the exposures these flats took, for the operator to review. Moves nothing.
	function prepareDarkFlats() {
		if (!device || !session) return
		const groups = darkFlatGroups(session)
		setDarkLibraryWizardSettings(profileState, identity, { purpose: 'darkFlat', groups })
		selectImageTool(imagesState, cameraTabKey(device.connectionId, device.id), 'dark-library-wizard')
	}

	// Updates fields of one filter group.
	function updateFilter(index: number, patch: Partial<FlatWizardFilter>) {
		update({ filters: settings.filters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter)) })
	}

	// Removes one filter group and collapses the rows, since the indexes after it shift.
	function removeFilter(index: number) {
		update({ filters: settings.filters.filter((_, i) => i !== index) })
		setExpanded(undefined)
	}

	// Appends a filter group after the last one and expands it for editing.
	function addFilter() {
		update({ filters: [...settings.filters, nextFilter(settings.filters, wheelState?.count)] })
		setExpanded(settings.filters.length)
	}

	function start() {
		if (!device) return
		const equipment = {
			...(wheelAssigned && wheel.device && { wheel: { connectionId: wheel.device.connectionId, deviceId: wheel.device.id } }),
			...(panelAssigned && flatPanel.device && { panel: { connectionId: flatPanel.device.connectionId, deviceId: flatPanel.device.id } }),
			...(coverAssigned && cover.device && { cover: { connectionId: cover.device.connectionId, deviceId: cover.device.id } }),
		}
		void startFlatWizard(flatWizardRuntime, device.connectionId, device.id, flatWizardRequest(settings, exposure, equipment, snoop, capabilities))
	}

	return (
		<>
			<CollapsibleSection id="images.flat-wizard.session" title={running ? 'Current Session' : session ? 'Last Session' : 'Session'} summary={session && FLAT_WIZARD_STATE_LABELS[session.state]}>
				{session && <SessionState session={session} />}
				<div className="flex flex-wrap gap-2">
					{running && session ? (
						<>
							{session.pending && (
								<Button className={COMMAND_CLASS} disabled={pending} onClick={() => void continueFlatWizard(flatWizardRuntime, session, session.pending!.stepId)}>
									Continue
								</Button>
							)}
							<Button variant="secondary" className={COMMAND_CLASS} title="Stop the session: the exposure in flight is lost, and the frames already saved stay" disabled={pending || session.state === 'stopping'} onClick={() => void stopFlatWizard(flatWizardRuntime, session)}>
								{session.state === 'stopping' ? 'Stopping…' : 'Stop'}
							</Button>
						</>
					) : (
						<>
							{followUp && (
								<>
									<Button className={COMMAND_CLASS} title="Fill the Dark Library Wizard with the exposures of these flats; nothing moves until it is started" onClick={prepareDarkFlats}>
										Prepare Matching Dark Flats
									</Button>
									<Button variant="secondary" className={COMMAND_CLASS} onClick={() => navigate(routeState, { workspace: 'tools', tool: 'calibration-library' })}>
										Open Calibration Library
									</Button>
								</>
							)}
							<Button variant={followUp ? 'secondary' : 'primary'} className={COMMAND_CLASS} title={startBlocker ?? preflight} disabled={startBlocker !== undefined || pending || device === undefined} onClick={start}>
								{session ? 'Start Again' : 'Start'}
							</Button>
						</>
					)}
				</div>
				{!running && (blocker ? <Notice>{blocker}</Notice> : !followUp && catalogCamera !== undefined && <Notice>{preflight}</Notice>)}
				{!running && <CatalogCameraNotice device={device} lead="Frames will be recorded against" purpose="to acquire calibration frames" />}
				{error && <Notice error>{error}</Notice>}
				{session && <SessionReadings session={session} />}
			</CollapsibleSection>
			{session && <Results session={session} />}
			<CollapsibleSection id="images.flat-wizard.equipment" title="Equipment" summary={equipment.length > 0 ? equipment.join(' · ') : 'Manual'}>
				<DataList>
					<DataRow label="Camera">
						<DeviceLink device={device} />
					</DataRow>
					<DataRow label="Filter Wheel">{wheelAssigned ? <DeviceLink device={wheel.device} /> : 'Manual'}</DataRow>
					<DataRow label="Flat Panel">{panelAssigned ? <DeviceLink device={flatPanel.device} /> : 'Manual'}</DataRow>
					<DataRow label="Cover">{coverAssigned ? <DeviceLink device={cover.device} /> : 'Not used'}</DataRow>
				</DataList>
				{!running && wheelAvailability && wheelAvailability.status !== 'ready' && <Notice>{wheelAvailability.message}</Notice>}
				{!running && panelAvailability && panelAvailability.status !== 'ready' && <Notice>{panelAvailability.message}</Notice>}
				{!running && coverAvailability && coverAvailability.status !== 'ready' && <Notice>{coverAvailability.message}</Notice>}
				{!running && (!wheelAssigned || !panelAssigned || !coverAssigned || coverAvailability?.status === 'unsupported') && wheel !== undefined && <EquipmentSetupButton />}
				{wheel === undefined && <Notice>Only the Main Camera of the equipment setup uses its filter wheel, flat panel, and cover: with this camera you change the filter and the light yourself, and the cover is left as it is.</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="images.flat-wizard.filters" title="Filters" summary={`${shown.filters.length} ${shown.filters.length === 1 ? 'filter' : 'filters'} · ${frames} frames`}>
				<div className="flex flex-col">
					{shown.filters.map((filter, index) => (
						<FilterRow
							key={index}
							index={index}
							filter={filter}
							name={filterNames[index]}
							wheel={wheelState}
							named={!wheelAssigned}
							brightness={panelAssigned ? (panelState?.intensity ?? { value: 0, min: 0, max: 0 }) : undefined}
							open={expanded === index}
							removable={shown.filters.length > 1}
							disabled={locked}
							onToggle={(open) => setExpanded(open ? index : undefined)}
							onChange={(patch) => updateFilter(index, patch)}
							onRemove={() => removeFilter(index)}
						/>
					))}
				</div>
				{shown.filters.length < FLAT_WIZARD_MAXIMUM_FILTERS && (
					<Button variant="secondary" className="self-start" disabled={locked} onClick={addFilter}>
						Add Filter
					</Button>
				)}
			</CollapsibleSection>
			<CollapsibleSection id="images.flat-wizard.output" title="Output" summary={`${shown.directory ?? 'Default directory'}${shown.generateMasters ? ' · masters' : ''}`} defaultOpen={false}>
				<div className="flex items-end gap-1">
					<TextInput label="Server Directory" className="flex-1" placeholder="~/Nebulosa/captures" value={shown.directory ?? ''} disabled={locked} onChange={(e) => update({ directory: e.target.value.trim() || undefined })} />
					<IconButton icon="folder" label="Choose directory" className="size-11" disabled={locked} onClick={() => setChoosingDirectory(true)} />
				</div>
				<Notice>Accepted frames are saved in its flats/ folder; existing files are never replaced.</Notice>
				<Checkbox label="Generate masters after acquisition" checked={shown.generateMasters === true} disabled={locked} onChange={(generateMasters) => update({ generateMasters: generateMasters || undefined })} />
				{shown.generateMasters === true && <Notice>Each filter that completes becomes a master flat in the Calibration Library, corrected by the newest master dark-flat, or else the newest master bias, that matches its frames. Without one, its flats wait there for you.</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="images.flat-wizard.limits" title="Limits" summary={limitsSummary(shown)} defaultOpen={false}>
				<Checkbox label="Known Effective Clipping" checked={shown.effectiveClip !== undefined} disabled={locked} onChange={(known) => update({ effectiveClip: known ? DEFAULT_FLAT_WIZARD_EFFECTIVE_CLIP : undefined })} />
				{shown.effectiveClip !== undefined && <NumberInput label="Effective Clipping" value={shown.effectiveClip} min={1} step={1} suffix="DN" disabled={locked} onChange={(effectiveClip) => update({ effectiveClip })} />}
				<Notice>
					{shown.effectiveClip === undefined
						? 'Without the level at which the sensor saturates, a frame inside its target is accepted, but the absence of saturation is reported as unknown.'
						: 'Samples at or above this level are clipped; a clipped frame is rejected. Keep it a little below the highest value the camera writes, which can be under the 65535 DN of the file format.'}
				</Notice>
				{panelAssigned && <NumberInput label="Settle Time" value={shown.settleTime} min={0} max={600} step={0.5} suffix="s" disabled={locked} onChange={(settleTime) => update({ settleTime })} />}
				<div className="grid grid-cols-2 gap-2">
					<NumberInput label="Trial Frames" value={shown.maximumTrials} min={1} max={FLAT_WIZARD_MAXIMUM_TRIALS} disabled={locked} onChange={(maximumTrials) => update({ maximumTrials })} />
					<NumberInput label="Rejections" value={shown.maximumRejections} min={0} max={FLAT_WIZARD_MAXIMUM_REJECTIONS} disabled={locked} onChange={(maximumRejections) => update({ maximumRejections })} />
				</div>
				<Notice>Trial frames search the exposure of each filter and are never saved; rejected frames are deleted. A filter fails beyond these limits.</Notice>
			</CollapsibleSection>
			<CameraAcquisitionSection
				id="images.flat-wizard.acquisition"
				device={device}
				exposure={running && session ? session.request.capture : exposure}
				capabilities={capabilities}
				defaultOpen={false}
				summary={`${exposure.binX}×${exposure.binY}`}
				description="Frames are FLAT frames taken with the camera settings of Camera Acquisition; the wizard searches their exposure. Levels are the original digital numbers (DN) of each file, not the stretched view."
			/>
			<FileExplorerModal
				open={choosingDirectory}
				mode="directory"
				title="Flat Directory"
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

// Returns the filter group a new row starts with: the settings of the last group at the next slot, wrapping around
// the slots of the wheel when known, or the default group when there is none. A typed name is not carried over.
function nextFilter(filters: readonly FlatWizardFilter[], slots: number | undefined): FlatWizardFilter {
	const last = filters.at(-1)
	if (!last) return DEFAULT_FLAT_WIZARD_FILTER
	const { name: _, ...settings } = last
	return { ...settings, slot: slots !== undefined && slots > 0 ? (last.slot + 1) % slots : last.slot + 1 }
}

// Returns the form values a session applied, to show while it runs.
function appliedSettings({ request }: Pick<FlatWizardSessionSummary, 'request'>): FlatWizardSettings {
	const { filters, settleTime, directory, effectiveClip, maximumTrials, maximumRejections, generateMasters } = request
	return { filters: [...filters], settleTime, directory, effectiveClip, maximumTrials, maximumRejections, generateMasters }
}

// Returns the one-line summary of the limits, short enough to fit beside the heading: the clipping level when known,
// and the frame limits.
function limitsSummary(settings: Readonly<FlatWizardSettings>) {
	return [...(settings.effectiveClip === undefined ? [] : [`${settings.effectiveClip} DN`]), `${settings.maximumTrials} trials`, `${settings.maximumRejections} rejections`].join(' · ')
}

interface FilterRowProps {
	// Position of the group, from 0.
	readonly index: number
	// Group shown.
	readonly filter: Readonly<FlatWizardFilter>
	// Name the filter goes by, as the server will name it.
	readonly name: string
	// Slots and names the assigned wheel reports; absent without a wheel or while its state is unknown, when the slot
	// is typed as a number.
	readonly wheel?: Pick<WheelState, 'count' | 'names'>
	// Whether the operator names the filter, since no wheel names it.
	readonly named: boolean
	// Brightness the assigned panel reports and its range, in driver units; absent without a panel. Setting the brightness
	// starts from the reported one, since the maximum would most likely saturate the shortest exposure.
	readonly brightness?: { readonly value: number; readonly min: number; readonly max: number }
	// Whether the row is expanded for editing.
	readonly open: boolean
	// Whether the group can be removed.
	readonly removable: boolean
	// Whether the form is locked.
	readonly disabled: boolean
	// Expands or collapses the row.
	readonly onToggle: (open: boolean) => void
	// Applies changed fields.
	readonly onChange: (patch: Partial<FlatWizardFilter>) => void
	// Removes the group.
	readonly onRemove: () => void
}

// One filter group: a row with its name, frame count, and target, or what to fix, that expands into its fields.
function FilterRow({ index, filter, name, wheel, named, brightness, open, removable, disabled, onToggle, onChange, onRemove }: FilterRowProps) {
	// A slot beyond the wheel stays listed, so the form never shows another slot than the one it holds.
	const slots = wheel ? Array.from({ length: Math.max(wheel.count, filter.slot + 1) }, (_, slot) => String(slot)) : undefined
	const problems = flatWizardFilterProblems(filter)
	const invalid = problems.exposure !== undefined || problems.target !== undefined

	return (
		<details open={open} onToggle={(e) => e.currentTarget.open !== open && onToggle(e.currentTarget.open)} className="border-t border-line-200 first:border-t-0">
			<summary className="flex cursor-pointer list-none items-center gap-2 py-2 select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent pointer-coarse:min-h-[44px] [&::-webkit-details-marker]:hidden">
				<Icon name="stepForward" className="size-3.5 flex-none text-ink-300 transition-transform duration-150 motion-reduce:transition-none [details[open]>summary>&]:rotate-90" />
				<span className="min-w-0 flex-1 truncate text-ink-100">{`${index + 1}. ${name}`}</span>
				<span className={invalid ? 'flex-none text-xs text-danger' : 'flex-none text-xs text-ink-200 tabular-nums'}>{invalid ? 'Check the fields' : `${filter.count} ${filter.count === 1 ? 'frame' : 'frames'} · ${filter.targetRange[0]}–${filter.targetRange[1]} DN`}</span>
			</summary>
			<div className="flex flex-col gap-2 pb-3">
				{named && <TextInput label="Filter Name" placeholder={`Filter ${filter.slot + 1}`} value={filter.name ?? ''} disabled={disabled} onChange={(e) => onChange({ name: e.target.value || undefined })} />}
				{slots ? (
					<Select label="Wheel Slot" options={slots} value={String(filter.slot)} format={(value) => `${Number(value) + 1}: ${flatWizardFilterName(wheel?.names ?? [], Number(value))}`} disabled={disabled} onChange={(value) => onChange({ slot: Number(value) })} />
				) : (
					<NumberInput label="Filter Slot" value={filter.slot + 1} min={1} disabled={disabled} onChange={(slot) => onChange({ slot: slot - 1 })} />
				)}
				<NumberInput label="Frames" value={filter.count} min={1} max={FLAT_WIZARD_MAXIMUM_COUNT} disabled={disabled} onChange={(count) => onChange({ count })} />
				{filter.count < FLAT_WIZARD_STABILITY_FRAMES && <Notice warning>{`With fewer than ${FLAT_WIZARD_STABILITY_FRAMES} frames, the flats are saved but their stability is not assessed.`}</Notice>}
				<NumberInput label="First Exposure" value={filter.initialExposure} min={filter.minimumExposure} max={filter.maximumExposure} step={0.01} suffix="s" disabled={disabled} onChange={(initialExposure) => onChange({ initialExposure })} />
				<NumberInput label="Min Exposure" value={filter.minimumExposure} min={0.001} max={FLAT_WIZARD_MAXIMUM_EXPOSURE} step={0.001} suffix="s" disabled={disabled} onChange={(minimumExposure) => onChange({ minimumExposure })} />
				<NumberInput label="Max Exposure" value={filter.maximumExposure} min={0.001} max={FLAT_WIZARD_MAXIMUM_EXPOSURE} step={0.1} suffix="s" disabled={disabled} onChange={(maximumExposure) => onChange({ maximumExposure })} />
				{problems.exposure && <Notice error>{problems.exposure}</Notice>}
				<NumberInput label="Target Min" value={filter.targetRange[0]} min={0} step={100} suffix="DN" disabled={disabled} onChange={(minimum) => onChange({ targetRange: [minimum, filter.targetRange[1]] })} />
				<NumberInput label="Target Max" value={filter.targetRange[1]} min={0} step={100} suffix="DN" disabled={disabled} onChange={(maximum) => onChange({ targetRange: [filter.targetRange[0], maximum] })} />
				<Notice error={problems.target !== undefined}>{problems.target ?? 'The target applies to the brightest plane of the frame; the other planes of a color sensor are only checked for clipping.'}</Notice>
				{brightness && (
					<>
						<Checkbox label="Set Panel Brightness" checked={filter.brightness !== undefined} disabled={disabled} onChange={(set) => onChange({ brightness: set ? brightness.value : undefined })} />
						{filter.brightness !== undefined && <NumberInput label="Brightness" value={filter.brightness} min={brightness.min} max={brightness.max > brightness.min ? brightness.max : undefined} disabled={disabled} onChange={(value) => onChange({ brightness: value })} />}
					</>
				)}
				{removable && (
					<Button variant="secondary" className="self-start" disabled={disabled} onClick={onRemove}>
						Remove Filter
					</Button>
				)}
			</div>
		</details>
	)
}

// State of the running or last session: its phase, the exposure in flight, its failure, and the manual step it waits for,
// said as the instruction Continue confirms.
function SessionState({ session }: { readonly session: FlatWizardSessionSummary }) {
	const failed = session.state === 'failed'

	return (
		<>
			<SessionStateText failed={failed} succeeded={session.state === 'completed'}>
				{FLAT_WIZARD_STATE_LABELS[session.state]}
			</SessionStateText>
			{session.state === 'exposing' && <FrameProgress exposure={session.exposure} />}
			{failed && session.error && <Notice error>{session.error}</Notice>}
			{session.pending && <p className="m-0 text-sm leading-5 text-pretty text-ink-100">{flatWizardStepText(session.pending, session.filters, session.panel !== undefined)}</p>}
		</>
	)
}

// Readings of the filter in progress: its position, step, exposure, and accepted frames, and the latest frame with its
// levels while that frame belongs to it.
function SessionReadings({ session }: { readonly session: FlatWizardSessionSummary }) {
	const run = session.filters[session.filter] as FlatWizardSessionSummary['filters'][number] | undefined
	// The latest frame of an earlier filter says nothing about this one.
	const attempt = session.lastAttempt?.filter === session.filter ? session.lastAttempt : undefined
	const notes = attempt?.reasons.flatMap((reason) => FLAT_WIZARD_DIAGNOSTIC_LABELS[reason] ?? []) ?? []
	if (!run || !flatWizardRunning(session)) return null

	return (
		<>
			<DataList>
				<DataRow label="Filter">{`${run.name} (${session.filter + 1} of ${session.filters.length})`}</DataRow>
				{flatWizardShowsStep(session.state) && <DataRow label="Step">{FLAT_WIZARD_FILTER_STATE_LABELS[run.state]}</DataRow>}
				{run.exposure !== undefined ? <DataRow label="Exposure">{formatExposureTime(run.exposure)}</DataRow> : run.candidateExposure !== undefined && <DataRow label="Trying">{formatExposureTime(run.candidateExposure)}</DataRow>}
				<DataRow label="Accepted">{`${run.accepted} of ${run.required}`}</DataRow>
				{attempt && <DataRow label="Last Frame">{`${FLAT_WIZARD_VERDICT_LABELS[attempt.verdict]}, ${formatExposureTime(attempt.exposure)}`}</DataRow>}
				{attempt?.planes.map((plane) => (
					<DataRow key={plane.plane} label={FLAT_WIZARD_PLANE_LABELS[plane.plane]}>
						{plane.median === undefined ? MISSING : `${Math.round(plane.median)} DN${plane.upperClipping === 'present' ? ', clipped' : ''}`}
					</DataRow>
				))}
			</DataList>
			{notes.length > 0 && <Notice>{notes.join(' ')}</Notice>}
			{session.previewError && <Notice>{session.previewError}</Notice>}
		</>
	)
}

// Outcome of every filter group: the exposure, the counts, the stability of the saved frames, the masters handed to the
// Calibration Library, and the cleanup. Masters are built in the Calibration Library, and dark-flats are a plan of the
// Dark Library Wizard the operator reviews and starts.
function Results({ session }: { readonly session: FlatWizardSessionSummary }) {
	const completed = session.filters.filter((run) => run.state === 'completed')
	const notes = flatWizardResultNotes(session.filters)

	return (
		<CollapsibleSection id="images.flat-wizard.results" title="Results" summary={`${completed.length} of ${session.filters.length} filters`}>
			<DataList>
				{session.filters.map((run, index) => (
					<DataRow key={index} label={run.name}>
						{run.state === 'pending' ? FLAT_WIZARD_FILTER_STATE_LABELS.pending : `${run.accepted} of ${run.required} saved${run.rejected + run.inconclusive > 0 ? `, ${run.rejected + run.inconclusive} discarded` : ''}${run.exposure !== undefined ? ` at ${formatExposureTime(run.exposure)}` : ''}`}
					</DataRow>
				))}
			</DataList>
			{notes.map((note) => (
				<Notice key={`${note.error}:${note.text}`} error={note.error}>{`${note.filters.join(', ')}: ${note.text}`}</Notice>
			))}
			{session.request.generateMasters && session.endedAt !== undefined && completed.length > 0 && <Notice>{`${completed.map((run) => run.name).join(', ')} went to the Calibration Library to become master flats.`}</Notice>}
			{session.cleanupWarning && <Notice error>{session.cleanupWarning}</Notice>}
		</CollapsibleSection>
	)
}
