import type { ExecutorEligibility, FlipStrategyChoice, MeridianFlipArm, MeridianFlipExecution, MeridianFlipExecutionRequest, MeridianFlipExecutorPolicy, MeridianFlipMonitor, MeridianFlipStepOutcome, OperationDevice } from 'api'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { autoFocusRequest, defaultStepSize } from '../../camera/autofocus'
import { cameraKey, captureRunning, captureRuntime, captureSnoop } from '../../camera/capture'
import { targetCenteringRequest } from '../../camera/targetcentering'
import { controlRuntime, deviceStateOf, watchedDeviceState } from '../../equipment-control/control'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { type RoleDevice, useRoleDevice } from '../../equipment/useEquipment'
import { formatClockDuration, formatDuration, formatLocalTime, MISSING } from '../../format'
import { useActiveTimeZone } from '../../location/useLocation'
import { activeProfile, activeSetup, autoFocusSettings, cameraPlateSolving, exposureSettings, meridianFlipExecutorPolicy, profileCamera, profileState, setMeridianFlipExecutorPolicy, starDetectionSettings, targetCenteringSettings } from '../../profile/profile'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { StatusBadge, type StatusTone } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { useNow } from '../../useNow'
import { MERIDIAN_AVAILABILITY_LABELS, MERIDIAN_PIER_SIDES, monitorKey, MOUNT_TYPE_LABELS } from './meridianflip'
import {
	armMeridianFlip,
	cancelMeridianFlip,
	capturePausedBy,
	disarmMeridianFlip,
	executeMeridianFlip,
	FLIP_VERIFICATION_LABELS,
	FLIP_VERIFICATION_MODE_LABELS,
	latestExecution,
	MERIDIAN_FLIP_STEP_LABELS,
	meridianFlipEligibility,
	meridianFlipExecutionHeadline,
	meridianFlipExecutorState,
	resumePausedCapture,
} from './meridianflipexecutor'
import { FlipSection } from './MeridianFlipSection'
import { FlipToolSections } from './MeridianFlipToolSections'

// Executor parts of the Meridian Flip tool: the strip of the flip of the MOUNT that runs, is armed, or left the capture
// paused, shown above both sections with its Stop, Disarm, or Resume Capture; the Executor section, with what the server
// would decide now, the requests (flip when the window opens, flip now, arm the automatic flip), and the latest
// execution with its steps and outcome; and the sections of the contextual panel with the policy the profile remembers
// for that mount, the equipment of the Equipment Setup a flip uses, and the summaries of the camera tools it invokes
// (MeridianFlipToolSections.tsx). Every decision and every command is the
// server's; nothing here moves anything until the operator confirms a request, and closing the tab or switching
// profile leaves a running execution or an arm alone.

// Text of each strategy choice.
const STRATEGIES: Readonly<Record<FlipStrategyChoice, string>> = { auto: 'Automatic', nativeFlip: 'Native flip', forcedGoto: 'Forced GoTo' }

// How each strategy choice moves the mount, said in the confirmation of a flip.
const STRATEGY_MOTIONS: Readonly<Record<FlipStrategyChoice, string>> = { auto: "by the driver's own flip when it has one, else by a GoTo to the same target", nativeFlip: "by the driver's own flip", forcedGoto: 'by a GoTo to the same target' }

// Text of each step outcome.
const STEP_OUTCOMES: Readonly<Record<MeridianFlipStepOutcome, string>> = { running: 'Running', done: 'Done', skipped: 'Skipped', failed: 'Failed' }

// Text of the restoration outcomes.
const RESTORATIONS: Readonly<Record<string, string>> = { restored: 'Restored', resumed: 'Resumed', failed: 'Failed', externallyChanged: 'Changed by someone else', notNeeded: 'Not needed', leftSuspended: 'Left paused', completed: 'Completed', skipped: 'Skipped' }

// Converts a role device into the exact ids a request names it by.
function operationDevice(role: RoleDevice): OperationDevice | undefined {
	return role.device && { connectionId: role.device.connectionId, deviceId: role.device.id }
}

