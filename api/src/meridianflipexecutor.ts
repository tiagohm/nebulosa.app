import { angularDistance, equatorialFromJ2000, equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { MountFlipExecution, MountFlipStrategy } from 'nebulosa/src/devices/commanders/mount'
import type { Mount, PierSide } from 'nebulosa/src/devices/indi/device'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { failedOperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey, type ResourceReservation, type ResourceReservationOwner } from 'nebulosa/src/devices/orchestration/resource'
import { type Angle, deg, toDeg } from 'nebulosa/src/math/units/angle'
import { toMeter } from 'nebulosa/src/math/units/distance'
import type { AutoFocusRequest, AutoFocusSessions } from './autofocus'
import type { CameraCaptures, CaptureSuspensionHandle } from './captures'
import { type ClientResolver, type CommandRefusal, type CommandRequest, type DeviceContext, findDevice, refusal, refusalResponse, resolveConnected } from './commands'
import type { DeviceRegistry } from './devices'
import type { GuidingSessions, GuidingSuspension } from './guiding'
import { errorResponse } from './http'
import type { MeridianFlipService } from './meridianflip'
import {
	acceptsVerification,
	classifyFlip,
	compareWcs,
	DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY,
	evaluateEligibility,
	type ExecutorEligibility,
	type FlipTrigger,
	type FlipVerification,
	type FlipVerificationMode,
	MAXIMUM_REEVALUATION_DELAY,
	type MeridianFlipExecutorErrorCode,
	type MeridianFlipExecutorPolicy,
	type WcsEvidence,
	type WcsMeasurement,
} from './meridianflipexecutor.policy'
import type { MountCommands } from './mounts'
import type { OperationDevice, OperationRegistry } from './operations'
import type { TargetCenteringRequest, TargetCenteringSessions, TargetCenteringSessionSummary } from './targetcentering'
import type { ServerEvent } from './websocket'

// Meridian Flip Executor: the server-owned workflow that flips a German equatorial mount at its meridian passage and gives
// imaging back, composing the services that already own each step instead of commanding devices itself. It reads the
// passive Meridian Flip Monitor (meridianflip.ts), which never moves anything, and adds the decisions of
// meridianflipexecutor.policy.ts. One execution runs per physical mount; a flip is started by an explicit request (now),
// by a one-shot request that waits for the window (when eligible), or by the automatic arm, never by the Monitor alone.
//
// An execution freezes its target and the equipment of the Equipment Setup it was asked with, opens one reservation of the
// arbiter, and in order: pauses the running capture of the main camera at its next frame boundary, lending the camera (and
// the reservation of its mount dithers) to the reservation (CameraCaptures.suspendForMotion); suspends the guiding of the
// setup's guide output, handing it the mount and the guide output with no gap (GuidingSessions.suspendForMotion); reserves
// the mount, the guide output, the camera, and the focuser; when the mount publishes no usable pier side, takes a plate
// solution of the frozen target before the flip (Target Centering in Verify Only); flips the mount by the driver's own flip
// or a forced GoTo (MountCommands.admitMeridianFlip), always sent and never corrected; classifies the evidence (verified by
// the driver's pier side, inferred from the plate solutions around the motion, or unverified); and only when the flip is
// accepted by the policy, recenters the target (Target Centering in Recenter) and refocuses (Auto Focus). Then it drains the
// reservation, gives the camera back to the capture, restores guiding, and lets the capture go on only when the flip was
// accepted and every step it asked for succeeded; otherwise the capture stays paused for the operator. A flip never repeats:
// an uncertain motion stays uncertain, and a passage already flipped is never flipped again.
//
// Nothing survives the process: arms, executions, the passages flipped, and the reservation live in memory, a restart re-arms
// nothing and replays no motion. Cancelling an execution cancels its operations through the reservation, as every other
// stop does, and an emergency stop of the mount still preempts it. Instants are Unix milliseconds, angles radians, durations
// seconds.

// Steps of an execution, in the order they run; the optional ones are skipped when they do not apply.
export type MeridianFlipStep = 'preflight' | 'waitingForBoundary' | 'suspendingGuiding' | 'acquiringResources' | 'referenceSolve' | 'flipping' | 'verifying' | 'settling' | 'measuring' | 'recentering' | 'autofocusing' | 'restoringGuiding' | 'resumingCapture'

// What became of a step: done, skipped because it did not apply or an earlier step failed, or failed.
export type MeridianFlipStepOutcome = 'running' | 'done' | 'skipped' | 'failed'

// One step of an execution as published.
export interface MeridianFlipStepRecord {
	// Step.
	readonly step: MeridianFlipStep
	// What became of it.
	readonly outcome: MeridianFlipStepOutcome
	// Instant it started.
	readonly startedAt: number
	// Instant it ended; absent while it runs.
	readonly endedAt?: number
	// Detail meant for people.
	readonly detail?: string
}

// Life of an execution:
// - running: steps are running.
// - completed: it ended with the flip accepted and imaging ready.
// - failed: it ended without imaging ready; outcome and code tell why. The capture, if any, stays paused.
// - blocked: the flip motion ended in a state that could not be established, so the mount needs the operator's eyes; nothing
//   was resumed.
// - cancelled: it was cancelled.
export type MeridianFlipExecutionState = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled'

// Whether the setup is ready to go on imaging after an execution.
export type PostFlipReadiness = 'ready' | 'notReady' | 'notRequired'

// Outcome of an execution, every dimension apart: the mechanical flip is never collapsed into the readiness of imaging.
export interface MeridianFlipOutcome {
	// Strategy the flip was commanded with.
	readonly executionStrategy: MountFlipStrategy
	// How strongly the flip is established.
	readonly verification: FlipVerification
	// Whether the flip command ran to its end without an unknown physical outcome.
	readonly flipCommandCompleted: boolean
	// Whether the mount was observed moving after the command.
	readonly movementObserved: boolean
	// Pier side before the flip, when the driver reported one.
	readonly pierSideBefore?: PierSide
	// Pier side after the flip, when the driver reported one.
	readonly pierSideAfter?: PierSide
	// Whether a plate solution after the motion found the target within tolerance.
	readonly targetPositionConfirmed: boolean
	// Comparison of the plate solutions around the flip, when the flip had to be inferred.
	readonly wcs?: WcsEvidence
	// What became of the recentering, the Auto Focus, guiding, and the capture.
	readonly recentering?: 'completed' | 'failed' | 'skipped'
	readonly autofocus?: 'completed' | 'failed' | 'skipped'
	readonly guidingRestoration?: 'restored' | 'failed' | 'externallyChanged' | 'notNeeded'
	readonly captureRestoration?: 'resumed' | 'leftSuspended' | 'externallyChanged' | 'notNeeded'
	// Whether imaging may go on.
	readonly readyForImaging: PostFlipReadiness
}

// Equipment an execution uses, frozen from the Equipment Setup it was asked with, by exact ids.
export interface MeridianFlipSetup {
	// Main camera whose capture is paused and which solves and focuses; absent when the setup has none.
	readonly camera?: OperationDevice
	// Guide output that drives the mount (the setup's GUIDE_OUTPUT), whose guiding is suspended and restored.
	readonly guideOutput?: OperationDevice
	// Focuser Auto Focus moves.
	readonly focuser?: OperationDevice
	// Rotator whose angle must not change between the plate solutions of an inferred flip; it is never moved.
	readonly rotator?: OperationDevice
}

// Target of an execution, ICRS, in radians: the object the operator framed, or, without one, where the mount pointed when
// the execution was asked for (derivedFromMount).
export interface MeridianFlipTarget {
	readonly rightAscension: Angle
	readonly declination: Angle
	// Name meant for people.
	readonly label?: string
}

// Settings of Target Centering an execution measures and recenters with; the mount, the target, the mode, and the guiding
// coordination are the execution's.
export type MeridianFlipCentering = Omit<TargetCenteringRequest, 'token' | 'mount' | 'guideOutput' | 'mode' | 'target' | 'guiding'>

// Settings of Auto Focus an execution refocuses with; the focuser is the setup's.
export type MeridianFlipAutoFocus = Omit<AutoFocusRequest, 'token' | 'focuser'>

// Body of POST .../meridian-flip/execute and .../meridian-flip/arm.
export interface MeridianFlipExecutionRequest extends CommandRequest {
	// Equipment of the setup.
	readonly setup: MeridianFlipSetup
	// Object the operator framed; absent takes where the mount points.
	readonly target?: MeridianFlipTarget
	// Policy of the mount.
	readonly policy: MeridianFlipExecutorPolicy
	// Target Centering settings; required to recenter or to infer a flip.
	readonly centering?: MeridianFlipCentering
	// Auto Focus settings; required to refocus.
	readonly autoFocus?: MeridianFlipAutoFocus
}

// Body of POST .../meridian-flip/execute: now, refused unless eligible at once, or once eligible, waiting for the window.
export interface MeridianFlipExecuteRequest extends MeridianFlipExecutionRequest {
	readonly mode: 'now' | 'whenEligible'
}

// Execution as published.
export interface MeridianFlipExecution {
	// Id of the execution.
	readonly sessionId: string
	// Id of the open connection that provides the mount.
	readonly connectionId: string
	// Exact id of the mount.
	readonly deviceId: string
	// Name of the mount.
	readonly mountName: string
	// What started it.
	readonly trigger: FlipTrigger
	// Life of the execution.
	readonly state: MeridianFlipExecutionState
	// Step running; absent once it ended.
	readonly step?: MeridianFlipStep
	// Steps so far, in order.
	readonly steps: readonly MeridianFlipStepRecord[]
	// Equipment it uses.
	readonly setup: MeridianFlipSetup
	// Policy it runs with.
	readonly policy: MeridianFlipExecutorPolicy
	// Frozen target, and where it came from.
	readonly target: MeridianFlipTarget & { readonly source: 'explicit' | 'derivedFromMount' }
	// How the flip is commanded and verified.
	readonly strategy: MountFlipStrategy
	readonly verificationMode: FlipVerificationMode
	// Monitor context and passage it was decided for.
	readonly contextId: string
	readonly passage: string
	// Capture session it paused, when it paused one.
	readonly captureSessionId?: string
	// Evidence of the flip motion, once it ended.
	readonly execution?: MountFlipExecution
	// Outcome so far; final once the execution ended.
	readonly outcome?: MeridianFlipOutcome
	// Problems meant for people, latest last.
	readonly warnings: readonly string[]
	// Why it did not complete.
	readonly code?: MeridianFlipExecutorErrorCode
	readonly error?: string
	// Instants it started and ended.
	readonly startedAt: number
	readonly endedAt?: number
	// Number of changes published so far.
	readonly revision: number
}

// Request waiting for its flip window, scheduled once or armed automatically.
export interface MeridianFlipArm {
	// Id of the arm.
	readonly armId: string
	// Id of the open connection that provides the mount.
	readonly connectionId: string
	// Exact id of the mount.
	readonly deviceId: string
	// Name of the mount.
	readonly mountName: string
	// One-shot (scheduled) or automatic.
	readonly trigger: Exclude<FlipTrigger, 'manual'>
	// Instant it was armed.
	readonly armedAt: number
	// Latest decision taken for it.
	readonly decision: ExecutorEligibility
	// Policy it will run with.
	readonly policy: MeridianFlipExecutorPolicy
}

// Snapshot of GET /api/meridian-flip/executions.
export interface MeridianFlipExecutorSnapshot {
	// Id of this server process; revisions only compare within one epoch.
	readonly epoch: string
	// Revision of the service when the snapshot was taken.
	readonly revision: number
	// Running and recent executions, oldest first.
	readonly executions: readonly MeridianFlipExecution[]
	// Arms waiting for their window.
	readonly arms: readonly MeridianFlipArm[]
}

// Identity of a mount in the arm events.
export interface MeridianFlipExecutorKey {
	readonly connectionId: string
	readonly deviceId: string
}

// Notification published when an execution changes, and when an arm is set, decided again, or removed (arm absent).
export type MeridianFlipExecutorEvent =
	| { readonly type: 'meridianFlipExecutor:updated'; readonly epoch: string; readonly revision: number; readonly execution: MeridianFlipExecution }
	| { readonly type: 'meridianFlipExecutor:armed'; readonly epoch: string; readonly revision: number; readonly key: MeridianFlipExecutorKey; readonly arm?: MeridianFlipArm }

// Services an execution composes, as far as it uses them.
export interface MeridianFlipExecutorServices {
	readonly monitor: Pick<MeridianFlipService, 'monitor'>
	readonly mounts: Pick<MountCommands, 'admitMeridianFlip'>
	readonly captures: Pick<CameraCaptures, 'snapshot' | 'suspendForMotion'>
	readonly guiding: Pick<GuidingSessions, 'runsOn' | 'hold' | 'suspendForMotion' | 'restoreAfterMotion'>
	readonly targetCentering: Pick<TargetCenteringSessions, 'admit' | 'interrupt' | 'solutionsOf'>
	readonly autoFocus: Pick<AutoFocusSessions, 'admit' | 'interrupt'>
}

// Clock and timers of the service, replaced by tests.
export interface MeridianFlipExecutorOptions {
	// Current instant.
	readonly now: () => number
}

// Clock of the service outside tests.
const SYSTEM_CLOCK: MeridianFlipExecutorOptions = { now: Date.now }

// Executions kept after they ended, oldest first out.
const EXECUTION_HISTORY = 50

// Tokens remembered so a repeated request answers its first admission; oldest first out.
const MAX_TOKENS = 256

// How long a flipped passage is remembered, in milliseconds (12 hours): longer than any passage lasts, shorter than a day.
const PASSAGE_MEMORY = 12 * 3600000

// Seconds a frame of a running capture is assumed to need beyond its exposure and delay for its transfer, write, and a dither
// settle, when estimating how long a flip may wait for the boundary; a planning margin.
const FRAME_OVERHEAD_SECONDS = 30

// Largest distance between where the mount points and the frozen target before the target is no longer the one observed, in
// radians (1°): pointing errors stay well under it, another object does not.
const TARGET_TOLERANCE = deg(1)

// Name the Executor holds guiding and captures under, meant for people.
const HOLDER = 'Meridian Flip Executor'

// Returns the site a mount reports, as an observer: degrees, longitude east positive, and meters.
function observerOf({ geographicCoordinate: { latitude, longitude, elevation } }: Mount) {
	return { latitude: toDeg(latitude), longitude: toDeg(longitude), elevation: toMeter(elevation) }
}

// Execution while the service knows it.
interface Session {
	execution: MeridianFlipExecution
	// Mount being flipped.
	readonly mount: Mount
	// Resource key of the mount, one execution per key.
	readonly key: string
	// Request it was asked with.
	readonly request: MeridianFlipExecutionRequest
	// Cancels the remaining steps.
	readonly controller: AbortController
	// Resolved once it ended.
	readonly ended: PromiseWithResolvers<MeridianFlipExecution>
	// Target Centering or Auto Focus session running, interrupted on cancel.
	tool?: { readonly interrupt: () => unknown }
}

// Target frozen for an execution, with where it came from.
type FrozenTarget = MeridianFlipExecution['target']

// Why an execution did not complete, as its steps record it.
interface ExecutionFailure {
	readonly state: 'failed' | 'blocked' | 'cancelled'
	readonly code: MeridianFlipExecutorErrorCode
	readonly error: string
}

// Arm while the service knows it.
interface Arm {
	arm: MeridianFlipArm
	readonly request: MeridianFlipExecutionRequest
	// Target frozen when it was armed.
	readonly target: FrozenTarget
	// Context the arm was decided for once the mount tracked a target.
	contextId?: string
	// Timer of the next decision.
	timer?: Timer
}

// Meridian Flip Executor of every open connection.
export class MeridianFlipExecutor implements DeviceContext, Disposable {
	// Id of this process.
	readonly #epoch = Bun.randomUUIDv7()
	// Revision of the service; grows with every publication.
	#revision = 0
	// Running and recent executions by id, oldest first.
	readonly #executions = new Map<string, Session>()
	// Running execution of each mount, by resource key.
	readonly #active = new Map<string, Session>()
	// Arm of each mount, by resource key.
	readonly #arms = new Map<string, Arm>()
	// Passages flipped or being flipped, with the instant they are forgotten.
	readonly #passages = new Map<string, number>()
	// Answers of the remembered tokens.
	readonly #tokens = new Map<string, Response>()

	// Creates the service over the devices of every open connection. services are the tools it composes, publish receives
	// every event, and options the clock.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly services: MeridianFlipExecutorServices,
		readonly publish: (event: MeridianFlipExecutorEvent) => void,
		readonly options: MeridianFlipExecutorOptions = SYSTEM_CLOCK,
	) {}

	// Returns every running and recent execution and every arm.
	snapshot(): MeridianFlipExecutorSnapshot {
		return { epoch: this.#epoch, revision: this.#revision, executions: Array.from(this.#executions.values(), (session) => session.execution), arms: Array.from(this.#arms.values(), (arm) => arm.arm) }
	}

	// Responds with an execution, or 404.
	execution(sessionId: string): Response {
		const session = this.#executions.get(sessionId)
		return session ? Response.json(session.execution) : errorResponse('Execution not found', 404, 'notFound')
	}

	// Returns the end of an execution, for a caller inside the process; undefined for an unknown one.
	ended(sessionId: string): Promise<MeridianFlipExecution> | undefined {
		return this.#executions.get(sessionId)?.ended.promise
	}

	// Responds with what would be decided for a request now, starting nothing.
	eligibility(connectionId: string, deviceId: string, request: MeridianFlipExecutionRequest & { readonly trigger?: FlipTrigger }): Response {
		const resolved = resolveConnected(this, connectionId, 'mount', deviceId, 'Mount')
		if (!resolved.ok) return refusalResponse(resolved)
		return Response.json(this.#decide(connectionId, deviceId, resolved.device, request, request.trigger ?? 'manual'))
	}

	// Executes a flip now (refused unless eligible at once) or arms a one-shot flip for its window. Responds 202 with the
	// execution or the arm, and refuses with { error, code }: 404 unknown mount or device; 409 disconnected, busy (an execution
	// runs or an arm waits), or a decision refusing it; 422 when the setup lacks what the policy needs.
	execute(connectionId: string, deviceId: string, request: MeridianFlipExecuteRequest): Response {
		return this.#remembered(request.token, () => (request.mode === 'now' ? this.#now(connectionId, deviceId, request) : this.#arm(connectionId, deviceId, request, 'scheduled')))
	}

	// Arms the automatic flip of a mount, answered like execute.
	arm(connectionId: string, deviceId: string, request: MeridianFlipExecutionRequest): Response {
		return this.#remembered(request.token, () => this.#arm(connectionId, deviceId, request, 'automatic'))
	}

	// Removes the arm of a mount; a running execution is left alone. Responds 204, also when nothing was armed.
	disarm(connectionId: string, deviceId: string): Response {
		for (const [key, arm] of this.#arms) if (arm.arm.connectionId === connectionId && arm.arm.deviceId === deviceId) this.#removeArm(key)
		return new Response(null, { status: 204 })
	}

	// Cancels an execution: its pending steps are not run, its running operations are cancelled through its reservation, and it
	// gives back what it can. Responds 202, also when it already ended, and 404 for an unknown one.
	cancel(sessionId: string): Response {
		const session = this.#executions.get(sessionId)
		if (!session) return errorResponse('Execution not found', 404, 'notFound')
		this.#cancel(session)
		return new Response(null, { status: 202 })
	}

	// Follows the Monitor to decide the arms again, and forgets the arms of a mount that went away.
	consume(event: ServerEvent) {
		switch (event.type) {
			case 'meridianFlip:updated':
				for (const [key, arm] of this.#arms) if (arm.arm.connectionId === event.key.connectionId && arm.arm.deviceId === event.key.deviceId) this.#reevaluate(key)
				break
			case 'device:removed':
				for (const [key, arm] of this.#arms) if (arm.arm.connectionId === event.connectionId && arm.arm.deviceId === event.id) this.#removeArm(key)
				break
			case 'connection:close':
				for (const [key, arm] of this.#arms) if (arm.arm.connectionId === event.id) this.#removeArm(key)
				break
		}
	}

	// Removes every arm and cancels every execution; nothing is persisted.
	[Symbol.dispose]() {
		for (const key of Array.from(this.#arms.keys())) this.#removeArm(key)
		for (const session of this.#active.values()) this.#cancel(session)
	}

	// Answers a token's first response again, or computes and remembers it.
	#remembered(token: string, answer: () => Response) {
		const known = this.#tokens.get(token)
		if (known) return known.clone()
		const response = answer()
		this.#tokens.set(token, response.clone())
		if (this.#tokens.size > MAX_TOKENS) this.#tokens.delete(this.#tokens.keys().next().value!)
		return response
	}

	// Executes now, or answers why not.
	#now(connectionId: string, deviceId: string, request: MeridianFlipExecutionRequest): Response {
		const prepared = this.#prepare(connectionId, deviceId, request)
		if (!prepared.ok) return refusalResponse(prepared)

		const decision = this.#decide(connectionId, deviceId, prepared.mount, request, 'manual')
		if (decision.decision !== 'eligible') return errorResponse(decision.reason, 409, decision.code)

		const session = this.#start(connectionId, deviceId, prepared.mount, request, this.#frozen(prepared.mount, request), 'manual', decision)
		return Response.json(session.execution, { status: 202 })
	}

	// Arms a flip for its window, starting it at once when it is already eligible.
	#arm(connectionId: string, deviceId: string, request: MeridianFlipExecutionRequest, trigger: Exclude<FlipTrigger, 'manual'>): Response {
		const prepared = this.#prepare(connectionId, deviceId, request)
		if (!prepared.ok) return refusalResponse(prepared)

		const decision = this.#decide(connectionId, deviceId, prepared.mount, request, trigger)
		if (decision.decision === 'refuse' && decision.code !== 'notTracking') return errorResponse(decision.reason, 409, decision.code)

		const key = resourceKey(prepared.mount)
		const arm: Arm = {
			arm: { armId: Bun.randomUUIDv7(), connectionId, deviceId, mountName: prepared.mount.name, trigger, armedAt: this.options.now(), decision, policy: request.policy },
			request,
			target: this.#frozen(prepared.mount, request),
			contextId: decision.decision === 'eligible' ? decision.contextId : this.services.monitor.monitor(connectionId, deviceId)?.contextId,
		}

		this.#arms.set(key, arm)
		this.#publishArm(arm)
		this.#reevaluate(key)
		return Response.json(arm.arm, { status: 202 })
	}

	// Checks the mount, the equipment, and that nothing else flips the mount; returns the mount or why not.
	#prepare(connectionId: string, deviceId: string, request: MeridianFlipExecutionRequest): { readonly ok: true; readonly mount: Mount } | CommandRefusal<MeridianFlipExecutorErrorCode | 'notFound' | 'disconnected'> {
		const resolved = resolveConnected(this, connectionId, 'mount', deviceId, 'Mount')
		if (!resolved.ok) return resolved.code === 'notFound' || resolved.code === 'disconnected' ? refusal(resolved.error, resolved.status, resolved.code) : refusal(resolved.error, resolved.status, 'busy')
		const mount = resolved.device
		const key = resourceKey(mount)

		if (this.#active.has(key)) return refusal('A meridian flip of this mount is running', 409, 'busy')
		if (this.#arms.has(key)) return refusal('A meridian flip of this mount is already armed; disarm it first', 409, 'conflict')

		const { setup, policy } = request

		for (const [type, device, what] of [
			['camera', setup.camera, 'Camera'],
			['guideOutput', setup.guideOutput, 'Guide output'],
			['focuser', setup.focuser, 'Focuser'],
			['rotator', setup.rotator, 'Rotator'],
		] as const) {
			if (device && !findDevice(this, device.connectionId, type, device.deviceId)) return refusal(`${what} not found`, 404, 'notFound')
		}

		if (policy.recenterAfterFlip && (!setup.camera || !request.centering)) return refusal('Recentering needs the main camera of the setup and Target Centering settings', 422, 'missingCamera')
		if (policy.autofocusAfterFlip && (!setup.camera || !request.autoFocus)) return refusal('Auto Focus needs the main camera of the setup and Auto Focus settings', 422, 'missingCamera')
		if (policy.autofocusAfterFlip && !setup.focuser) return refusal('Auto Focus needs the focuser of the setup', 422, 'missingFocuser')

		return { ok: true, mount }
	}

	// Decides whether a flip of a mount may start now for a request.
	#decide(connectionId: string, deviceId: string, mount: Mount, request: MeridianFlipExecutionRequest, trigger: FlipTrigger, expectedContextId?: string): ExecutorEligibility {
		this.#forgetPassages()
		const capture = this.#capture(request.setup)

		return evaluateEligibility({
			now: this.options.now(),
			trigger,
			monitor: this.services.monitor.monitor(connectionId, deviceId),
			mount,
			policy: { ...DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, ...request.policy },
			canInfer: request.setup.camera !== undefined && request.centering !== undefined,
			boundarySeconds: capture ? capture.request.exposureTime + capture.request.delay + FRAME_OVERHEAD_SECONDS : 0,
			serviced: new Set(this.#passages.keys()),
			expectedContextId,
		})
	}

	// Decides an arm again, starting its execution once eligible and removing it once refused for good.
	#reevaluate(key: string) {
		const arm = this.#arms.get(key)
		if (!arm) return

		clearTimeout(arm.timer)
		arm.timer = undefined

		const { connectionId, deviceId, trigger } = arm.arm
		const mount = findDevice(this, connectionId, 'mount', deviceId)
		if (!mount) return this.#removeArm(key)

		const decision = this.#decide(connectionId, deviceId, mount, arm.request, trigger, arm.contextId)
		arm.arm = { ...arm.arm, decision }
		this.#publishArm(arm)

		if (decision.decision === 'eligible') {
			this.#removeArm(key)
			this.#start(connectionId, deviceId, mount, arm.request, arm.target, trigger, decision)
		} else if (decision.decision === 'wait') {
			const delay = Math.min(MAXIMUM_REEVALUATION_DELAY, Math.max(1000, (decision.reevaluateAt ?? this.options.now() + MAXIMUM_REEVALUATION_DELAY) - this.options.now()))
			arm.timer = setTimeout(() => this.#reevaluate(key), delay)
		} else if (decision.code !== 'notTracking') {
			// A target that is not settled yet may become so; any other refusal ends the arm, which publishes why.
			this.#removeArm(key)
		}
	}

	// Removes an arm and publishes its removal.
	#removeArm(key: string) {
		const arm = this.#arms.get(key)
		if (!arm) return
		clearTimeout(arm.timer)
		this.#arms.delete(key)
		this.#revision++
		this.publish({ type: 'meridianFlipExecutor:armed', epoch: this.#epoch, revision: this.#revision, key: { connectionId: arm.arm.connectionId, deviceId: arm.arm.deviceId } })
	}

	// Publishes an arm.
	#publishArm(arm: Arm) {
		this.#revision++
		this.publish({ type: 'meridianFlipExecutor:armed', epoch: this.#epoch, revision: this.#revision, key: { connectionId: arm.arm.connectionId, deviceId: arm.arm.deviceId }, arm: arm.arm })
	}

	// Freezes the target of a request: the object it names, or where the mount points now, as an ICRS target.
	#frozen(mount: Mount, request: MeridianFlipExecutionRequest): FrozenTarget {
		if (request.target) return { ...request.target, source: 'explicit' }
		const [rightAscension, declination] = equatorialToJ2000(mount.equatorialCoordinate.rightAscension, mount.equatorialCoordinate.declination, timeUnix(this.options.now() / 1000, true))
		return { rightAscension, declination, source: 'derivedFromMount' }
	}

	// Running capture of the setup's main camera, if any.
	#capture(setup: MeridianFlipSetup) {
		const camera = setup.camera
		return camera && this.services.captures.snapshot().sessions.find((session) => session.connectionId === camera.connectionId && session.deviceId === camera.deviceId && session.endedAt === undefined)
	}

	// Starts an execution decided eligible: records its passage at once, so nothing flips it again, and runs it.
	#start(connectionId: string, deviceId: string, mount: Mount, request: MeridianFlipExecutionRequest, target: FrozenTarget, trigger: FlipTrigger, decision: Extract<ExecutorEligibility, { decision: 'eligible' }>): Session {
		const now = this.options.now()
		const key = resourceKey(mount)
		this.#passages.set(decision.passage, now + PASSAGE_MEMORY)

		const session: Session = {
			execution: {
				sessionId: Bun.randomUUIDv7(),
				connectionId,
				deviceId,
				mountName: mount.name,
				trigger,
				state: 'running',
				steps: [],
				setup: request.setup,
				policy: { ...DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, ...request.policy },
				target,
				strategy: decision.strategy,
				verificationMode: decision.verificationMode,
				contextId: decision.contextId,
				passage: decision.passage,
				warnings: [],
				startedAt: now,
				revision: 0,
			},
			mount,
			key,
			request,
			controller: new AbortController(),
			ended: Promise.withResolvers(),
		}

		this.#active.set(key, session)
		this.#executions.set(session.execution.sessionId, session)
		this.#trim()
		this.#update(session, {})

		const result = this.#run(session).then(
			() => successfulOperationResult(undefined),
			(error: unknown) => {
				console.error('the meridian flip execution failed unexpectedly:', error)
				this.#end(session, 'failed', { code: 'unknownResult', error: Error.isError(error) ? error.message : String(error) })
				return failedOperationResult('commandFailed')
			},
		)

		this.operations.track(
			'mount.meridianFlipExecutor',
			[{ connectionId, deviceId }],
			result.then(() => (session.execution.state === 'completed' ? successfulOperationResult(undefined) : failedOperationResult(session.execution.state === 'cancelled' ? 'aborted' : 'unexpectedState', session.execution.error))),
		)
		return session
	}

	// Runs the steps of an execution, then gives back what it took. Never rejects on an expected failure.
	async #run(session: Session) {
		const { mount, request, controller } = session
		const { signal } = controller
		const { setup } = request
		const policy = session.execution.policy
		const owner: ResourceReservationOwner = { id: session.execution.sessionId, kind: 'mount.meridianFlipExecutor' }
		const reserved = this.operations.arbiter.reserve(owner, [])
		if (!reserved.ok) return this.#end(session, 'failed', { code: 'busy', error: 'The reservation could not be opened' })
		const reservation = reserved.reservation
		const invocation = { reservation }
		const hold = setup.guideOutput && this.services.guiding.hold(setup.guideOutput, HOLDER)

		let capture: CaptureSuspensionHandle | undefined
		const suspensions: GuidingSuspension[] = []
		let dispatched = false
		// First failure of the steps; a holder, since the steps record it through fail.
		const outcomeOf: { failure?: ExecutionFailure } = {}
		let execution: MountFlipExecution | undefined
		let verification: FlipVerification = 'unverified'
		let wcs: WcsEvidence | undefined
		let targetPositionConfirmed = false
		let recentering: MeridianFlipOutcome['recentering'] = 'skipped'
		let autofocus: MeridianFlipOutcome['autofocus'] = 'skipped'
		let captureSessionId: string | undefined
		const fail = (state: 'failed' | 'blocked' | 'cancelled', code: MeridianFlipExecutorErrorCode, error: string) => {
			outcomeOf.failure ??= signal.aborted ? { state: 'cancelled', code: 'cancelled', error: 'The execution was cancelled' } : { state, code, error }
		}

		try {
			// Waits for the capture to reach a frame boundary and takes its camera.
			const running = this.#capture(setup)

			if (running) {
				this.#step(session, 'waitingForBoundary')
				captureSessionId = running.sessionId
				const suspended = await this.services.captures.suspendForMotion(running.sessionId, { id: session.execution.sessionId, holder: HOLDER, reservation }, signal)

				if ('ok' in suspended) {
					fail('failed', 'captureHandoffFailed', suspended.error)
				} else if (suspended.status === 'suspended') {
					capture = suspended.handle
					this.#update(session, { captureSessionId })
					this.#stepEnd(session, 'done')
				} else if (suspended.status === 'captureEnded') {
					captureSessionId = undefined
					this.#stepEnd(session, 'skipped', 'The capture ended before its next frame')
				} else {
					fail('cancelled', 'cancelled', 'The execution was cancelled while the capture finished its frame')
				}
			}

			// Suspends the guiding of the setup into the reservation.
			if (!outcomeOf.failure && setup.guideOutput) {
				const runs = this.services.guiding.runsOn(setup.guideOutput)

				if (runs.length > 0) {
					this.#step(session, 'suspendingGuiding')

					for (const run of runs) {
						if (run.state !== 'guiding' && run.state !== 'lostLock') {
							fail('failed', 'guidingActive', `${run.cameraName} is ${run.state}; it cannot be suspended for the flip`)
							break
						}

						const suspended = await this.services.guiding.suspendForMotion(run.sessionId, { reservation })
						if (!suspended.ok) {
							fail('failed', 'guidingActive', suspended.error ?? 'Guiding could not be suspended')
							break
						}

						suspensions.push(suspended.value)
					}

					this.#stepEnd(session, outcomeOf.failure ? 'failed' : 'done')
				}
			}

			// Reserves the rest of the setup, then checks the target is still the one observed.
			if (!outcomeOf.failure) {
				this.#step(session, 'acquiringResources')
				const devices = [
					mount,
					...[
						setup.camera && findDevice(this, setup.camera.connectionId, 'camera', setup.camera.deviceId),
						setup.guideOutput && findDevice(this, setup.guideOutput.connectionId, 'guideOutput', setup.guideOutput.deviceId),
						setup.focuser && findDevice(this, setup.focuser.connectionId, 'focuser', setup.focuser.deviceId),
					].filter((device) => device !== undefined),
				]
				const extended = reservation.extend(devices.map((device) => ({ key: resourceKey(device), device })))

				if (!extended.ok) {
					fail('failed', 'busy', `Another operation holds ${extended.conflicts.map((conflict) => conflict.ownerKind).join(', ')}`)
				} else {
					const decision = this.#decide(session.execution.connectionId, session.execution.deviceId, mount, request, session.execution.trigger === 'manual' ? 'manual' : 'scheduled', session.execution.contextId)
					const serviced = decision.decision === 'refuse' && decision.code === 'alreadyServiced'
					if (decision.decision !== 'eligible' && !serviced) fail('failed', decision.code, decision.reason)
				}

				this.#stepEnd(session, outcomeOf.failure ? 'failed' : 'done')
			}

			const jnow = () => equatorialFromJ2000(session.execution.target.rightAscension, session.execution.target.declination, timeUnix(this.options.now() / 1000, true))

			if (!outcomeOf.failure) {
				const [rightAscension, declination] = jnow()
				if (angularDistance(rightAscension, declination, mount.equatorialCoordinate.rightAscension, mount.equatorialCoordinate.declination) > TARGET_TOLERANCE) fail('failed', 'staleContext', `${mount.name} no longer points at the target of the flip`)
			}

			// Takes a plate solution of the target before the flip, when the pier side cannot verify it.
			let reference: WcsMeasurement | undefined
			const inference = session.execution.verificationMode === 'inference'

			if (!outcomeOf.failure && inference && setup.camera && request.centering) {
				this.#step(session, 'referenceSolve')
				const measured = await this.#center(session, 'verifyOnly', invocation)
				reference = measured.measurement
				this.#stepEnd(session, reference ? 'done' : 'failed', reference ? undefined : 'No plate solution before the flip; the flip cannot be inferred')
			}

			// Flips the mount.
			if (!outcomeOf.failure && !signal.aborted) {
				this.#step(session, 'flipping')
				const [rightAscension, declination] = jnow()
				const admitted = this.services.mounts.admitMeridianFlip(session.execution.connectionId, session.execution.deviceId, { token: `${session.execution.sessionId}:flip`, target: { rightAscension, declination }, observer: observerOf(mount), strategy: session.execution.strategy }, invocation)

				if (!admitted.ok) {
					fail('failed', admitted.code === 'busy' ? 'busy' : 'notEligible', admitted.error)
					this.#stepEnd(session, 'failed', admitted.error)
				} else {
					dispatched = true
					const result = await admitted.result

					if (!result.ok) {
						// The motion ended in a state nothing established; the mount needs the operator's eyes.
						const stuck = mount.connected && !isDeviceQuiescent(mount)
						fail(stuck ? 'blocked' : 'failed', 'unknownResult', result.error ?? result.reason)
						this.#stepEnd(session, 'failed', result.error ?? result.reason)
					} else {
						execution = result.value
						this.#update(session, { execution })
						if (execution.outcome === 'noFlipEvidence') fail('failed', 'noFlipEvidence', `${mount.name} neither moved nor changed sides; nothing was flipped and nothing is retried`)
						this.#stepEnd(session, execution.outcome === 'moved' ? 'done' : 'failed')
					}
				}
			}

			// Lets the mount settle, then measures and classifies the evidence.
			if (!outcomeOf.failure && execution) {
				this.#step(session, 'settling')
				await abortable(Bun.sleep(Math.max(0, policy.mountSettleSeconds) * 1000), signal)
				this.#stepEnd(session, 'done')

				let measurement: WcsMeasurement | undefined

				if (!signal.aborted && inference && reference && setup.camera && request.centering) {
					this.#step(session, 'measuring')
					const measured = await this.#center(session, 'verifyOnly', invocation)
					measurement = measured.measurement
					targetPositionConfirmed = measured.positionVerified
					this.#stepEnd(session, measurement ? 'done' : 'failed')
				}

				this.#step(session, 'verifying')
				wcs = inference ? compareWcs(reference, measurement) : undefined
				verification = classifyFlip(execution, wcs ?? { status: 'missing' }, targetPositionConfirmed)
				const accepted = acceptsVerification(verification, policy)
				this.#stepEnd(session, accepted ? 'done' : 'failed', `The flip is ${verification}`)

				if (!accepted) fail('failed', verification === 'unverified' ? 'noFlipEvidence' : 'notReady', verification === 'unverified' ? 'The flip could not be established; imaging stays paused' : 'The flip was inferred, which the policy does not accept for imaging to go on by itself')
			}

			// Recenters and refocuses, only once the flip is accepted.
			if (!outcomeOf.failure && !signal.aborted && policy.recenterAfterFlip && setup.camera && request.centering) {
				this.#step(session, 'recentering')
				const centered = await this.#center(session, 'recenter', invocation)
				targetPositionConfirmed = centered.positionVerified
				recentering = centered.positionVerified ? 'completed' : 'failed'
				this.#stepEnd(session, centered.positionVerified ? 'done' : 'failed', centered.error)
				if (!centered.positionVerified) fail('failed', 'notReady', centered.error ?? 'The target could not be centered again')
			}

			if (!outcomeOf.failure && !signal.aborted && policy.autofocusAfterFlip && setup.camera && setup.focuser && request.autoFocus) {
				this.#step(session, 'autofocusing')
				const focused = await this.#focus(session, invocation)
				autofocus = focused ? 'completed' : 'failed'
				this.#stepEnd(session, focused ? 'done' : 'failed')
				if (!focused) fail('failed', 'notReady', 'Auto Focus did not complete')
			}
		} finally {
			// Gives back what the execution took, whatever happened: its operations end first, so nothing of it still holds a
			// device, then the camera goes back to the capture, guiding is restored, and the capture goes on only when ready.
			await this.operations.coordinator.cancelByReservationOwner(owner)
			const cancelled = signal.aborted
			if (cancelled) fail('cancelled', 'cancelled', 'The execution was cancelled')

			const ready = outcomeOf.failure === undefined
			// Guiding is restored when imaging is ready, or when nothing moved; after an uncertain motion it is left suspended.
			const restoreGuiding = ready || !dispatched
			let guidingRestoration: MeridianFlipOutcome['guidingRestoration'] = suspensions.length === 0 ? 'notNeeded' : 'failed'
			let captureRestoration: MeridianFlipOutcome['captureRestoration'] = captureSessionId === undefined ? 'notNeeded' : 'leftSuspended'

			const reclaimed = capture?.reclaim()
			if (reclaimed === 'ended') captureRestoration = 'externallyChanged'

			if (suspensions.length > 0) {
				if (restoreGuiding) {
					this.#step(session, 'restoringGuiding')
					const restoration = new AbortController()
					const results = await Promise.all(suspensions.map((suspension) => this.services.guiding.restoreAfterMotion(suspension, restoration.signal)))
					guidingRestoration = results.includes('externallyChanged') ? 'externallyChanged' : results.includes('failed') ? 'failed' : 'restored'
					this.#stepEnd(session, guidingRestoration === 'restored' ? 'done' : 'failed')
					if (guidingRestoration !== 'restored' && !outcomeOf.failure) fail('failed', guidingRestoration === 'externallyChanged' ? 'externalChange' : 'notReady', 'Guiding could not be restored')
				} else {
					guidingRestoration = 'failed'
				}
			}

			hold?.[Symbol.dispose]()

			if (capture && reclaimed !== 'ended') {
				this.#step(session, 'resumingCapture')
				// Imaging goes on when everything succeeded, or when nothing moved and guiding is as the capture left it.
				const guidingKept = guidingRestoration === 'restored' || guidingRestoration === 'notNeeded'
				const resume = guidingKept && (outcomeOf.failure === undefined || !dispatched)
				const answer = resume ? capture.resume() : capture.release()
				captureRestoration = answer === 'resumed' ? 'resumed' : answer === 'ended' ? 'externallyChanged' : 'leftSuspended'
				this.#stepEnd(session, captureRestoration === 'resumed' ? 'done' : 'skipped', captureRestoration === 'leftSuspended' ? 'The capture stays paused for the operator' : undefined)
			}

			reservation.release()

			const outcome: MeridianFlipOutcome = {
				executionStrategy: session.execution.strategy,
				verification,
				flipCommandCompleted: execution !== undefined,
				movementObserved: execution?.movementObserved ?? false,
				pierSideBefore: execution && execution.initial.pierSide !== 'NEITHER' ? execution.initial.pierSide : undefined,
				pierSideAfter: execution && execution.final.pierSide !== 'NEITHER' ? execution.final.pierSide : undefined,
				targetPositionConfirmed,
				wcs,
				recentering,
				autofocus,
				guidingRestoration,
				captureRestoration,
				readyForImaging: outcomeOf.failure === undefined ? 'ready' : 'notReady',
			}

			const failure = outcomeOf.failure
			if (failure === undefined) this.#end(session, 'completed', { outcome })
			else this.#end(session, failure.state, { outcome, code: failure.code, error: failure.error })
		}
	}

	// Runs one Target Centering session of the frozen target under the reservation and waits for its end. Resolves the first
	// solution it took, as the WCS of the field, whether a solution after its last motion lies within tolerance, and why not.
	async #center(session: Session, mode: 'verifyOnly' | 'recenter', invocation: { readonly reservation: ResourceReservation }): Promise<{ readonly measurement?: WcsMeasurement; readonly positionVerified: boolean; readonly error?: string }> {
		const { setup, centering } = session.request
		if (!setup.camera || !centering) return { positionVerified: false, error: 'No camera or Target Centering settings' }

		const { target, sessionId } = session.execution
		const token = `${sessionId}:${mode}:${session.execution.steps.length}`
		const rotatorBefore = this.#rotator(setup)
		const admitted = await this.services.targetCentering.admit(
			setup.camera.connectionId,
			setup.camera.deviceId,
			{ ...centering, token, mount: { connectionId: session.execution.connectionId, deviceId: session.execution.deviceId }, guideOutput: setup.guideOutput, mode, target: { frame: 'J2000', rightAscension: target.rightAscension, declination: target.declination, label: target.label }, guiding: 'requireIdle' },
			invocation,
		)
		if (!admitted.ok) return { positionVerified: false, error: admitted.error }

		session.tool = { interrupt: () => this.services.targetCentering.interrupt(admitted.sessionId) }
		if (session.controller.signal.aborted) session.tool.interrupt()
		const ended: TargetCenteringSessionSummary = await admitted.ended
		session.tool = undefined

		const solutions = this.services.targetCentering.solutionsOf(admitted.sessionId)
		const first = ended.attempts.find((attempt) => attempt.outcome === 'solved' && solutions?.has(attempt.attempt))
		const solution = first && solutions?.get(first.attempt)
		const rotatorAfter = this.#rotator(setup)
		const measurement = solution && { orientation: solution.orientation, parity: solution.parity, rotatorAngle: rotatorAfter?.angle, rotatorMoving: (rotatorBefore?.moving ?? false) || (rotatorAfter?.moving ?? false) || rotatorBefore?.angle !== rotatorAfter?.angle }
		return { measurement, positionVerified: ended.positionVerified, error: ended.error ?? ended.reason }
	}

	// Runs Auto Focus under the reservation and resolves whether it completed.
	async #focus(session: Session, invocation: { readonly reservation: ResourceReservation }) {
		const { setup, autoFocus } = session.request
		if (!setup.camera || !setup.focuser || !autoFocus) return false

		const admitted = await this.services.autoFocus.admit(setup.camera.connectionId, setup.camera.deviceId, { ...autoFocus, token: `${session.execution.sessionId}:autofocus`, focuser: setup.focuser }, invocation)
		if (!admitted.ok) return false

		session.tool = { interrupt: () => this.services.autoFocus.interrupt(admitted.sessionId) }
		if (session.controller.signal.aborted) session.tool.interrupt()
		const ended = await admitted.ended
		session.tool = undefined
		return ended.state === 'completed'
	}

	// Angle in degrees and motion of the setup's rotator, when it has one.
	#rotator(setup: MeridianFlipSetup) {
		const rotator = setup.rotator && findDevice(this, setup.rotator.connectionId, 'rotator', setup.rotator.deviceId)
		return rotator && { angle: rotator.angle.value, moving: rotator.moving }
	}

	// Cancels an execution once.
	#cancel(session: Session) {
		if (session.execution.endedAt !== undefined || session.controller.signal.aborted) return
		session.controller.abort()
		session.tool?.interrupt()
		void this.operations.coordinator.cancelByReservationOwner({ id: session.execution.sessionId, kind: 'mount.meridianFlipExecutor' })
	}

	// Starts a step.
	#step(session: Session, step: MeridianFlipStep) {
		this.#update(session, { step, steps: [...session.execution.steps, { step, outcome: 'running', startedAt: this.options.now() }] })
	}

	// Ends the running step.
	#stepEnd(session: Session, outcome: Exclude<MeridianFlipStepOutcome, 'running'>, detail?: string) {
		const steps = session.execution.steps
		const last = steps.at(-1)
		if (!last || last.outcome !== 'running') return
		this.#update(session, { steps: [...steps.slice(0, -1), { ...last, outcome, endedAt: this.options.now(), detail }] })
	}

	// Ends an execution once.
	#end(session: Session, state: Exclude<MeridianFlipExecutionState, 'running'>, patch: Partial<MeridianFlipExecution>) {
		if (session.execution.endedAt !== undefined) return
		this.#update(session, { ...patch, state, step: undefined, endedAt: this.options.now() })
		if (this.#active.get(session.key) === session) this.#active.delete(session.key)
		session.ended.resolve(session.execution)
	}

	// Publishes a changed execution.
	#update(session: Session, patch: Partial<MeridianFlipExecution>) {
		this.#revision++
		session.execution = { ...session.execution, ...patch, revision: session.execution.revision + 1 }
		this.publish({ type: 'meridianFlipExecutor:updated', epoch: this.#epoch, revision: this.#revision, execution: session.execution })
	}

	// Forgets the oldest ended executions beyond the history.
	#trim() {
		for (const [id, session] of this.#executions) {
			if (this.#executions.size <= EXECUTION_HISTORY) break
			if (session.execution.endedAt !== undefined) this.#executions.delete(id)
		}
	}

	// Forgets the passages whose memory expired.
	#forgetPassages() {
		const now = this.options.now()
		for (const [passage, until] of this.#passages) if (until <= now) this.#passages.delete(passage)
	}
}

