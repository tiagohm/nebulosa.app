import type { FlipStrategyChoice, MeridianFlipExecutorPolicy, MeridianFlipMonitor, MeridianFlipSettings } from 'api'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../../equipment-control/control'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { type RoleDevice, useRoleDevice } from '../../equipment/useEquipment'
import { formatFixed, MISSING } from '../../format'
import { activeProfile, meridianFlipExecutorPolicy, profileCamera, profileState, setMeridianFlipExecutorPolicy } from '../../profile/profile'
import { MERIDIAN_FLIP_MAXIMUM_SECONDS } from '../../profile/schema'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { MERIDIAN_FLIP_MAXIMUM_SETTLE_SECONDS, MERIDIAN_PIER_SIDES, MOUNT_TYPE_LABELS, sameMeridianFlipSettings } from './meridianflip'
import { latestExecution, meridianFlipExecutorState } from './meridianflipexecutor'
import { MeridianFlipToolSections } from './MeridianFlipToolSections'

// Flip Settings, the contextual panel of the Meridian Flip tool, which holds what is set rather than read: the flip
// window of the monitor, edited as a draft the tool view owns (its Enable takes it too) and applied explicitly; the flip
// policy of the Executor and its advanced options, remembered by the profile per mount and locked while a flip runs; the
// equipment of the Equipment Setup a flip uses; and the summaries of the camera tools a flip invokes
// (MeridianFlipToolSections.tsx).

// Text of each strategy choice.
const STRATEGIES: Readonly<Record<FlipStrategyChoice, string>> = { auto: 'Automatic', nativeFlip: 'Native flip', forcedGoto: 'Forced GoTo' }

interface MeridianFlipPanelProps {
	// Mount of the Equipment Setup.
	readonly mount: RoleDevice
	// Monitor of that mount, whose settings are in force; absent while it is not enabled.
	readonly monitor?: MeridianFlipMonitor
	// Flip window being edited, in seconds.
	readonly draft: MeridianFlipSettings
	// Replaces the flip window being edited.
	readonly onDraftChange: (settings: MeridianFlipSettings) => void
	// Flip window the profile remembers for the mount.
	readonly saved: MeridianFlipSettings
	// Whether a request of the monitor is in flight.
	readonly pending: boolean
	// Remembers the draft and applies it to the running monitor.
	readonly onApply: () => void
}

// Sections of the contextual panel: the flip window of the monitor, then the sections the Executor reads.
export function MeridianFlipPanel({ mount, monitor, draft, onDraftChange, saved, pending, onApply }: MeridianFlipPanelProps) {
	return (
		<>
			<WindowSection draft={draft} onChange={onDraftChange} monitor={monitor} saved={saved} pending={pending} onApply={onApply} />
			<ExecutorSections mount={mount} />
		</>
	)
}

interface WindowSectionProps {
	// Settings being edited, in seconds.
	readonly draft: MeridianFlipSettings
	// Replaces the settings being edited.
	readonly onChange: (settings: MeridianFlipSettings) => void
	// Running monitor, whose settings are in force.
	readonly monitor?: MeridianFlipMonitor
	// Settings the profile remembers for the mount.
	readonly saved: MeridianFlipSettings
	// Whether a request of the monitor is in flight.
	readonly pending: boolean
	// Remembers the draft and applies it to the running monitor.
	readonly onApply: () => void
}