// Words of an arm: scheduled once, or armed for the automatic flip.
function armLabel(arm: Pick<MeridianFlipArm, 'trigger'>) {
	return arm.trigger === 'automatic' ? 'Armed' : 'Scheduled'
}

// Time to an instant from now (Unix milliseconds), or since it: "in 07:41", "03:12 ago".
function formatFromNow(at: number, now: number) {
	return at >= now ? `in ${formatClockDuration((at - now) / 1000)}` : `${formatClockDuration((now - at) / 1000)} ago`
}

// Live flip of the mount of the Equipment Setup, shown above both sections of the tool while one runs, is armed or
// scheduled, or left the capture paused, with the one command each of those asks for; nothing otherwise.
export function FlipStrip({ mount, monitor }: { readonly mount: RoleDevice; readonly monitor?: MeridianFlipMonitor }) {
	const timeZone = useActiveTimeZone()
	const state = useSnapshot(meridianFlipExecutorState)
	const captures = useSnapshot(captureRuntime)
	const device = mount.device
	const execution = device ? latestExecution(state, device.connectionId, device.id) : undefined
	const key = device ? monitorKey(device.connectionId, device.id) : undefined
	const arm = key ? state.arms[key] : undefined
	const pending = key ? !!state.pending[key] : false
	const running = execution?.state === 'running'
	const paused = capturePausedBy(execution, captures.sessions)
	const now = useNow(running || arm !== undefined)

	if (!device) return null

	let badge: readonly [string, StatusTone]
	let text: string
	let action: ReactNode

	if (running) {
		const [headline] = meridianFlipExecutionHeadline(execution)
		badge = ['Flipping', 'active']
		text = `Step ${execution.steps.length}: ${headline} · started ${formatLocalTime(execution.startedAt, timeZone, now)}, ${formatClockDuration((now - execution.startedAt) / 1000)} elapsed`
		action = (
			<ConfirmButton
				title="Stop the meridian flip?"
				message={`The flip of ${execution.mountName} ends at its current step, and the operations it runs are cancelled. If the mount already moved across the meridian, the capture stays paused and guiding suspended for you; if it has not, imaging goes on as before.`}
				confirmLabel="Stop Flip"
				destructive
				disabled={pending}
				tooltip={pending ? 'Waiting for the server to answer the last request.' : undefined}
				onConfirm={() => void cancelMeridianFlip(meridianFlipExecutorState, execution)}
			>
				Stop Flip
			</ConfirmButton>
		)
	} else if (arm) {
		const opensAt = monitor?.timing.windowOpensAt
		badge = [armLabel(arm), 'neutral']
		text = arm.decision.decision === 'refuse' ? `${arm.decision.reason}.` : opensAt !== undefined && opensAt > now ? `Flips when the window opens at ${formatLocalTime(opensAt, timeZone, now)}, ${formatFromNow(opensAt, now)}.` : `Flips as soon as it is eligible: ${arm.decision.reason}.`
		action = (
			<Button variant="secondary" disabled={pending} title={pending ? 'Waiting for the server to answer the last request.' : 'Removes the arm; moves nothing.'} onClick={() => void disarmMeridianFlip(meridianFlipExecutorState, device.connectionId, device.id)}>
				Disarm
			</Button>
		)
	} else if (paused && execution) {
		badge = meridianFlipExecutionHeadline(execution)
		text = `The capture is paused since the flip ended at ${formatLocalTime(execution.endedAt ?? execution.startedAt, timeZone, now)}. Check the mount, the framing, and guiding before resuming it.`
		action = (
			<ConfirmButton title="Resume the paused capture?" message="The flip did not leave imaging ready. Resume the capture only once you checked the mount, the framing, and guiding." confirmLabel="Resume" disabled={pending} onConfirm={() => void resumePausedCapture(meridianFlipExecutorState, execution)}>
				Resume Capture
			</ConfirmButton>
		)
	} else {
		return null
	}

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line-100 bg-base-100 px-3 py-2">
			<StatusBadge tone={badge[1]} label={badge[0]} />
			<span className="order-last w-full min-w-0 text-sm leading-5 text-ink-200 tabular-nums sm:order-0 sm:w-auto sm:flex-1">{text}</span>
			<div className="ml-auto flex">{action}</div>
		</div>
	)
}

