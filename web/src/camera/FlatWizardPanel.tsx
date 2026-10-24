import type { CaptureSnoop, DeviceSummary, FlatWizardFilter, FlatWizardFilterRun, FlatWizardSessionSummary, WheelState } from 'api'
import { cn } from 'cn'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { Notice } from '../equipment-control/parts'
import { type RoleAvailability, roleAvailability } from '../equipment/availability'
import { deviceState } from '../equipment/equipment'
import type { RoleDevice } from '../equipment/useEquipment'
import { FileExplorerModal } from '../files/FileExplorerModal'
import { operationsState } from '../operations'
import { activeProfile, exposureSettings, flatWizardSettings, profileState, setFlatWizardSettings } from '../profile/profile'
import { type CameraIdentity, DEFAULT_FLAT_WIZARD_FILTER, FLAT_WIZARD_MAXIMUM_COUNT, FLAT_WIZARD_MAXIMUM_EXPOSURE, FLAT_WIZARD_MAXIMUM_FILTERS, FLAT_WIZARD_MAXIMUM_REJECTIONS, FLAT_WIZARD_MAXIMUM_TRIALS, type FlatWizardSettings } from '../profile/schema'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { IconButton } from '../ui/IconButton'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { cameraKey } from './capture'
import { continueFlatWizard, flatWizardFilterName, FLAT_WIZARD_DIAGNOSTIC_LABELS, FLAT_WIZARD_FILTER_STATE_LABELS, FLAT_WIZARD_STATE_LABELS, FLAT_WIZARD_VERDICT_LABELS, flatWizardBlocker, flatWizardRequest, flatWizardRunning, flatWizardRuntime, startFlatWizard, stopFlatWizard } from './flatwizard'
import { FrameProgress, formatExposure } from './FrameProgress'