// Resolves once promise settles or signal aborts, whichever comes first.
async function abortable(promise: Promise<unknown>, signal: AbortSignal) {
	if (signal.aborted) return
	const aborted = Promise.withResolvers<void>()
	const onAbort = () => aborted.resolve()
	signal.addEventListener('abort', onAbort, { once: true })

	try {
		await Promise.race([promise, aborted.promise])
	} finally {
		signal.removeEventListener('abort', onAbort)
	}
}

// Routes of the Meridian Flip Executor.
export function createMeridianFlipExecutorRoutes(executor: MeridianFlipExecutor) {
	return {
		'/api/meridian-flip/executions': {
			// Running and recent executions and the arms; their changes arrive as meridianFlipExecutor events.
			GET: () => Response.json(executor.snapshot()),
		},
		'/api/meridian-flip/executions/:sessionId': {
			// One execution, with its steps, evidence, and outcome.
			GET: (req) => executor.execution(req.params.sessionId),
		},
		'/api/meridian-flip/executions/:sessionId/cancel': {
			// Cancels exactly this execution.
			POST: (req) => executor.cancel(req.params.sessionId),
		},
		'/api/connections/:id/mounts/:deviceId/meridian-flip/execute': {
			// Flips now, or once eligible.
			POST: async (req) => executor.execute(req.params.id, req.params.deviceId, (await req.json()) as MeridianFlipExecuteRequest),
		},
		'/api/connections/:id/mounts/:deviceId/meridian-flip/arm': {
			// Arms the automatic flip of the mount.
			POST: async (req) => executor.arm(req.params.id, req.params.deviceId, (await req.json()) as MeridianFlipExecutionRequest),
		},
		'/api/connections/:id/mounts/:deviceId/meridian-flip/disarm': {
			// Removes the arm of the mount; commands nothing.
			POST: (req) => executor.disarm(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/mounts/:deviceId/meridian-flip/eligibility': {
			// What would be decided for a request now; starts nothing.
			POST: async (req) => executor.eligibility(req.params.id, req.params.deviceId, (await req.json()) as MeridianFlipExecutionRequest & { readonly trigger?: FlipTrigger }),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