// Flip window of the mount: the early warning, the window, and its closing warning in minutes after the upper transit,
// the settle time in seconds, and Apply (or Remember while the monitor is off, whose Enable also takes them).
function WindowSection({ draft, onChange, monitor, saved, pending, onApply }: WindowSectionProps) {
	const maximumMinutes = Math.floor(MERIDIAN_FLIP_MAXIMUM_SECONDS / 60)
	const running = monitor?.settings
	const changed = running ? !sameMeridianFlipSettings(draft, running) : !sameMeridianFlipSettings(draft, saved)
	const minutes = (field: keyof MeridianFlipSettings) => (value: number) => onChange({ ...draft, [field]: value * 60 })
	const inForce = running ?? saved

	return (
		<CollapsibleSection id="meridianFlip.window" title="Flip Window" summary={`${formatFixed(inForce.minimumSeconds / 60, 0)} to ${formatFixed(inForce.maximumSeconds / 60, 0)} min after transit`}>
			<NumberInput label="Early warning" value={draft.earlyWarningSeconds / 60} min={0} max={maximumMinutes} suffix="min" disabled={pending} onChange={minutes('earlyWarningSeconds')} />
			<NumberInput label="Window opens after transit" value={draft.minimumSeconds / 60} min={0} max={draft.maximumSeconds / 60} suffix="min" disabled={pending} onChange={minutes('minimumSeconds')} />
			<NumberInput label="Window closes after transit" value={draft.maximumSeconds / 60} min={0} max={maximumMinutes} suffix="min" disabled={pending} onChange={minutes('maximumSeconds')} />
			<NumberInput label="Closing warning" value={draft.deadlineWarningSeconds / 60} min={0} max={(draft.maximumSeconds - draft.minimumSeconds) / 60} suffix="min" disabled={pending} onChange={minutes('deadlineWarningSeconds')} />
			<NumberInput label="Settle time" value={draft.settleSeconds} min={0} max={MERIDIAN_FLIP_MAXIMUM_SETTLE_SECONDS} suffix="s" disabled={pending} onChange={(value) => onChange({ ...draft, settleSeconds: value })} />
			{running && changed && <Notice>The running monitor uses other settings until these are applied.</Notice>}
			<Notice>Preferences of when to flip, not a physical limit of the mount, which only the mount itself enforces.</Notice>
			<Actions>
				<Button variant="secondary" disabled={pending || !changed} title={changed ? undefined : 'Nothing changed.'} onClick={onApply}>
					{running ? 'Apply' : 'Remember'}
				</Button>
			</Actions>
		</CollapsibleSection>
	)
}