// Contextual panel sections of Flat Wizard, a camera operation of the Images camera tabs: the equipment it uses (the
// tab's camera, and the filter wheel, flat panel, and cover of the setup when the camera has a role, else manual
// filters and light and an untouched cover), the settings of the next session (output directory, effective clipping level, settle time, and limits), the
// filter groups (filter slot, named as the wheel names it or "Filter <slot + 1>", frame count, exposure bounds, DN
// target, panel brightness), the progress of the running session with its Continue and Stop commands, and the results of each group. Frames take the camera settings
// of Camera Acquisition, but never its exposure time, which the wizard searches. Levels are the camera's original
// digital numbers (DN), never the stretched view. The form is the camera's, kept in the profile, and shows the values
// applied while a session runs; the session is the server's, shown here whichever tab started it, and keeps running
// when the panel unmounts. A manual step is confirmed only by its Continue button.

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

	// Updates fields of the camera's Flat Wizard form.
	function update(patch: Partial<FlatWizardSettings>) {
		setFlatWizardSettings(profileState, identity, patch)
	}

	// Updates fields of one filter group.
	function updateFilter(index: number, patch: Partial<FlatWizardFilter>) {
		update({ filters: settings.filters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter)) })
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
			<PanelSection title="Equipment">
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					<Row label="Camera">
						<DeviceLink device={device} fallback="—" />
					</Row>
					<Row label="Filter Wheel">{wheelAssigned ? <DeviceLink device={wheel.device} fallback="—" /> : 'Manual'}</Row>
					<Row label="Flat Panel">{panelAssigned ? <DeviceLink device={flatPanel.device} fallback="—" /> : 'Manual'}</Row>
					<Row label="Cover">{coverAssigned ? <DeviceLink device={cover.device} fallback="—" /> : 'Not used'}</Row>
				</dl>
				{!running && wheelAvailability && wheelAvailability.status !== 'ready' && <Notice>{wheelAvailability.message}</Notice>}
				{!running && panelAvailability && panelAvailability.status !== 'ready' && <Notice>{panelAvailability.message}</Notice>}
				{!running && coverAvailability && coverAvailability.status !== 'ready' && <Notice>{coverAvailability.message}</Notice>}
				{coverAssigned && <Notice>The cover closes before the first frame and opens again when the session ends, unless it was already closed.</Notice>}
				{!running && (!wheelAssigned || !panelAssigned || !coverAssigned || coverAvailability?.status === 'unsupported') && wheel !== undefined && (
					<Button variant="secondary" className="self-start" onClick={() => (deviceState.open = true)}>
						Equipment Setup
					</Button>
				)}
				{wheel === undefined && <Notice>The camera has no role in the equipment setup, so you change the filters and the light yourself and confirm each step; the cover is left as it is.</Notice>}
				<Notice>Frames are FLAT frames taken with the camera settings of Camera Acquisition; the wizard searches their exposure. Levels are the original digital numbers (DN) of each file, not the stretched view.</Notice>
			</PanelSection>
			<PanelSection title="Settings">
				<div className="flex items-end gap-1">
					<TextInput label="Server Directory" className="flex-1" placeholder="~/Nebulosa/captures" value={shown.directory ?? ''} disabled={locked} onChange={(e) => update({ directory: e.target.value.trim() || undefined })} />
					<IconButton icon="folder" label="Choose directory" className="size-[38px]" disabled={locked} onClick={() => setChoosingDirectory(true)} />
				</div>
				<Checkbox label="Known Effective Clipping" checked={shown.effectiveClip !== undefined} disabled={locked} onChange={(known) => update({ effectiveClip: known ? 65535 : undefined })} />
				{shown.effectiveClip !== undefined && <NumberInput label="Effective Clipping" value={shown.effectiveClip} min={1} step={1} suffix="DN" disabled={locked} onChange={(effectiveClip) => update({ effectiveClip })} />}
				<Notice>{shown.effectiveClip === undefined ? 'Without the level at which the sensor saturates, a frame inside its target is accepted, but the absence of saturation is reported as unknown.' : 'Samples at or above this level are clipped; a clipped frame is rejected.'}</Notice>
				{panelAssigned && <NumberInput label="Settle Time" value={shown.settleTime} min={0} max={600} step={0.5} suffix="s" disabled={locked} onChange={(settleTime) => update({ settleTime })} />}
				<div className="grid grid-cols-2 gap-2">
					<NumberInput label="Trial Frames" value={shown.maximumTrials} min={1} max={FLAT_WIZARD_MAXIMUM_TRIALS} disabled={locked} onChange={(maximumTrials) => update({ maximumTrials })} />
					<NumberInput label="Rejections" value={shown.maximumRejections} min={0} max={FLAT_WIZARD_MAXIMUM_REJECTIONS} disabled={locked} onChange={(maximumRejections) => update({ maximumRejections })} />
				</div>
				<Notice>Trial frames search the exposure of each filter and are never saved; rejected frames are deleted, and a filter fails beyond these limits. Existing files are never replaced.</Notice>
			</PanelSection>
			<PanelSection title="Filters">
				{shown.filters.map((filter, index) => (
					<FilterForm
						key={index}
						index={index}
						filter={filter}
						wheel={wheelState}
						brightness={panelAssigned ? (panelState?.intensity ?? { min: 0, max: 0 }) : undefined}
						removable={shown.filters.length > 1}
						disabled={locked}
						onChange={(patch) => updateFilter(index, patch)}
						onRemove={() => update({ filters: settings.filters.filter((_, i) => i !== index) })}
					/>
				))}
				{shown.filters.length < FLAT_WIZARD_MAXIMUM_FILTERS && (
					<Button variant="secondary" className="self-start" disabled={locked} onClick={() => update({ filters: [...settings.filters, nextFilter(settings.filters, wheelState?.count)] })}>
						Add Filter
					</Button>
				)}
				<Notice>The target applies to the brightest plane of the frame; the other planes of a color sensor are only checked for clipping.</Notice>
			</PanelSection>
			{session && <Progress session={session} pending={pending} />}
			{session && <Results session={session} />}
			<PanelSection title="Controls">
				{running ? (
					<Button variant="secondary" disabled={pending || session?.state === 'stopping'} onClick={() => void stopFlatWizard(flatWizardRuntime, session!)}>
						Stop
					</Button>
				) : (
					<Button disabled={blocker !== undefined || pending || device === undefined} onClick={start}>
						Start
					</Button>
				)}
				{blocker && <Notice>{blocker}</Notice>}
				{running && <Notice>Stopping aborts the exposure in flight; the frames already saved stay.</Notice>}
				{error && <Notice error>{error}</Notice>}
			</PanelSection>
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
// the slots of the wheel when known, or the default group when there is none.
function nextFilter(filters: readonly FlatWizardFilter[], slots: number | undefined): FlatWizardFilter {
	const last = filters.at(-1)
	if (!last) return DEFAULT_FLAT_WIZARD_FILTER
	return { ...last, slot: slots !== undefined && slots > 0 ? (last.slot + 1) % slots : last.slot + 1 }
}

