import type { ExecutorEligibility, FlipStrategyChoice, MeridianFlipExecution, MeridianFlipExecutionRequest, MeridianFlipExecutorPolicy, MeridianFlipMonitor, MeridianFlipStepOutcome, OperationDevice } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { autoFocusRequest, defaultStepSize } from '../../camera/autofocus'
import { cameraKey, captureRunning, captureRuntime, captureSnoop } from '../../camera/capture'
import { targetCenteringRequest } from '../../camera/targetcentering'
import { controlRuntime, deviceStateOf, watchedDeviceState } from '../../equipment-control/control'
import { type RoleDevice, useRoleDevice } from '../../equipment/useEquipment'
import { formatDuration, formatLocalTime, MISSING } from '../../format'
import { useActiveTimeZone } from '../../location/useLocation'
import { activeProfile, activeSetup, autoFocusSettings, cameraPlateSolving, exposureSettings, meridianFlipExecutorPolicy, profileCamera, profileState, starDetectionSettings, targetCenteringSettings } from '../../profile/profile'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { useNow } from '../../useNow'
import { formatFromNow, MERIDIAN_AVAILABILITY_LABELS, MERIDIAN_PIER_SIDES, monitorKey } from './meridianflip'
import { executeMeridianFlip, FLIP_VERIFICATION_LABELS, FLIP_VERIFICATION_MODE_LABELS, latestExecution, MERIDIAN_FLIP_STEP_LABELS, meridianFlipEligibility, meridianFlipExecutionHeadline, meridianFlipExecutorState } from './meridianflipexecutor'
import { FlipSection } from './MeridianFlipSection'

// Executor section of the Meridian Flip tool, for the MOUNT of the Equipment Setup and its monitor: when the window opens
// and closes, what the server would decide now, the requests (flip when the window opens, which runs unattended, and
// flip now), and the latest execution with its steps and outcome. A request is built from the Equipment Setup, the flip
// policy the profile remembers for the mount, and the camera forms the profile keeps for the main camera. Every decision
// and every command is the server's; nothing here moves anything until the operator confirms a request, and closing the
// tab or switching profile leaves a running execution or an arm alone.

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

// Executor section for the mount of the Equipment Setup and its monitor: the flip and the latest execution.
export function MeridianFlipExecutorView({ mount, monitor }: { readonly mount: RoleDevice; readonly monitor?: MeridianFlipMonitor }) {
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
	const flipBlocker = blocker ?? busy ?? (arm ? 'A flip is already scheduled; disarm it first.' : monitor && monitor.availability !== 'monitoring' ? `The monitor follows no settled target: ${MERIDIAN_AVAILABILITY_LABELS[monitor.availability].toLowerCase()}.` : undefined)
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
			} = targetCenteringRequest('center', { rightAscension: 0, declination: 0 }, targetCenteringSettings(profile.settings, cameraIdentity), exposure, cameraPlateSolving(profile.settings, cameraIdentity), { mount: mountDevice }, capabilities)
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
								<p className="mt-2">
									The server flips this mount by itself, once, for this passage only. It is refused when the preferred window closes after the firmware limit. A flip that can only be inferred from plate solutions, or not verified at all, still runs, and leaves the capture paused unless the policy
									accepts it. A restart of the server forgets it.
								</p>
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
					<Button variant="secondary" disabled={!!checkBlocker} title={checkBlocker ?? 'Asks the server what it would decide now; starts nothing.'} onClick={() => void check()}>
						Check Now
					</Button>
				</Actions>
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
