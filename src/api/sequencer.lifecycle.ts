import { isCamera, isCover, isMount } from 'nebulosa/src/devices/indi/device'
import type { Camera, Device } from 'nebulosa/src/devices/indi/device'
import { successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { SequencerDeviceRole, SequencerLifecycleAction } from '#/sequencer'
import type { CameraCommander } from './camera.commander'
import type { CoverCommander } from './cover.commander'
import type { GuiderCommander } from './guider.session'
import { connect } from './indi'
import type { MountCommander } from './mount.commander'
import { abortableDelay } from './operation.wait'
import { sequencerActionFailure, sequencerDeviceOf, sequencerMissingRole } from './sequencer.action'
import { SEQUENCER_LIFECYCLE_BLOCK_PREFIX } from './sequencer.compiler'
import type { SequencerLifecycle } from './sequencer.compiler'
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

// Milliseconds between two samples of the connection state of a device being connected.
//
// A driver publishes `CONNECTION` as soon as it is up, and the handler holds a device reference rather than a
// subscription, so the transition is sampled. A connection takes a second at best, which this interval is well
// below.
const SEQUENCER_CONNECT_SAMPLE = 250

// Milliseconds between two setpoint updates of a controlled thermal ramp. The cooler of an astronomical camera
// moves at a few degrees per minute, so a five-second step is fine enough to shape the ramp and coarse enough
// not to flood the driver with property writes.
const SEQUENCER_RAMP_STEP = 5000

// Milliseconds in one minute, which is the unit the declared ramp rate is expressed per.
const SEQUENCER_MINUTE = 60000

// What one lifecycle action did.
export interface SequencerLifecycleOutcome {
	// Declared action type, so a report says which reconciliation this was without reading the node id.
	readonly action: SequencerLifecycleAction['type']
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
// compilation did not require the definition to declare. `connectDevices` is absent because the roles it
// commands are named by the action itself, and the guiding actions are absent because they command the guiding
// session rather than a device of the session.
const SEQUENCER_LIFECYCLE_ROLE: Partial<Record<SequencerLifecycleAction['type'], SequencerDeviceRole>> = {
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
// The dome actions and the `switch` action are absent on purpose: the compiler refuses a definition that asks
// for them rather than letting them silently do nothing, and registering a handler here would take that refusal
// away. `custom` is absent for the opposite reason — it addresses a handler the host registers by name, and the
// registry is where that handler arrives.
const SEQUENCER_LIFECYCLE_RUNNER: Partial<Record<SequencerLifecycleAction['type'], SequencerLifecycleRunner>> = {
	connectDevices: runConnectDevices,
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
export function sequencerLifecycleHandlers(services: SequencerLifecycleServices): readonly SequencerActionHandler<SequencerLifecycle, SequencerLifecycleOutcome>[] {
	const handlers: SequencerActionHandler<SequencerLifecycle, SequencerLifecycleOutcome>[] = []

	for (const [type, run] of Object.entries(SEQUENCER_LIFECYCLE_RUNNER) as [SequencerLifecycleAction['type'], SequencerLifecycleRunner][]) {
		handlers.push({
			type: `${SEQUENCER_LIFECYCLE_BLOCK_PREFIX}${type}`,
			version: SEQUENCER_LIFECYCLE_VERSION,
			validate: (configuration): SequencerValidationResult<SequencerLifecycle> => ({ ok: true, configuration: configuration as SequencerLifecycle }),
			resources: (configuration) => resourcesOf(type, configuration),
			execute: (context, configuration) => run(services, context, configuration),
		})
	}

	return handlers
}

// Roles one lifecycle action needs reserved.
//
// The roles `connectDevices` names are optional bindings: the action exists to bring up whatever the session
// carries, and a role the definition did not declare is simply not part of it. Every other action binds the one
// role of the map, and does so as a required binding, because an action commanding a device the session does not
// have is a definition the compiler already refused.
function resourcesOf(type: SequencerLifecycleAction['type'], configuration: SequencerLifecycle): readonly ResourceBinding[] {
	if (configuration.action.type === 'connectDevices') return configuration.action.devices.map((role) => ({ role, optional: true }))

	const role = SEQUENCER_LIFECYCLE_ROLE[type]

	return role === undefined ? [] : [{ role }]
}

// Connects every declared role that is not connected yet, and returns once all of them report the connection.
//
// The INDI connection command is a property write with no completion of its own, so the transition is observed
// on the device. A role the session does not carry is skipped rather than failed: the action names the roles the
// definition wants brought up, and one it never declared is not a device that failed to connect.
//
// The deadline of the action is the only bound on the wait, which is what a driver that never answers runs into.
async function runConnectDevices(_services: SequencerLifecycleServices, context: SequencerActionContext, configuration: SequencerLifecycle): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	if (configuration.action.type !== 'connectDevices') return { type: 'fatalFailure', reason: 'unexpectedState', detail: 'the node does not carry a device connection action' }

	const pending: Device[] = []

	for (const role of configuration.action.devices) {
		const device = context.request(role)?.device

		if (device === undefined || device.connected) continue

		context.progress({ detail: `connecting the ${role}` })
		connect(device)
		pending.push(device)
	}

	if (pending.length === 0) return { type: 'completed', value: { action: 'connectDevices', commanded: false } }

	while (pending.some((device) => !device.connected)) {
		const waited = await abortableDelay(SEQUENCER_CONNECT_SAMPLE, context.signal)

		if (!waited.ok) return sequencerActionFailure(waited, 'the devices did not report the connection')
	}

	return { type: 'completed', value: { action: 'connectDevices', commanded: true } }
}

// Parks or unparks the mount, or reports that it is already where the action wants it.
async function runMountPark(services: SequencerLifecycleServices, context: SequencerActionContext, configuration: SequencerLifecycle, park: boolean): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const action = park ? 'parkMount' : 'unparkMount'
	const mount = sequencerDeviceOf(context, 'mount', isMount)

	if (mount === undefined) return sequencerMissingRole('mount')
	if (mount.parked === park) return { type: 'completed', value: { action, commanded: false } }

	context.progress({ detail: park ? 'parking the mount' : 'unparking the mount' })

	const timeout = timeoutOf(configuration.timeout)
	const commanded = park ? await services.mountCommander.park(context.scope, mount, { timeout }) : await services.mountCommander.unpark(context.scope, mount, { timeout })

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

		const selected = await services.mountCommander.setTrackMode(context.scope, mount, mode)

		if (!selected.ok) return sequencerActionFailure(selected, `the mount did not accept the ${mode} track mode`)
	}

	if (mount.tracking) return { type: 'completed', value: { action: 'startTracking', commanded: mode !== undefined } }

	context.progress({ detail: 'starting tracking' })

	const tracked = await services.mountCommander.setTracking(context.scope, mount, true)

	if (!tracked.ok) return sequencerActionFailure(tracked, 'the mount did not start tracking')

	return { type: 'completed', value: { action: 'startTracking', commanded: true } }
}

// Stops the tracking of the mount, or reports that it was already stopped.
async function runStopTracking(services: SequencerLifecycleServices, context: SequencerActionContext): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const mount = sequencerDeviceOf(context, 'mount', isMount)

	if (mount === undefined) return sequencerMissingRole('mount')
	if (!mount.tracking) return { type: 'completed', value: { action: 'stopTracking', commanded: false } }

	context.progress({ detail: 'stopping tracking' })

	const tracked = await services.mountCommander.setTracking(context.scope, mount, false)

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
	const moved = close ? await services.coverCommander.park(context.scope, cover, { timeout }) : await services.coverCommander.unpark(context.scope, cover, { timeout })

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

		const enabled = await services.cameraCommander.cooler(context.scope, camera, true)

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

		const disabled = await services.cameraCommander.cooler(context.scope, camera, false)

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

		const commanded = await services.cameraCommander.temperature(context.scope, camera, target)

		return commanded.ok ? successfulOperationResult(true) : commanded
	}

	let setpoint = camera.temperature

	if (setpoint === target) return successfulOperationResult(false)

	context.progress({ detail: `ramping the sensor setpoint to ${target} °C` })

	while (setpoint !== target) {
		setpoint = setpoint < target ? Math.min(target, setpoint + step) : Math.max(target, setpoint - step)

		const commanded = await services.cameraCommander.temperature(context.scope, camera, setpoint)

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
async function runStartGuiding(services: SequencerLifecycleServices, context: SequencerActionContext): Promise<SequencerActionResult<SequencerLifecycleOutcome>> {
	const { guider } = context

	if (guider === undefined) return { type: 'skipped', detail: 'the session guides through no guider' }
	if (services.guiderCommander.running(guider)) return { type: 'completed', value: { action: 'startGuiding', commanded: false } }

	context.progress({ detail: 'starting the guiding corrections' })

	const guided = await services.guiderCommander.startGuiding(guider, { signal: context.signal })

	if (!guided.ok) return sequencerActionFailure(guided, 'the guider did not start guiding')

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