// Returns the form values a session applied, to show while it runs.
function appliedSettings({ request }: Pick<FlatWizardSessionSummary, 'request'>): FlatWizardSettings {
	const { filters, settleTime, directory, effectiveClip, maximumTrials, maximumRejections } = request
	return { filters: [...filters], settleTime, directory, effectiveClip, maximumTrials, maximumRejections }
}

interface FilterFormProps {
	// Position of the group, from 0.
	readonly index: number
	// Group shown.
	readonly filter: Readonly<FlatWizardFilter>
	// Slots and names the assigned wheel reports; absent without a wheel or while its state is unknown, when the slot
	// is typed as a number.
	readonly wheel?: Pick<WheelState, 'count' | 'names'>
	// Brightness range of the assigned panel; absent without a panel.
	readonly brightness?: { readonly min: number; readonly max: number }
	// Whether the group can be removed.
	readonly removable: boolean
	// Whether the form is locked.
	readonly disabled: boolean
	// Applies changed fields.
	readonly onChange: (patch: Partial<FlatWizardFilter>) => void
	// Removes the group.
	readonly onRemove: () => void
}

// Fields of one filter group.
function FilterForm({ index, filter, wheel, brightness, removable, disabled, onChange, onRemove }: FilterFormProps) {
	// A slot beyond the wheel stays listed, so the form never shows another slot than the one it holds.
	const slots = wheel ? Array.from({ length: Math.max(wheel.count, filter.slot + 1) }, (_, slot) => String(slot)) : undefined

	return (
		<fieldset className="m-0 flex flex-col gap-2 border-0 border-t border-line-200 p-0 pt-2 first:border-t-0 first:pt-0">
			<div className="flex items-center gap-1">
				<p className="m-0 flex-1 truncate text-ink-100">{`${index + 1}. ${flatWizardFilterName(wheel?.names, filter.slot)}`}</p>
				{removable && <IconButton icon="close" label={`Remove filter ${index + 1}`} className="size-[38px]" disabled={disabled} onClick={onRemove} />}
			</div>
			{slots ? (
				<Select label="Wheel Slot" options={slots} value={String(filter.slot)} format={(value) => `${Number(value) + 1}: ${flatWizardFilterName(wheel?.names, Number(value))}`} disabled={disabled} onChange={(value) => onChange({ slot: Number(value) })} />
			) : (
				<NumberInput label="Filter Slot" value={filter.slot + 1} min={1} disabled={disabled} onChange={(slot) => onChange({ slot: slot - 1 })} />
			)}
			<div className="flex flex-col gap-2">
				<NumberInput label="Frames" value={filter.count} min={1} max={FLAT_WIZARD_MAXIMUM_COUNT} disabled={disabled} onChange={(count) => onChange({ count })} />
				<NumberInput label="First Exposure" value={filter.initialExposure} min={filter.minimumExposure} max={filter.maximumExposure} step={0.01} suffix="s" disabled={disabled} onChange={(initialExposure) => onChange({ initialExposure })} />
				<NumberInput label="Min Exposure" value={filter.minimumExposure} min={0.001} max={FLAT_WIZARD_MAXIMUM_EXPOSURE} step={0.001} suffix="s" disabled={disabled} onChange={(minimumExposure) => onChange({ minimumExposure })} />
				<NumberInput label="Max Exposure" value={filter.maximumExposure} min={0.001} max={FLAT_WIZARD_MAXIMUM_EXPOSURE} step={0.1} suffix="s" disabled={disabled} onChange={(maximumExposure) => onChange({ maximumExposure })} />
				<NumberInput label="Target Min" value={filter.targetRange[0]} min={0} step={100} suffix="DN" disabled={disabled} onChange={(minimum) => onChange({ targetRange: [minimum, filter.targetRange[1]] })} />
				<NumberInput label="Target Max" value={filter.targetRange[1]} min={0} step={100} suffix="DN" disabled={disabled} onChange={(maximum) => onChange({ targetRange: [filter.targetRange[0], maximum] })} />
			</div>
			{brightness && (
				<>
					<Checkbox label="Set Panel Brightness" checked={filter.brightness !== undefined} disabled={disabled} onChange={(set) => onChange({ brightness: set ? brightness.max : undefined })} />
					{filter.brightness !== undefined && <NumberInput label="Brightness" value={filter.brightness} min={brightness.min} max={brightness.max > brightness.min ? brightness.max : undefined} disabled={disabled} onChange={(value) => onChange({ brightness: value })} />}
				</>
			)}
		</fieldset>
	)
}

interface ProgressProps {
	// Latest session of the camera.
	readonly session: FlatWizardSessionSummary
	// Whether a command of this tab is waiting for the server.
	readonly pending: boolean
}