// Sections of the contextual panel the Executor reads: the policy of the mount, its advanced options, the equipment of
// the Equipment Setup a flip uses, and the summaries of the camera tools it invokes.
function ExecutorSections({ mount }: { readonly mount: RoleDevice }) {
	const profiles = useSnapshot(profileState)
	const control = useSnapshot(controlRuntime)
	const state = useSnapshot(meridianFlipExecutorState)
	const camera = useRoleDevice('MAIN_CAMERA')
	const guideOutput = useRoleDevice('GUIDE_OUTPUT')
	const focuser = useRoleDevice('FOCUSER')
	const rotator = useRoleDevice('ROTATOR')
	const profile = activeProfile(profiles)
	const device = mount.device
	const identity = profileCamera(profile, device?.id)
	const policy = meridianFlipExecutorPolicy(profile.settings, identity)
	const running = device ? latestExecution(state, device.connectionId, device.id)?.state === 'running' : false
	const mountState = watchedDeviceState(control, 'mount', device)
	const hasCamera = !!camera.device
	const locked = running ? 'A flip of this mount is running with this policy.' : undefined
	const assigned = [camera, guideOutput, focuser, rotator].filter((role) => role.device).length

	// Updates fields of the policy of the mount.
	function update(patch: Partial<MeridianFlipExecutorPolicy>) {
		setMeridianFlipExecutorPolicy(profileState, identity, patch)
	}

	return (
		<>
			<CollapsibleSection id="meridianFlip.policy" title="Flip Policy" summary={STRATEGIES[policy.strategy]}>
				<Select label="Strategy" options={['auto', 'nativeFlip', 'forcedGoto'] as const} value={policy.strategy} format={(value) => STRATEGIES[value]} disabled={running} onChange={(strategy) => update({ strategy })} />
				<Notice>{policy.strategy === 'auto' ? "The driver's own flip when it has one, else a GoTo to the same target." : policy.strategy === 'nativeFlip' ? "Only the driver's own flip." : 'A GoTo to the same target, which the mount takes to the other side.'}</Notice>
				<NumberInput label="Mount settle" value={policy.mountSettleSeconds} min={0} max={600} suffix="s" disabled={running} onChange={(mountSettleSeconds) => update({ mountSettleSeconds })} />
				<FirmwareLimitInput minutes={policy.firmwareLimitSeconds === undefined ? undefined : policy.firmwareLimitSeconds / 60} disabled={running} onChange={(minutes) => update({ firmwareLimitSeconds: minutes === undefined ? undefined : minutes * 60 })} />
				<Checkbox label="Recenter after the flip" checked={policy.recenterAfterFlip} disabled={running || !hasCamera} onChange={(recenterAfterFlip) => update({ recenterAfterFlip })} />
				<Checkbox label="Auto Focus after the flip" checked={policy.autofocusAfterFlip} disabled={running || !hasCamera || !focuser.device} onChange={(autofocusAfterFlip) => update({ autofocusAfterFlip })} />
				{!hasCamera && <Notice>Recentering and Auto Focus need a main camera in the Equipment Setup.</Notice>}
				{locked && <Notice>{locked}</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="meridianFlip.advanced" title="Advanced Policy" summary={[policy.treatUnknownMountAsGem, policy.allowInferredAutoResume].some(Boolean) ? 'Changed' : 'Defaults'} defaultOpen={false}>
				<Checkbox label="Treat an unknown mount type as German equatorial" checked={policy.treatUnknownMountAsGem} disabled={running} onChange={(treatUnknownMountAsGem) => update({ treatUnknownMountAsGem })} />
				<Checkbox label="Resume imaging after an inferred flip" checked={policy.allowInferredAutoResume} disabled={running || !hasCamera} onChange={(allowInferredAutoResume) => update({ allowInferredAutoResume })} />
				<Notice>A mount that reports no usable pier side, or a simulator, has its flip inferred: Target Centering solves the target before and after it and compares the turn of the field. A pier side the driver reports verifies the flip by itself, without these solves.</Notice>
				{policy.allowInferredAutoResume && <Notice>An inferred flip rests on plate solutions taken before and after the motion, not on the mount's own report: a rotator, a changed optical train, or a flipped image can mimic it.</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="meridianFlip.equipment" title="Equipment" summary={device ? `${device.name} and ${assigned} of 4 more` : 'No mount'} defaultOpen={false}>
				<DataList>
					<DataRow label="Mount">
						<DeviceLink device={device} fallback="Not assigned" />
					</DataRow>
					<DataRow label="Mount type">{mountState ? MOUNT_TYPE_LABELS[mountState.mountType] : MISSING}</DataRow>
					<DataRow label="Pier side">{mountState ? (mountState.hasPierSide ? MERIDIAN_PIER_SIDES[mountState.pierSide] : 'Not reported') : MISSING}</DataRow>
					<DataRow label="Commands">{mountState ? [mountState.canFlip && 'Native flip', mountState.canGoTo && 'GoTo'].filter(Boolean).join(', ') || 'None' : MISSING}</DataRow>
					<DataRow label="Main camera">
						<DeviceLink device={camera.device} fallback="Not assigned" />
					</DataRow>
					<DataRow label="Guide output">
						<DeviceLink device={guideOutput.device} fallback="Not assigned" />
					</DataRow>
					<DataRow label="Focuser">
						<DeviceLink device={focuser.device} fallback="Not assigned" />
					</DataRow>
					<DataRow label="Rotator">
						<DeviceLink device={rotator.device} fallback="Not assigned" />
					</DataRow>
				</DataList>
				<Notice>A flip uses these devices as they are when it starts, and the camera tool settings summarized below as they are when it is asked for or armed; a later change applies to the next request.</Notice>
			</CollapsibleSection>
			<MeridianFlipToolSections camera={camera} focuser={focuser} policy={policy} />
		</>
	)
}

interface FirmwareLimitInputProps {
	// Limit after the transit in minutes; absent when it is not entered.
	readonly minutes?: number
	// Whether the field is disabled.
	readonly disabled: boolean
	// Called with the limit in minutes, or undefined once it is cleared.
	readonly onChange: (minutes: number | undefined) => void
}

// Firmware limit of the mount after the transit, entered as the mount is set: a minute count, or nothing when it is not
// known, never zero standing for unknown.
function FirmwareLimitInput({ minutes, disabled, onChange }: FirmwareLimitInputProps) {
	return (
		<div className="flex flex-col gap-2">
			{minutes === undefined ? (
				<DataList>
					<DataRow label="Firmware limit after transit">Not entered</DataRow>
				</DataList>
			) : (
				<NumberInput label="Firmware limit after transit" value={minutes} min={1} max={360} suffix="min" disabled={disabled} onChange={(value) => onChange(Math.max(value, 1))} />
			)}
			<Actions>
				<Button variant="secondary" disabled={disabled} onClick={() => onChange(minutes === undefined ? 15 : undefined)}>
					{minutes === undefined ? 'Enter Limit' : 'Clear Limit'}
				</Button>
			</Actions>
			<Notice>Enter it as the mount is set, such as the Meridian Treatment of an iOptron mount. It is never read from or written to the mount, and two automatic flippers must not both be active.</Notice>
		</div>
	)
}
