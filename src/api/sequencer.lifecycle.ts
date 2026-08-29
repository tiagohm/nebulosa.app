import { isCamera, isCover, isMount } from 'nebulosa/src/devices/indi/device'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import type { GuiderLoopStart } from '#/guider'
import { successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { SequencerDeviceRole, SequencerLifecycleActionType } from '#/sequencer'
import type { CameraCommander } from './camera.commander'
import type { CoverCommander } from './cover.commander'
import type { GuiderCommander } from './guider.session'
import type { MountCommander } from './mount.commander'
import { abortableDelay } from './operation.wait'
import { sequencerActionFailure, sequencerCommand, sequencerDeviceOf, sequencerMissingRole } from './sequencer.action'
import { SEQUENCER_LIFECYCLE_BLOCK_PREFIX } from './sequencer.compiler'
import type { SequencerLifecycle } from './sequencer.compiler'
import { sequencerGuiderSettle } from './sequencer.guiding'
import type { ResourceBinding, SequencerActionContext, SequencerActionHandler, SequencerActionResult, SequencerValidationResult } from './sequencer.registry'

// The blocks of the two lifecycle pipelines: what the startup pipeline commands before the first safe point
// and what the finalization pipeline commands after the last one.
//
// A lifecycle action is a single reconciliation of one device with the state the pipeline wants it in, and it
// is always expressed as a difference: a mount already unparked is not unparked again, a cover already open is
// not opened, a camera whose cooler is already on is not switched on. That is what makes a pipeline idempotent,
// which matters because a session resumed after a crash re-enters the pipeline it was in the middle of.
//
// None of these blocks decides its own timeout, retry or requiredness. Those live in `SequencerLifecycle` and
// are applied by `runSequencerPipeline`, which owns the ordering and the failure policy; a handler here only
// commands and reports. In particular the deadline arrives as `context.signal`, so a handler waits on it
// instead of measuring a clock of its own.
//
// No lifecycle action commands anything under a cancellation. The cancellation is the session leaving the plan
// — for the startup pipeline a stop, for the finalization pipeline the shutdown of the process, since a stop is
// what makes that pipeline run — and every device command of this module goes through `sequencerCommand`, which
// is what makes the rule hold between two commands of the same action and not only in front of the first one.
// A lifecycle action has nothing to undo when it is cut in half: it is a reconciliation against the state the
// device is in, so the next run of the same action starts from wherever the cancellation left it.
//
// The cooler actions are the one place a lifecycle block reads a policy it did not declare: `coolCamera` and
// `warmCamera` carry no setpoint, because `SequencerCooling` is the single authority for the thermal targets,
// and the compiler travels that policy on the node. They command the setpoint and never wait for the sensor to
// reach it — the wait belongs to the frame preparation, which is where the frame that requires the temperature
// is about to be exposed — except for the ramp, which is a sequence of setpoints and therefore is the command.
//
// Temperatures are degrees Celsius and ramps degrees Celsius per minute; declared timeouts are seconds while
// every duration handed to a commander is milliseconds.

// Handler version of every lifecycle block. It changes whenever the meaning of the configuration or of the
// execution changes, which refuses a session compiled against the older meaning instead of running it here.
const SEQUENCER_LIFECYCLE_VERSION = 1

// Milliseconds between two setpoint updates of a controlled thermal ramp. The cooler of an astronomical camera
// moves at a few degrees per minute, so a five-second step is fine enough to shape the ramp and coarse enough
// not to flood the driver with property writes.
const SEQUENCER_RAMP_STEP = 5000

// Milliseconds in one minute, which is the unit the declared ramp rate is expressed per.
const SEQUENCER_MINUTE = 60000

// Answer of a lifecycle action entered under a cancellation, which is a device this pipeline never touched.
//
// It is fatal because there is nothing to retry against: the cancellation is the session leaving the plan, and
// the pipeline attributes an `aborted` it commanded to the stop that caused it rather than to the equipment.
const SEQUENCER_LIFECYCLE_CANCELLED: SequencerActionResult<SequencerLifecycleOutcome> = { type: 'fatalFailure', reason: 'aborted', detail: 'the action was cancelled before it commanded anything' }

// What one lifecycle action did.
export interface SequencerLifecycleOutcome {
	// Declared action type, so a report says which reconciliation this was without reading the node id.
	readonly action: SequencerLifecycleActionType
	// Whether anything was actually commanded. A device already in the required state reports false, which is
	// the ordinary case of a resumed pipeline.
	readonly commanded: boolean
	// Temperature the thermal actions left the setpoint at, absent for every other action.
	readonly temperature?: number
}

// Collaborators the lifecycle blocks command, one per device family a lifecycle action can touch.
export interface SequencerLifecycleServices {
	// Owner of every mount movement, of the park state and of the tracking.
	readonly mountCommander: MountCommander
	// Owner of the cover.
	readonly coverCommander: CoverCommander
	// Owner of the cooler and of the sensor setpoint.
	readonly cameraCommander: CameraCommander
	// Owner of every guiding session, including the one the sequencer opened.
	readonly guiderCommander: GuiderCommander
}

// Role each lifecycle action commands, or undefined when the action commands no device of the definition.
//
// It mirrors the map the compiler checks the definition against, so a block never asks for a role the
// compilation did not require the definition to declare. The guiding actions are absent because they command
// the guiding session rather than a device of the session.
const SEQUENCER_LIFECYCLE_ROLE: Partial<Record<SequencerLifecycleActionType, SequencerDeviceRole>> = {
	unparkMount: 'mount',
	parkMount: 'mount',
	startTracking: 'mount',
	stopTracking: 'mount',
	openCover: 'cover',
	closeCover: 'cover',
	coolCamera: 'camera',
	warmCamera: 'camera',
}

// Executes one lifecycle action against the devices the session reserved.
type SequencerLifecycleRunner = (services: SequencerLifecycleServices, context: SequencerActionContext, configuration: SequencerLifecycle) => Promise<SequencerActionResult<SequencerLifecycleOutcome>>

// Every lifecycle action this version executes, mapped to what it commands.
//
// The dome actions are absent on purpose: the compiler refuses a definition that enables the dome rather than
// letting those steps silently do nothing, and registering a handler here would take that refusal away.
const SEQUENCER_LIFECYCLE_RUNNER: Partial<Record<SequencerLifecycleActionType, SequencerLifecycleRunner>> = {
	unparkMount: (services, context, configuration) => runMountPark(services, context, configuration, false),
	parkMount: (services, context, configuration) => runMountPark(services, context, configuration, true),
	startTracking: runStartTracking,
	stopTracking: runStopTracking,
	openCover: (services, context, configuration) => runCover(services, context, configuration, false),
	closeCover: (services, context, configuration) => runCover(services, context, configuration, true),
	coolCamera: runCoolCamera,
	warmCamera: runWarmCamera,
	startGuiding: runStartGuiding,
	stopGuiding: runStopGuiding,
}

// Handlers of every lifecycle action this version executes, ready to be registered.
//
// They are produced together because they share one set of collaborators and because the set they cover is
// exactly the set the compiler accepts: registering them one by one would let a definition compile against an
// action nobody registered, which the compilation check would then refuse at session start instead of at edit
// time.
//
// The cancellation is answered here, in front of every runner, so the rule holds for an action added later
// whether or not it remembers to consult the signal itself. The runners still front their own commands, which
// is the half of the rule this seam cannot cover: a cancellation that lands between two commands of the same
// action arrives after this decision was taken.
export function sequencerLifecycleHandlers(services: SequencerLifecycleServices): readonly SequencerActionHandler<SequencerLifecycle, SequencerLifecycleOutcome>[] {
	const handlers: SequencerActionHandler<SequencerLifecycle, SequencerLifecycleOutcome>[] = []

	for (const [type, run] of Object.entries(SEQUENCER_LIFECYCLE_RUNNER) as [SequencerLifecycleActionType, SequencerLifecycleRunner][]) {
		handlers.push({
			type: `${SEQUENCER_LIFECYCLE_BLOCK_PREFIX}${type}`,
			version: SEQUENCER_LIFECYCLE_VERSION,
			validate: (configuration): SequencerValidationResult<SequencerLifecycle> => ({ ok: true, configuration: configuration as SequencerLifecycle }),
			resources: () => resourcesOf(type),
			execute: (context, configuration) => (context.signal.aborted ? Promise.resolve(SEQUENCER_LIFECYCLE_CANCELLED) : run(services, context, configuration)),
		})
	}

	return handlers
}

// Roles one lifecycle action needs reserved.
//
// Every action binds the one role of the map as a required binding, because an action commanding a device the
// session does not have is a definition the compiler already refused.
function resourcesOf(type: SequencerLifecycleActionType): readonly ResourceBinding[] {
	const role = SEQUENCER_LIFECYCLE_ROLE[type]

	return role === undefined ? [] : [{ role }]
}

// Parks or unparks the mount, or reports that it is already where the action wants it.
async function runMountPark(services: SequencerLifecycleServices, context: SequencerActionContext, configuration: SequencerLifecycle, park: boolean): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const action = park ? 'parkMount' : 'unparkMount'
	const mount = sequencerDeviceOf(context, 'mount', isMount)

	if (mount === undefined) return sequencerMissingRole('mount')
	if (mount.parked === park) return { type: 'completed', value: { action, commanded: false } }

	context.progress({ detail: park ? 'parking the mount' : 'unparking the mount' })

	const timeout = timeoutOf(configuration.timeout)
	const commanded = await sequencerCommand(context, () => (park ? services.mountCommander.park(context.scope, mount, { timeout }) : services.mountCommander.unpark(context.scope, mount, { timeout })))

	if (!commanded.ok) return sequencerActionFailure(commanded, park ? 'the mount did not park' : 'the mount did not unpark')

	return { type: 'completed', value: { action, commanded: true } }
}