// State of the running or last session: its phase, the filter in progress and its exposure, the latest frame, and the
// manual step it waits for with its Continue button.
function Progress({ session, pending }: ProgressProps) {
	const run = session.filters[session.filter] as FlatWizardFilterRun | undefined
	const attempt = session.lastAttempt
	const step = session.pending
	const failed = session.state === 'failed'
	const notes = attempt?.reasons.flatMap((reason) => FLAT_WIZARD_DIAGNOSTIC_LABELS[reason] ?? []) ?? []

	return (
		<PanelSection title="Progress">
			<p className={cn('m-0', failed ? 'text-danger' : 'text-ink-100')}>{FLAT_WIZARD_STATE_LABELS[session.state]}</p>
			{session.state === 'exposing' && <FrameProgress exposure={session.exposure} />}
			{failed && session.error && <Notice error>{session.error}</Notice>}
			{step && (
				<>
					<Notice>{step.kind === 'filter' ? `Put ${session.filters[step.filter].name} in place${session.panel ? '' : ' and switch the light on'}, then continue.` : `Make sure the light is on and stable for ${session.filters[step.filter].name}, then continue.`}</Notice>
					<Button disabled={pending} onClick={() => void continueFlatWizard(flatWizardRuntime, session, step.stepId)}>
						Continue
					</Button>
				</>
			)}
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				{run && <Row label="Filter">{`${run.name} (${session.filter + 1} of ${session.filters.length})`}</Row>}
				{run && <Row label="Step">{FLAT_WIZARD_FILTER_STATE_LABELS[run.state]}</Row>}
				{run?.exposure !== undefined ? <Row label="Exposure">{formatExposure(run.exposure)}</Row> : run?.candidateExposure !== undefined && <Row label="Trying">{formatExposure(run.candidateExposure)}</Row>}
				{run && <Row label="Accepted">{`${run.accepted} of ${run.required}`}</Row>}
				{attempt && <Row label="Last Frame">{`${FLAT_WIZARD_VERDICT_LABELS[attempt.verdict]}, ${formatExposure(attempt.exposure)}`}</Row>}
				{attempt?.planes.map((plane) => (
					<Row key={plane.plane} label={`Level ${plane.plane}`}>
						{plane.median === undefined ? '—' : `${Math.round(plane.median)} DN${plane.upperClipping === 'present' ? ', clipped' : ''}`}
					</Row>
				))}
			</dl>
			{notes.length > 0 && <Notice>{notes.join(' ')}</Notice>}
			{session.previewError && <Notice>{session.previewError}</Notice>}
		</PanelSection>
	)
}

// Outcome of every filter group: the exposure, the counts, the stability of the saved frames, and the cleanup.
function Results({ session }: { readonly session: FlatWizardSessionSummary }) {
	return (
		<PanelSection title="Results">
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				{session.filters.map((run, index) => (
					<Row key={index} label={run.name}>
						{run.state === 'pending' ? FLAT_WIZARD_FILTER_STATE_LABELS.pending : `${run.accepted}/${run.required} saved${run.rejected + run.inconclusive > 0 ? `, ${run.rejected + run.inconclusive} discarded` : ''}${run.exposure !== undefined ? ` at ${formatExposure(run.exposure)}` : ''}`}
					</Row>
				))}
			</dl>
			{session.filters.map((run, index) => (
				<FilterNotes key={index} run={run} />
			))}
			{session.cleanupWarning && <Notice error>{session.cleanupWarning}</Notice>}
		</PanelSection>
	)
}

// Failure and sequence assessment of one filter group.
function FilterNotes({ run }: { readonly run: FlatWizardFilterRun }) {
	const { sequence } = run
	if (run.error) return <Notice error>{`${run.name}: ${run.error}`}</Notice>
	if (!sequence) return null
	if (sequence.status === 'notEvaluated') return <Notice>{`${run.name}: stability not evaluated (${sequence.reason}).`}</Notice>

	const notes = sequence.reasons.flatMap((reason) => FLAT_WIZARD_DIAGNOSTIC_LABELS[reason] ?? [])
	const verdict = sequence.verdict === 'accepted' ? 'stable' : sequence.verdict === 'rejected' ? 'unstable' : 'not proven stable'
	return <Notice error={sequence.verdict === 'rejected'}>{`${run.name}: ${verdict}.${sequence.outliers.length > 0 ? ` Outliers: ${sequence.outliers.join(', ')}.` : ''}${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`}</Notice>
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
