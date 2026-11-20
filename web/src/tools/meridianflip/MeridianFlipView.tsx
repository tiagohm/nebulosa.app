import type { MeridianFlipSettings } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { MOUNT_ROLE_BLOCKERS } from '../../equipment/equipment'
import { EquipmentSetupButton } from '../../equipment/EquipmentSetupButton'
import { useRoleDevice } from '../../equipment/useEquipment'
import { activeProfile, meridianFlipSettings, profileCamera, profileState, setMeridianFlipSettings } from '../../profile/profile'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { useNow } from '../../useNow'
import { disableMeridianFlip, enableMeridianFlip, loadMeridianFlipTransitions, type MeridianFlipSection, meridianFlipState, meridianFlipView, monitorKey, normalizeMeridianFlipSettings, updateMeridianFlipSettings } from './meridianflip'
import { latestExecution, meridianFlipExecutorState } from './meridianflipexecutor'
import { MeridianFlipExecutorView } from './MeridianFlipExecutorView'
import { MeridianFlipGuide } from './MeridianFlipGuide'
import { MeridianFlipMonitorView } from './MeridianFlipMonitorView'
import { MeridianFlipPanel } from './MeridianFlipPanel'
import { MeridianFlipReadout } from './MeridianFlipReadout'
import { MeridianFlipStrip } from './MeridianFlipStrip'

// Meridian Flip tool, laid out as one passage of the target the MOUNT of the active profile's Equipment Setup tracks:
// the mount, the readout of where it stands (MeridianFlipReadout.tsx), the strip of a flip that runs, is armed, or left
// the capture paused (MeridianFlipStrip.tsx), then the Monitor section (MeridianFlipMonitorView.tsx) or the Executor
// section (MeridianFlipExecutorView.tsx), and a guide to how a flip works (MeridianFlipGuide.tsx); the contextual panel
// Flip Settings (MeridianFlipPanel.tsx) holds what is set rather than read. This view owns what the parts share: the
// section shown, the draft of the flip window, and the workspace actions Enable and Disable of the monitor, whose
// Enable takes that draft. The mount is never chosen here: a missing or unavailable one is reported and Enable is
// disabled. The monitor is the server's, so changing profile, setup, or workspace, or closing the tab, leaves it enabled
// for the mount it was enabled for; settings are applied explicitly and remembered by the profile per mount.

const TOOLS = ['Monitor', 'Executor'] as const