// Establishes the tracking of the target: the declared mode first, then the motion.
//
// The mode is reconciled on its own, because a mount that is already tracking is not evidence that it is
// tracking the declared target — the rate it kept is whatever the last slew of any program selected, and it
// survives the tracking being left on.
async function runStartTracking(services: SequencerLifecycleServices, context: SequencerActionContext, configuration: SequencerLifecycle): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const mount = sequencerDeviceOf(context, 'mount', isMount)

	if (mount === undefined) return sequencerMissingRole('mount')

	const mode = configuration.tracking !== undefined && mount.trackMode !== configuration.tracking.mode ? configuration.tracking.mode : undefined

	if (mode !== undefined) {
		context.progress({ detail: `selecting the ${mode} track mode` })

		const selected = await sequencerCommand(context, () => services.mountCommander.setTrackMode(context.scope, mount, mode))

		if (!selected.ok) return sequencerActionFailure(selected, `the mount did not accept the ${mode} track mode`)
	}

	if (mount.tracking) return { type: 'completed', value: { action: 'startTracking', commanded: mode !== undefined } }

	context.progress({ detail: 'starting tracking' })

	const tracked = await sequencerCommand(context, () => services.mountCommander.setTracking(context.scope, mount, true))

	if (!tracked.ok) return sequencerActionFailure(tracked, 'the mount did not start tracking')

	return { type: 'completed', value: { action: 'startTracking', commanded: true } }
}