// Executor section for the mount of the Equipment Setup and its monitor: the flip and the latest execution.
export function MeridianFlipExecutorSections({ mount, monitor }: { readonly mount: RoleDevice; readonly monitor?: MeridianFlipMonitor }) {
	const timeZone = useActiveTimeZone()
	const profiles = useSnapshot(profileState)
	const control = useSnapshot(controlRuntime)
	const state = useSnapshot(meridianFlipExecutorState)
	const captures = useSnapshot(captureRuntime)
	const camera = useRoleDevice('MAIN_CAMERA')
	const guideOutput = useRoleDevice('GUIDE_OUTPUT')
	const focuser = useRoleDevice('FOCUSER')
	const rotator = useRoleDevice('ROTATOR')
	const now = useNow(!!monitor)
	const profile = activeProfile(profiles)
	const device = mount.device
	const identity = profileCamera(profile, device?.id)
	const policy = meridianFlipExecutorPolicy(profile.settings, identity)
	const key = device ? monitorKey(device.connectionId, device.id) : undefined
	const execution = device ? latestExecution(state, device.connectionId, device.id) : undefined
	const arm = key ? state.arms[key] : undefined
	const pending = key ? state.pending[key] : undefined
	const error = key ? state.errors[key] : undefined
	const running = execution?.state === 'running'
	const [decision, setDecision] = useState<{ readonly decision: ExecutorEligibility } | { readonly error: string }>()
	const connected = mount.status === 'connected' && device !== undefined
	const blocker = !connected ? 'The mount of the Equipment Setup is not connected.' : !monitor ? 'Enable the monitor first; the Executor follows its forecast.' : undefined
	const busy = pending ? 'Waiting for the server to answer the last request.' : running ? 'A flip of this mount is running.' : undefined
	// Why a flip cannot be asked for now; the server decides again in any case.
	const flipBlocker = blocker ?? busy ?? (arm ? `A flip is already ${armLabel(arm).toLowerCase()}; disarm it first.` : monitor && monitor.availability !== 'monitoring' ? `The monitor follows no settled target: ${MERIDIAN_AVAILABILITY_LABELS[monitor.availability].toLowerCase()}.` : undefined)
	const checkBlocker = blocker ?? busy
	const captureCamera = camera.device && captureRunning(captures.sessions[cameraKey(camera.device.connectionId, camera.device.id)]) ? camera.device.name : undefined
	const opensAt = monitor?.timing.windowOpensAt
	const waits = opensAt !== undefined && opensAt > now
	const whenOpen = waits ? `When the window opens at ${formatLocalTime(opensAt, timeZone, now)}, ${formatFromNow(opensAt, now)}` : 'As soon as it is eligible'

	// Builds the body of a request from the Equipment Setup and the camera forms the profile keeps for the main camera.
	function body(): Omit<MeridianFlipExecutionRequest, 'token'> | undefined {
		if (!device) return undefined

		const cameraIdentity = profileCamera(profile, camera.device?.id)
		const capabilities = watchedDeviceState(control, 'camera', camera.device)
		const exposure = exposureSettings(profile.settings, cameraIdentity)
		const mountDevice = { connectionId: device.connectionId, deviceId: device.id }
		const focuserDevice = operationDevice(focuser)
		const setup = { camera: operationDevice(camera), guideOutput: operationDevice(guideOutput), focuser: focuserDevice, rotator: operationDevice(rotator) }

		let centering: MeridianFlipExecutionRequest['centering']
		let autoFocus: MeridianFlipExecutionRequest['autoFocus']

		if (camera.device) {
			// The mount, the target, the mode and the guiding coordination are the Executor's own.
			const {
				mount: _mount,
				guideOutput: _guideOutput,
				mode: _mode,
				target: _target,
				guiding: _guiding,
				...settings
			} = targetCenteringRequest('recenter', { rightAscension: 0, declination: 0 }, targetCenteringSettings(profile.settings, cameraIdentity), exposure, cameraPlateSolving(profile.settings, cameraIdentity), { mount: mountDevice }, capabilities)
			centering = settings

			if (focuserDevice && focuser.device) {
				const focus = autoFocusSettings(profile.settings, cameraIdentity)
				const focuserState = deviceStateOf(control.states, 'focuser', focuser.device.id)
				const stepSize = focus.stepSize ?? (focuserState ? defaultStepSize(focuserState.position.min, focuserState.position.max) : 100)
				const { focuser: _focuser, ...request } = autoFocusRequest(focus, starDetectionSettings(profile.settings), exposure, focuserDevice, stepSize, captureSnoop(activeSetup(profile)), capabilities)
				autoFocus = request
			}
		}

		return { setup, policy, centering, autoFocus }
	}

	async function check() {
		const request = body()
		if (!device || !request) return
		setDecision(await meridianFlipEligibility(device.connectionId, device.id, { ...request, trigger: 'manual' }))
	}

	function execute(mode: 'now' | 'whenEligible') {
		const request = body()
		setDecision(undefined)
		if (device && request) void executeMeridianFlip(meridianFlipExecutorState, device.connectionId, device.id, mode, request)
	}

	function armAutomatic() {
		const request = body()
		setDecision(undefined)
		if (device && request) void armMeridianFlip(meridianFlipExecutorState, device.connectionId, device.id, request)
	}

	const decided = decision && 'decision' in decision ? decision.decision : undefined
	// Not yet is not a refusal: the window has not opened, or the server waits for the target.
	const notYet = decided !== undefined && (decided.decision === 'wait' || (decided.decision === 'refuse' && decided.code === 'notDue'))
	const warning = { policy, capture: captureCamera, guideOutput: guideOutput.device?.name }

	return (
		<div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
			<FlipSection title="Flip">
				{error && <Notice error>{error}</Notice>}
				<DataList>
					<DataRow label="Window opens">{opensAt === undefined ? MISSING : `${formatLocalTime(opensAt, timeZone, now)}, ${formatFromNow(opensAt, now)}`}</DataRow>
					<DataRow label="Window closes">{monitor?.timing.windowClosesAt === undefined ? MISSING : `${formatLocalTime(monitor.timing.windowClosesAt, timeZone, now)}, ${formatFromNow(monitor.timing.windowClosesAt, now)}`}</DataRow>
					<DataRow label="Firmware limit">{policy.firmwareLimitSeconds === undefined ? 'Not entered' : monitor?.timing.transitAt === undefined ? MISSING : formatLocalTime(monitor.timing.transitAt + policy.firmwareLimitSeconds * 1000, timeZone, now)}</DataRow>
					{decided?.decision === 'eligible' && <DataRow label="Strategy">{decided.strategy === 'nativeFlip' ? 'Native flip' : 'Forced GoTo'}</DataRow>}
					{decided?.decision === 'eligible' && <DataRow label="Verification">{FLIP_VERIFICATION_MODE_LABELS[decided.verificationMode]}</DataRow>}
					{decided && (
						<DataRow label="Now" tone={decided.decision === 'eligible' ? 'success' : notYet ? 'default' : 'danger'}>
							{decided.decision === 'eligible' ? 'Eligible' : notYet ? 'Not yet' : 'Refused'}
						</DataRow>
					)}
				</DataList>
				{decided && <Notice>{decided.reason}.</Notice>}
				{decision && 'error' in decision && <Notice error>{decision.error}</Notice>}
				{blocker && <Notice>{blocker}</Notice>}
				<Actions>
					<ConfirmButton
						variant="primary"
						title={waits ? 'Flip when the window opens?' : 'Flip as soon as it is eligible?'}
						message={
							<>
								<FlipWarning {...warning} when={whenOpen} />
								<p className="mt-2">Scheduled once, for this passage only. It flips even when the flip can only be inferred from plate solutions or cannot be verified at all; a restart of the server forgets it.</p>
							</>
						}
						confirmLabel="Schedule"
						disabled={!!flipBlocker}
						tooltip={flipBlocker}
						onConfirm={() => execute('whenEligible')}
					>
						Flip When Eligible
					</ConfirmButton>
					<ConfirmButton title="Flip the mount now?" message={<FlipWarning {...warning} when="Right away" />} confirmLabel="Flip Now" disabled={!!flipBlocker} tooltip={flipBlocker} onConfirm={() => execute('now')}>
						Flip Now
					</ConfirmButton>
					<ConfirmButton
						title="Arm the automatic flip?"
						message={
							<>
								<FlipWarning {...warning} when={whenOpen} />
								<p className="mt-2">
									Armed once, for this passage only, with the checks of an unattended flip: it is refused when the mount reports no usable pier side{policy.allowInferredVerification ? '' : ' (unless allowed in Advanced Policy)'} or when the preferred window closes after the firmware limit. A restart
									of the server disarms it.
								</p>
							</>
						}
						confirmLabel="Arm"
						disabled={!!flipBlocker}
						tooltip={flipBlocker}
						onConfirm={armAutomatic}
					>
						Arm Automatic
					</ConfirmButton>
					<Button variant="secondary" disabled={!!checkBlocker} title={checkBlocker ?? 'Asks the server what it would decide now; starts nothing.'} onClick={() => void check()}>
						Check
					</Button>
				</Actions>
				<Notice>Flip When Eligible and Arm Automatic both wait for the window and flip this passage once. Arm Automatic adds the checks of an unattended flip: a pier side the driver reports, or inference allowed in Advanced Policy, and a window that closes before the firmware limit.</Notice>
			</FlipSection>
			<LatestFlip execution={execution} />
		</div>
	)
}