// Meridian Flip tool.
export function MeridianFlipView() {
	const mount = useRoleDevice('MOUNT')
	const profile = activeProfile(useSnapshot(profileState))
	const state = useSnapshot(meridianFlipState)
	const executor = useSnapshot(meridianFlipExecutorState)
	const device = mount.device
	const blocker = mount.status === 'connected' ? undefined : MOUNT_ROLE_BLOCKERS[mount.status]
	const key = device ? monitorKey(device.connectionId, device.id) : undefined
	const monitor = key ? state.monitors[key] : undefined
	const pending = key ? state.pending[key] : undefined
	const error = key ? state.errors[key] : undefined
	const arm = key ? executor.arms[key] : undefined
	const running = device ? latestExecution(executor, device.connectionId, device.id)?.state === 'running' : false
	const now = useNow(!!monitor)
	const identity = profileCamera(profile, device?.id)
	const saved = meridianFlipSettings(profile.settings, identity)
	const [draft, setDraft] = useState<MeridianFlipSettings>(() => monitor?.settings ?? saved)

	// Section shown: the one this tab showed last, and the Executor whenever a flip of the mount starts running or gets
	// armed, including once the mirror of the Executor loads after a reload.
	const live = running || arm !== undefined
	const [section, setSection] = useState<MeridianFlipSection>(() => (live ? 'Executor' : meridianFlipView.section))
	const [wasLive, setWasLive] = useState(live)

	if (live !== wasLive) {
		setWasLive(live)
		if (live) setSection('Executor')
	}
	const monitorId = monitor?.monitorId

	// The draft of the flip window starts over from the settings of another mount, profile, or enablement.
	const draftKey = `${profile.id}:${key}:${monitorId}`
	const [draftOf, setDraftOf] = useState(draftKey)

	if (draftOf !== draftKey) {
		setDraftOf(draftKey)
		setDraft(monitor?.settings ?? saved)
	}

	useEffect(() => {
		if (device && monitorId) void loadMeridianFlipTransitions(meridianFlipState, device.connectionId, device.id)
	}, [device?.connectionId, device?.id, monitorId])

	function show(next: MeridianFlipSection) {
		setSection(next)
		meridianFlipView.section = next
	}

	// Enables the monitor with the flip window being edited, which the profile then remembers for the mount.
	function enable() {
		if (!device) return
		const settings = normalizeMeridianFlipSettings(draft)
		setMeridianFlipSettings(profileState, identity, settings)
		void enableMeridianFlip(meridianFlipState, device.connectionId, device.id, settings)
	}

	// Remembers the flip window being edited and applies it to the running monitor.
	function apply() {
		const settings = normalizeMeridianFlipSettings(draft)
		setMeridianFlipSettings(profileState, identity, settings)
		if (device && monitor) void updateMeridianFlipSettings(meridianFlipState, device.connectionId, device.id, settings, monitor.settingsRevision)
	}

	function disable() {
		if (monitor) void disableMeridianFlip(meridianFlipState, monitor.connectionId, monitor.deviceId)
	}

	const actions = (
		<Actions>
			{!monitor ? (
				<Button disabled={!device || !!blocker || !!pending} title={blocker ?? (pending ? 'Waiting for the server to answer.' : undefined)} onClick={enable}>
					{pending === 'enable' ? 'Enabling…' : 'Enable'}
				</Button>
			) : arm ? (
				<ConfirmButton title="Disable the monitor?" message={`The scheduled flip of ${arm.mountName} ends with it, since the Executor follows the forecast of the monitor.`} confirmLabel="Disable" disabled={!!pending} onConfirm={disable}>
					Disable
				</ConfirmButton>
			) : (
				<Button variant="secondary" disabled={!!pending || running} title={running ? 'A flip of this mount is running; disable the monitor once it ends.' : undefined} onClick={disable}>
					{pending === 'disable' ? 'Disabling…' : 'Disable'}
				</Button>
			)}
		</Actions>
	)

	const panel = <MeridianFlipPanel mount={mount} monitor={monitor} draft={draft} onDraftChange={(settings) => setDraft(normalizeMeridianFlipSettings(settings))} saved={saved} pending={!!pending} onApply={apply} />

	return (
		<WorkspaceLayout workspace="tools" title="Meridian Flip" actions={actions} panel={{ title: 'Flip Settings', content: panel }}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-5xl flex-col gap-5 p-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-5">
						<span className="text-ink-300">Mount</span>
						<span className="min-w-0 truncate text-ink-100">
							<DeviceLink device={device} fallback={mount.status === 'notSelected' ? 'None selected' : 'Unavailable'} />
						</span>
						{blocker && !monitor && <span className="text-ink-300">{blocker}</span>}
						{mount.status === 'notSelected' && <EquipmentSetupButton />}
					</div>
					{error && <Notice error>{error}</Notice>}
					<MeridianFlipReadout monitor={monitor} now={now} />
					<MeridianFlipStrip mount={mount} monitor={monitor} />
					<SegmentedControl options={TOOLS} value={section} onChange={show} className="max-w-xs" />
					{section === 'Executor' ? <MeridianFlipExecutorView mount={mount} monitor={monitor} /> : <MeridianFlipMonitorView mount={mount} monitor={monitor} now={now} />}
					<MeridianFlipGuide />
				</div>
			</div>
		</WorkspaceLayout>
	)
}