// Stops the tracking of the mount, or reports that it was already stopped.
async function runStopTracking(services: SequencerLifecycleServices, context: SequencerActionContext): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const mount = sequencerDeviceOf(context, 'mount', isMount)

	if (mount === undefined) return sequencerMissingRole('mount')
	if (!mount.tracking) return { type: 'completed', value: { action: 'stopTracking', commanded: false } }

	context.progress({ detail: 'stopping tracking' })

	const tracked = await sequencerCommand(context, () => services.mountCommander.setTracking(context.scope, mount, false))

	if (!tracked.ok) return sequencerActionFailure(tracked, 'the mount did not stop tracking')

	return { type: 'completed', value: { action: 'stopTracking', commanded: true } }
}

// Opens or closes the cover, or reports that it is already where the action wants it.
async function runCover(services: SequencerLifecycleServices, context: SequencerActionContext, configuration: SequencerLifecycle, close: boolean): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const action = close ? 'closeCover' : 'openCover'
	const cover = sequencerDeviceOf(context, 'cover', isCover)

	if (cover === undefined) return sequencerMissingRole('cover')
	if (cover.parked === close) return { type: 'completed', value: { action, commanded: false } }

	context.progress({ detail: close ? 'closing the cover' : 'opening the cover' })

	const timeout = timeoutOf(configuration.timeout)
	const moved = await sequencerCommand(context, () => (close ? services.coverCommander.park(context.scope, cover, { timeout }) : services.coverCommander.unpark(context.scope, cover, { timeout })))

	if (!moved.ok) return sequencerActionFailure(moved, close ? 'the cover did not close' : 'the cover did not open')

	return { type: 'completed', value: { action, commanded: true } }
}