interface FlipWarningProps {
	// Policy the flip runs with.
	readonly policy: Readonly<MeridianFlipExecutorPolicy>
	// When the mount moves, as the start of a sentence.
	readonly when: string
	// Name of the main camera whose capture runs and is paused; absent when none runs.
	readonly capture?: string
	// Name of the guide output whose guiding is suspended; absent when the setup has none.
	readonly guideOutput?: string
}

// What a flip commands, and when, said before it is confirmed.
function FlipWarning({ policy, when, capture, guideOutput }: FlipWarningProps) {
	return (
		<>
			{when}, the mount is sent across the meridian {STRATEGY_MOTIONS[policy.strategy]}, at the target it tracks then. {capture ? `The capture of ${capture} is paused after its current frame` : 'No capture runs now, so none is paused'}
			{guideOutput ? `, and guiding through ${guideOutput} is suspended` : ''}. This motion cannot be undone; make sure the cables and the pier are clear. A flip that cannot be verified{policy.allowInferredAutoResume ? ' or inferred' : ''} leaves the capture paused for you.
		</>
	)
}

// Latest execution of the mount: its outcome, the flip verification apart from the readiness of imaging, and its steps.
function LatestFlip({ execution }: { readonly execution?: MeridianFlipExecution }) {
	const timeZone = useActiveTimeZone()
	const now = useNow(execution?.state === 'running')

	if (!execution) {
		return (
			<FlipSection title="Latest Flip">
				<Notice>No flip has run for this mount since the server started.</Notice>
			</FlipSection>
		)
	}

	const { outcome } = execution
	const [headline, tone] = meridianFlipExecutionHeadline(execution)
	const last = execution.steps.length - 1

	return (
		<FlipSection title="Latest Flip">
			<div className="flex flex-wrap items-center gap-2">
				<StatusBadge tone={tone} label={execution.state === 'running' ? 'Flipping' : headline} />
			</div>
			<DataList>
				<DataRow label="Started">{formatLocalTime(execution.startedAt, timeZone, now)}</DataRow>
				{execution.endedAt !== undefined && <DataRow label="Took">{formatDuration((execution.endedAt - execution.startedAt) / 1000)}</DataRow>}
				<DataRow label="Strategy">{execution.strategy === 'nativeFlip' ? 'Native flip' : 'Forced GoTo'}</DataRow>
				<DataRow label="Target">{execution.target.label ?? (execution.target.source === 'derivedFromMount' ? 'Where the mount pointed' : 'Framed target')}</DataRow>
				{outcome && (
					<DataRow label="Flip verification" tone={outcome.verification === 'unverified' ? 'warning' : 'success'}>
						{FLIP_VERIFICATION_LABELS[outcome.verification]}
					</DataRow>
				)}
				{outcome && (
					<DataRow label="Ready for imaging" tone={outcome.readyForImaging === 'ready' ? 'success' : 'warning'}>
						{outcome.readyForImaging === 'ready' ? 'Yes' : 'No'}
					</DataRow>
				)}
				{outcome?.pierSideBefore && <DataRow label="Pier side">{`${MERIDIAN_PIER_SIDES[outcome.pierSideBefore]} → ${outcome.pierSideAfter ? MERIDIAN_PIER_SIDES[outcome.pierSideAfter] : MISSING}`}</DataRow>}
				{outcome && <DataRow label="Movement observed">{outcome.movementObserved ? 'Yes' : 'No'}</DataRow>}
				{outcome?.wcs && <DataRow label="Plate solutions">{outcome.wcs.status === 'missing' ? 'Missing' : outcome.wcs.status === 'consistent' ? 'Field turned by half a turn' : 'Inconsistent with a flip'}</DataRow>}
				{outcome?.recentering && <DataRow label="Recentering">{RESTORATIONS[outcome.recentering]}</DataRow>}
				{outcome?.autofocus && <DataRow label="Auto Focus">{RESTORATIONS[outcome.autofocus]}</DataRow>}
				{outcome?.guidingRestoration && <DataRow label="Guiding">{RESTORATIONS[outcome.guidingRestoration]}</DataRow>}
				{outcome?.captureRestoration && <DataRow label="Capture">{RESTORATIONS[outcome.captureRestoration]}</DataRow>}
			</DataList>
			{execution.error && <Notice error={tone === 'danger'}>{execution.error}</Notice>}
			{execution.steps.length > 0 && (
				<Table columns={['Time', 'Step', 'Outcome']}>
					{execution.steps.map((step, index) => {
						// A failed step the execution went on from, such as a reference solve, is said so.
						const outcomeText = step.outcome === 'failed' && index < last ? 'Failed, went on' : STEP_OUTCOMES[step.outcome]
						return (
							<Row key={`${step.step}:${step.startedAt}`}>
								<Cell numeric>{formatLocalTime(step.startedAt, timeZone, now)}</Cell>
								<Cell>{MERIDIAN_FLIP_STEP_LABELS[step.step]}</Cell>
								<Cell>{step.detail ? `${outcomeText}: ${step.detail}` : outcomeText}</Cell>
							</Row>
						)
					})}
				</Table>
			)}
		</FlipSection>
	)
}

// Sections of the contextual panel the Executor reads: the policy of the mount, its advanced options, the equipment of
// the Equipment Setup a flip uses, and the summaries of the camera tools it invokes.
export function ExecutorPanelSections({ mount }: { readonly mount: RoleDevice }) {
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
			<CollapsibleSection id="meridianFlip.advanced" title="Advanced Policy" summary={[policy.treatUnknownMountAsGem, policy.allowInferredVerification, policy.allowInferredAutoResume].some(Boolean) ? 'Changed' : 'Defaults'} defaultOpen={false}>
				<Checkbox label="Treat an unknown mount type as German equatorial" checked={policy.treatUnknownMountAsGem} disabled={running} onChange={(treatUnknownMountAsGem) => update({ treatUnknownMountAsGem })} />
				<Checkbox label="Allow the automatic flip without a pier side (inferred)" checked={policy.allowInferredVerification} disabled={running || !hasCamera} onChange={(allowInferredVerification) => update({ allowInferredVerification })} />
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
			<FlipToolSections camera={camera} focuser={focuser} policy={policy} />
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
