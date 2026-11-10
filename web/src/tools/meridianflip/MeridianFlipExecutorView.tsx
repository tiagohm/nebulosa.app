import type { ExecutorEligibility, FlipStrategyChoice, MeridianFlipExecution, MeridianFlipExecutionRequest, MeridianFlipExecutorPolicy, MeridianFlipMonitor, MeridianFlipStepOutcome, OperationDevice } from 'api'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { autoFocusRequest, defaultStepSize } from '../../camera/autofocus'
import { cameraKey, captureRuntime, captureSnoop } from '../../camera/capture'
import { targetCenteringRequest } from '../../camera/targetcentering'
import { controlRuntime, deviceStateOf, watchedDeviceState } from '../../equipment-control/control'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { type RoleDevice, useRoleDevice } from '../../equipment/useEquipment'
import { formatZonedDateTime, MISSING } from '../../format'
import { useActiveTimeZone } from '../../location/useLocation'
import { activeProfile, activeSetup, autoFocusSettings, cameraPlateSolving, exposureSettings, meridianFlipExecutorPolicy, profileCamera, profileState, setMeridianFlipExecutorPolicy, starDetectionSettings, targetCenteringSettings } from '../../profile/profile'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { monitorKey } from './meridianflip'
import {
	armMeridianFlip,
	cancelMeridianFlip,
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

// Executor sections of the Meridian Flip tool: the equipment of the Equipment Setup a flip of the MOUNT uses, the policy the
// profile remembers for that mount, what the server would decide now, the requests (flip now, flip when the window opens,
// arm the automatic flip, disarm, cancel), and the latest execution with its steps and outcome. Every decision and every
// command is the server's; nothing here moves anything until the operator confirms a request, and closing the tab or
// switching profile leaves a running execution or an arm alone.

// Text of each strategy choice.
const STRATEGIES: Readonly<Record<FlipStrategyChoice, string>> = { auto: 'Automatic (native flip when available)', nativeFlip: 'Native flip', forcedGoto: 'Forced GoTo to the same target' }

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

// Executor sections for the mount of the Equipment Setup and its monitor.
export function MeridianFlipExecutorSections({ mount, monitor }: { readonly mount: RoleDevice; readonly monitor?: MeridianFlipMonitor }) {
	const timeZone = useActiveTimeZone()
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
	const key = device ? monitorKey(device.connectionId, device.id) : undefined
	const execution = device ? latestExecution(state, device.connectionId, device.id) : undefined
	const arm = key ? state.arms[key] : undefined
	const pending = key ? state.pending[key] : undefined
	const error = key ? state.errors[key] : undefined
	const running = execution?.state === 'running'
	const mountState = watchedDeviceState(control, 'mount', device)
	const [decision, setDecision] = useState<{ readonly decision: ExecutorEligibility } | { readonly error: string }>()
	const connected = mount.status === 'connected' && device !== undefined
	const blocker = !connected ? 'The mount of the Equipment Setup is not connected.' : !monitor ? 'Enable the Meridian Flip Monitor of this mount first; the Executor follows its forecast.' : undefined

	// Updates fields of the policy of the mount.
	function update(patch: Partial<MeridianFlipExecutorPolicy>) {
		setMeridianFlipExecutorPolicy(profileState, identity, patch)
		setDecision(undefined)
	}

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

	const disabled = !!blocker || !!pending || running || arm !== undefined
	const decided = decision && 'decision' in decision ? decision.decision : undefined
	const [headline, tone] = meridianFlipExecutionHeadline(execution)

	return (
		<>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-5">
				<span className="text-ink-300">Executor</span>
				<StatusBadge tone={arm ? 'active' : tone} label={arm ? (arm.trigger === 'automatic' ? 'Armed (automatic)' : 'Scheduled') : headline} />
				{blocker && <span className="text-ink-300">{blocker}</span>}
			</div>
			{error && <Notice error>{error}</Notice>}
			<div className="grid gap-4 md:grid-cols-2">
				<Panel title="Equipment">
					<DataList>
						<DataRow label="Mount">
							<DeviceLink device={device} fallback="Not assigned" />
						</DataRow>
						<DataRow label="Mount type">{mountState?.mountType ?? MISSING}</DataRow>
						<DataRow label="Pier side">{mountState ? (mountState.hasPierSide ? mountState.pierSide : 'Not reported') : MISSING}</DataRow>
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
						<DataRow label="Rotator (never moved)">
							<DeviceLink device={rotator.device} fallback="Not assigned" />
						</DataRow>
					</DataList>
					<Notice>The flip uses the devices of the Equipment Setup as they are when it starts. Target Centering and Auto Focus use the settings of the main camera in their own tools.</Notice>
				</Panel>
				<PolicyPanel policy={policy} disabled={running} hasCamera={!!camera.device} hasFocuser={!!focuser.device} onChange={update} />
			</div>
			<div className="grid gap-4 md:grid-cols-2">
				<Panel title="Flip">
					<DataList>
						<DataRow label="Window opens">{monitor?.timing.windowOpensAt === undefined ? MISSING : formatZonedDateTime(monitor.timing.windowOpensAt, timeZone)}</DataRow>
						<DataRow label="Window closes">{monitor?.timing.windowClosesAt === undefined ? MISSING : formatZonedDateTime(monitor.timing.windowClosesAt, timeZone)}</DataRow>
						<DataRow label="Firmware limit">{policy.firmwareLimitSeconds === undefined || monitor?.timing.transitAt === undefined ? 'Not entered' : formatZonedDateTime(monitor.timing.transitAt + policy.firmwareLimitSeconds * 1000, timeZone)}</DataRow>
						{decided?.decision === 'eligible' && <DataRow label="Strategy">{decided.strategy === 'nativeFlip' ? 'Native flip' : 'Forced GoTo'}</DataRow>}
						{decided?.decision === 'eligible' && <DataRow label="Verification">{FLIP_VERIFICATION_MODE_LABELS[decided.verificationMode]}</DataRow>}
						{decided && (
							<DataRow label="Now" tone={decided.decision === 'eligible' ? 'success' : decided.decision === 'refuse' ? 'danger' : 'default'}>
								{decided.decision === 'eligible' ? 'Eligible' : decided.decision === 'wait' ? 'Waiting' : 'Refused'}
							</DataRow>
						)}
					</DataList>
					{decided && <Notice>{decided.reason}.</Notice>}
					{decision && 'error' in decision && <Notice error>{decision.error}</Notice>}
					{arm && (
						<Notice>
							{arm.trigger === 'automatic' ? 'Armed' : 'Scheduled'} since {formatZonedDateTime(arm.armedAt, timeZone)}: {arm.decision.reason}.
						</Notice>
					)}
					<Actions>
						<Button variant="secondary" disabled={!!blocker || !!pending} onClick={() => void check()}>
							Check
						</Button>
						<ConfirmButton title="Flip the mount now?" message={<FlipWarning policy={policy} />} confirmLabel="Flip Now" disabled={disabled} onConfirm={() => execute('now')}>
							Flip Now
						</ConfirmButton>
						<ConfirmButton title="Flip when the window opens?" message={<FlipWarning policy={policy} />} confirmLabel="Schedule" disabled={disabled} onConfirm={() => execute('whenEligible')}>
							Flip When Eligible
						</ConfirmButton>
						{arm ? (
							<Button variant="secondary" disabled={!!pending} onClick={() => device && void disarmMeridianFlip(meridianFlipExecutorState, device.connectionId, device.id)}>
								Disarm
							</Button>
						) : (
							<ConfirmButton
								title="Arm the automatic flip?"
								message={
									<>
										<FlipWarning policy={policy} />
										<p className="mt-2">The server flips this mount by itself once its window opens, for this passage only, and stays armed until then; a restart of the server disarms it.</p>
									</>
								}
								confirmLabel="Arm"
								disabled={disabled}
								onConfirm={armAutomatic}
							>
								Arm Automatic
							</ConfirmButton>
						)}
					</Actions>
				</Panel>
				<ExecutionPanel execution={execution} pending={!!pending} />
			</div>
		</>
	)
}

// What a flip commands, said before it is confirmed.
function FlipWarning({ policy }: { readonly policy: Readonly<MeridianFlipExecutorPolicy> }) {
	return (
		<>
			The running capture of the main camera is paused after its current frame, guiding is suspended, and the mount is sent across the meridian {STRATEGY_MOTIONS[policy.strategy]}. This motion cannot be undone; make sure the cables and the pier are clear. A flip that cannot be verified
			{policy.allowInferredAutoResume ? ' or inferred' : ''} leaves the capture paused for you.
		</>
	)
}

interface PolicyPanelProps {
	readonly policy: Readonly<MeridianFlipExecutorPolicy>
	readonly disabled: boolean
	readonly hasCamera: boolean
	readonly hasFocuser: boolean
	readonly onChange: (patch: Partial<MeridianFlipExecutorPolicy>) => void
}

// Policy of the mount, remembered by the profile.
function PolicyPanel({ policy, disabled, hasCamera, hasFocuser, onChange }: PolicyPanelProps) {
	return (
		<Panel title="Policy">
			<Select label="Strategy" options={['auto', 'nativeFlip', 'forcedGoto'] as const} value={policy.strategy} format={(value) => STRATEGIES[value]} disabled={disabled} onChange={(strategy) => onChange({ strategy })} />
			<div className="grid gap-3 sm:grid-cols-2">
				<NumberInput label="Mount settle" value={policy.mountSettleSeconds} min={0} max={600} suffix="s" disabled={disabled} onChange={(mountSettleSeconds) => onChange({ mountSettleSeconds })} />
				<NumberInput label="Firmware limit after transit" value={(policy.firmwareLimitSeconds ?? 0) / 60} min={0} max={360} suffix="min" disabled={disabled} onChange={(minutes) => onChange({ firmwareLimitSeconds: minutes > 0 ? minutes * 60 : undefined })} />
			</div>
			<Checkbox label="Recenter after the flip" checked={policy.recenterAfterFlip} disabled={disabled || !hasCamera} onChange={(recenterAfterFlip) => onChange({ recenterAfterFlip })} />
			<Checkbox label="Auto Focus after the flip" checked={policy.autofocusAfterFlip} disabled={disabled || !hasCamera || !hasFocuser} onChange={(autofocusAfterFlip) => onChange({ autofocusAfterFlip })} />
			<Checkbox label="Treat an unknown mount type as German equatorial" checked={policy.treatUnknownMountAsGem} disabled={disabled} onChange={(treatUnknownMountAsGem) => onChange({ treatUnknownMountAsGem })} />
			<Checkbox label="Allow the automatic flip without a pier side (inferred)" checked={policy.allowInferredVerification} disabled={disabled || !hasCamera} onChange={(allowInferredVerification) => onChange({ allowInferredVerification })} />
			<Checkbox label="Resume imaging after an inferred flip" checked={policy.allowInferredAutoResume} disabled={disabled || !hasCamera} onChange={(allowInferredAutoResume) => onChange({ allowInferredAutoResume })} />
			{policy.allowInferredAutoResume && <Notice>An inferred flip rests on plate solutions taken before and after the motion, not on the mount's own report: a rotator, a changed optical train, or a flipped image can mimic it.</Notice>}
			<Notice>Enter the firmware limit as the mount is set (such as the Meridian Treatment of an iOptron mount); 0 means unknown. It is never read from or written to the mount, and two automatic flippers must not both be active.</Notice>
		</Panel>
	)
}

// Latest execution of the mount: its steps and its outcome, the flip verification apart from the readiness of imaging.
function ExecutionPanel({ execution, pending }: { readonly execution?: MeridianFlipExecution; readonly pending: boolean }) {
	const timeZone = useActiveTimeZone()
	const captures = useSnapshot(captureRuntime)

	if (!execution) {
		return (
			<Panel title="Latest Flip">
				<Notice>No flip has run for this mount since the server started.</Notice>
			</Panel>
		)
	}

	const { outcome } = execution
	const camera = execution.setup.camera
	const capture = camera ? captures.sessions[cameraKey(camera.connectionId, camera.deviceId)] : undefined
	// Resume is offered only while the capture the flip left paused still waits for the operator.
	const pausedCapture = outcome?.captureRestoration === 'leftSuspended' && capture?.sessionId === execution.captureSessionId && capture?.suspension?.state === 'released'

	return (
		<Panel title="Latest Flip">
			<DataList>
				<DataRow label="Started">{formatZonedDateTime(execution.startedAt, timeZone)}</DataRow>
				<DataRow label="Strategy">{execution.strategy === 'nativeFlip' ? 'Native flip' : 'Forced GoTo'}</DataRow>
				<DataRow label="Target">{execution.target.label ?? (execution.target.source === 'derivedFromMount' ? 'Where the mount pointed' : 'Framed target')}</DataRow>
				{outcome && (
					<DataRow label="Flip verification" tone={outcome.verification === 'unverified' ? 'danger' : 'success'}>
						{FLIP_VERIFICATION_LABELS[outcome.verification]}
					</DataRow>
				)}
				{outcome && (
					<DataRow label="Ready for imaging" tone={outcome.readyForImaging === 'ready' ? 'success' : 'danger'}>
						{outcome.readyForImaging === 'ready' ? 'Yes' : 'No'}
					</DataRow>
				)}
				{outcome?.pierSideBefore && <DataRow label="Pier side">{`${outcome.pierSideBefore} → ${outcome.pierSideAfter ?? MISSING}`}</DataRow>}
				{outcome && <DataRow label="Movement observed">{outcome.movementObserved ? 'Yes' : 'No'}</DataRow>}
				{outcome?.wcs && <DataRow label="Plate solutions">{outcome.wcs.status === 'missing' ? 'Missing' : outcome.wcs.status === 'consistent' ? 'Field turned by half a turn' : 'Inconsistent with a flip'}</DataRow>}
				{outcome?.recentering && <DataRow label="Recentering">{RESTORATIONS[outcome.recentering]}</DataRow>}
				{outcome?.autofocus && <DataRow label="Auto Focus">{RESTORATIONS[outcome.autofocus]}</DataRow>}
				{outcome?.guidingRestoration && <DataRow label="Guiding">{RESTORATIONS[outcome.guidingRestoration]}</DataRow>}
				{outcome?.captureRestoration && <DataRow label="Capture">{RESTORATIONS[outcome.captureRestoration]}</DataRow>}
			</DataList>
			{execution.error && <Notice error>{execution.error}</Notice>}
			{execution.steps.length > 0 && (
				<Table columns={['Step', 'Outcome', 'Time']}>
					{execution.steps.map((step) => (
						<Row key={`${step.step}:${step.startedAt}`}>
							<Cell>{MERIDIAN_FLIP_STEP_LABELS[step.step]}</Cell>
							<Cell>{step.detail ? `${STEP_OUTCOMES[step.outcome]}: ${step.detail}` : STEP_OUTCOMES[step.outcome]}</Cell>
							<Cell numeric>{formatZonedDateTime(step.startedAt, timeZone)}</Cell>
						</Row>
					))}
				</Table>
			)}
			<Actions>
				{execution.state === 'running' && (
					<Button variant="secondary" disabled={pending} onClick={() => void cancelMeridianFlip(meridianFlipExecutorState, execution)}>
						Cancel
					</Button>
				)}
				{pausedCapture && (
					<ConfirmButton title="Resume the paused capture?" message="The flip did not leave imaging ready. Resume the capture only once you checked the mount, the framing, and guiding." confirmLabel="Resume" disabled={pending} onConfirm={() => void resumePausedCapture(meridianFlipExecutorState, execution)}>
						Resume Capture
					</ConfirmButton>
				)}
			</Actions>
		</Panel>
	)
}

// Card of one section of the tool.
function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-sm font-semibold text-ink-100">{title}</h2>
			{children}
		</section>
	)
}