// Switches the cooler on and drives the setpoint to the declared capture temperature.
//
// It never waits for the sensor to reach it. The wait is the frame preparation's, which is where the frame that
// requires the temperature is about to be exposed and where the declared tolerance and timeout are applied; a
// startup that waited here as well would pay the whole cooling twice.
async function runCoolCamera(services: SequencerLifecycleServices, context: SequencerActionContext, configuration: SequencerLifecycle): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const camera = sequencerDeviceOf(context, 'camera', isCamera)

	if (camera === undefined) return sequencerMissingRole('camera')

	// A camera without a cooler has no setpoint to command, and the definition declaring the action for one is a
	// configuration mistake no retry repairs.
	if (!camera.hasCooler) return { type: 'skipped', detail: 'the camera has no cooler' }

	const cooling = configuration.cooling

	if (cooling === undefined) return { type: 'fatalFailure', reason: 'unexpectedState', detail: 'the node carries no thermal policy to cool against' }

	let commanded = false

	if (camera.hasCoolerControl && !camera.cooler) {
		context.progress({ detail: 'turning the cooler on' })

		const enabled = await sequencerCommand(context, () => services.cameraCommander.cooler(context.scope, camera, true))

		if (!enabled.ok) return sequencerActionFailure(enabled, 'the cooler did not turn on')

		commanded = true
	}

	const ramped = await rampSetpoint(services, context, camera, cooling.temperature, cooling.ramp)

	if (!ramped.ok) return sequencerActionFailure(ramped, 'the sensor setpoint could not be commanded')

	return { type: 'completed', value: { action: 'coolCamera', commanded: commanded || ramped.value, temperature: cooling.temperature } }
}

// Drives the setpoint to the declared warm temperature and, when the definition asks for it, switches the
// cooler off afterwards.
//
// The cooler is switched off only after the ramp, and never instead of it: cutting the power at the capture
// setpoint is exactly the thermal shock the controlled warm-up exists to avoid.
async function runWarmCamera(services: SequencerLifecycleServices, context: SequencerActionContext, configuration: SequencerLifecycle): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const camera = sequencerDeviceOf(context, 'camera', isCamera)

	if (camera === undefined) return sequencerMissingRole('camera')
	if (!camera.hasCooler) return { type: 'skipped', detail: 'the camera has no cooler' }

	const cooling = configuration.cooling

	if (cooling === undefined) return { type: 'fatalFailure', reason: 'unexpectedState', detail: 'the node carries no thermal policy to warm against' }

	const ramped = await rampSetpoint(services, context, camera, cooling.warmTemperature, cooling.warmRamp)

	if (!ramped.ok) return sequencerActionFailure(ramped, 'the sensor setpoint could not be commanded')

	let commanded = ramped.value

	if (cooling.turnCoolerOffAfterWarm && camera.hasCoolerControl && camera.cooler) {
		context.progress({ detail: 'turning the cooler off' })

		const disabled = await sequencerCommand(context, () => services.cameraCommander.cooler(context.scope, camera, false))

		if (!disabled.ok) return sequencerActionFailure(disabled, 'the cooler did not turn off')

		commanded = true
	}

	return { type: 'completed', value: { action: 'warmCamera', commanded, temperature: cooling.warmTemperature } }
}

// Drives the sensor setpoint to `target`, at most `ramp` degrees Celsius per minute.
//
// A ramp of zero, a camera that reports no temperature, and a step that would be shorter than the arithmetic
// can express all command the target in one write, which is what an uncontrolled setpoint change means. With a
// ramp, the setpoint is written repeatedly, each time one step closer to the target, starting from the
// temperature the sensor is actually at rather than from the setpoint the camera holds: the sensor is what the
// ramp limits, and a setpoint left far below it by a previous session would otherwise make the first step a
// jump.
//
// The steps are strictly monotonic toward the target and the last one lands exactly on it, so the loop is
// bounded by `|target - temperature| / step` iterations. The caller's deadline arrives as `context.signal` and
// is the only other bound.
//
// Returns whether anything was written, which is false only when the setpoint already equals the target.
async function rampSetpoint(services: SequencerLifecycleServices, context: SequencerActionContext, camera: Camera, target: number, ramp: number): Promise<OperationResult<boolean>> {
	// Degrees Celsius one step of the ramp moves the setpoint by.
	const step = (ramp * SEQUENCER_RAMP_STEP) / SEQUENCER_MINUTE

	if (ramp <= 0 || step <= 0 || !camera.hasThermometer) {
		if (camera.temperature === target) return successfulOperationResult(false)

		context.progress({ detail: `commanding the sensor setpoint to ${target} °C` })

		const commanded = await sequencerCommand(context, () => services.cameraCommander.temperature(context.scope, camera, target))

		return commanded.ok ? successfulOperationResult(true) : commanded
	}

	let setpoint = camera.temperature

	if (setpoint === target) return successfulOperationResult(false)

	context.progress({ detail: `ramping the sensor setpoint to ${target} °C` })

	while (setpoint !== target) {
		setpoint = setpoint < target ? Math.min(target, setpoint + step) : Math.max(target, setpoint - step)

		const commanded = await sequencerCommand(context, () => services.cameraCommander.temperature(context.scope, camera, setpoint))

		if (!commanded.ok) return commanded
		if (setpoint === target) break

		const waited = await abortableDelay(SEQUENCER_RAMP_STEP, context.signal)

		if (!waited.ok) return waited
	}

	return successfulOperationResult(true)
}

// Starts the guiding corrections of the session's guider, or reports that there is nothing to guide.
//
// A session guiding through no guider is a session that was configured that way, so the action is skipped
// rather than failed, exactly as the dither is.
//
// The declared settle is installed here, with the loop that precedes the guide, because the transport keeps
// it as session state and reads it back on every guide, recalibration and dither that follows. This is the
// first write of the night, so nothing else can have installed it. The guide camera already exposes under
// the configuration of the connected guider; this session does not re-own that recipe.
//
// `calibrateBeforeStart` decides which command establishes the run. The plain start reuses whatever solution
// the guider carries, which is the one it computed for the last target it guided; the flag is the declaration
// that such a solution is not to be trusted for this session, and the commander then forces a calibration and
// resolves only once the guider settled into guiding with the fresh one. It is one command and not a
// calibration followed by a start, so nothing can guide on the stale solution in between — and for the same
// reason a guider that is already guiding is not left alone when the flag is set: it is guiding on exactly
// the solution the flag exists to discard.
async function runStartGuiding(services: SequencerLifecycleServices, context: SequencerActionContext, configuration: SequencerLifecycle): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const { guider } = context

	if (guider === undefined) return { type: 'skipped', detail: 'the session guides through no guider' }

	const calibrate = configuration.guiding?.calibrateBeforeStart ?? false

	if (!calibrate && services.guiderCommander.running(guider)) return { type: 'completed', value: { action: 'startGuiding', commanded: false } }

	const guiding = configuration.guiding

	// The declared settle is installed on the guider session before it is asked to guide anything. It is session
	// state and not a command argument — the guide, the calibration and every dither of the night read it back
	// from the session — and the only command that writes it is the loop, which is why the interlock installs
	// the settle with the suspension of every safe point. The session that never loops before its first guide
	// settles under the transport defaults instead of the declared policy: a tolerance, a time and a timeout
	// nobody in this observatory chose.
	//
	// It is installed after the guider was found not to be guiding already, because a loop command is what
	// stops the corrections: paying it against a run that is already established would suspend the very guiding
	// this action exists to have.
	if (guiding !== undefined) {
		context.progress({ detail: 'looping the guide camera' })

		const request: GuiderLoopStart = { settle: sequencerGuiderSettle(guiding.settle) }
		const looping = await services.guiderCommander.loop(guider, request, { signal: context.signal })

		if (!looping.ok) return sequencerActionFailure(looping, 'the guide camera did not start looping')
	}

	context.progress({ detail: calibrate ? 'calibrating the guider' : 'starting the guiding corrections' })

	const guided = await (calibrate ? services.guiderCommander.calibrate(guider, { signal: context.signal }) : services.guiderCommander.startGuiding(guider, { signal: context.signal }))

	if (!guided.ok) return sequencerActionFailure(guided, calibrate ? 'the guider did not calibrate' : 'the guider did not start guiding')

	return { type: 'completed', value: { action: 'startGuiding', commanded: true } }
}

// Stops the guiding corrections of the session's guider, or reports that they were already stopped.
async function runStopGuiding(services: SequencerLifecycleServices, context: SequencerActionContext): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const { guider } = context

	if (guider === undefined) return { type: 'skipped', detail: 'the session guides through no guider' }
	if (!services.guiderCommander.running(guider)) return { type: 'completed', value: { action: 'stopGuiding', commanded: false } }

	context.progress({ detail: 'stopping the guiding corrections' })

	const stopped = await services.guiderCommander.stopGuiding(guider, { signal: context.signal })

	if (!stopped.ok) return sequencerActionFailure(stopped, 'the guider did not stop guiding')

	return { type: 'completed', value: { action: 'stopGuiding', commanded: true } }
}

// Declared timeout of the action in the milliseconds the commanders take, or undefined when the action declares
// none. Zero is "no deadline of its own", exactly as the pipeline reads it.
function timeoutOf(seconds: number) {
	return seconds > 0 ? seconds * 1000 : undefined
}
