import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { timeNow } from 'nebulosa/src/astronomy/time/time'
import { RAD2DEG } from 'nebulosa/src/core/constants'
import { isCamera, isMount, isWheel } from 'nebulosa/src/devices/indi/device'
import type { Camera, Mount, MountTargetCoordinate, PierSide } from 'nebulosa/src/devices/indi/device'
import { sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { CameraCaptureStart } from '#/camera'
import { coordinateInfo } from '#/mount'
import type { SequencerAuxiliaryCapture, SequencerPlateSolver } from '#/sequencer'
import type { CameraHandler } from './camera'
import type { MountCommander } from './mount.commander'
import type { PlateSolverHandler } from './platesolver'
import { sequencerActionFailure, sequencerDeviceOf, sequencerMissingRole, sequencerSettle } from './sequencer.action'
import type { SequencerCenter, SequencerSlew } from './sequencer.compiler'
import { SEQUENCER_BLOCK_TYPE } from './sequencer.compiler'
import { sequencerFilterSlot } from './sequencer.optics'
import type { ResourceBinding, SequencerActionContext, SequencerActionHandler, SequencerActionResult, SequencerValidationContext, SequencerValidationResult } from './sequencer.registry'
import type { WheelCommander } from './wheel.commander'

// Executable blocks that decide where the telescope points: the slew that puts the target in the field and the
// closed-loop centering that puts it where the definition asked for it.
//
// Both run under the scope the session reservation authorizes, so every device command they issue nests in the
// session's operation tree and is cancelled with it. Neither of them touches the capture progress: a centering
// exposure fills no slot, registers no artifact and is written to the auxiliary directory of the session, which
// is what keeps the frames of the plan and the frames that only look at the sky apart on disk.
//
// Angles are radians and durations are seconds, as declared; the commanders below take milliseconds.

// Where a slew ended, as the mount itself reports it once it has stopped.
export interface SequencerSlewOutcome {
	// Final right ascension in radians, in the equinox of date.
	readonly rightAscension: Angle
	// Final declination in radians, in the equinox of date.
	readonly declination: Angle
	// Pier side reported after the slew, NEITHER when the driver publishes none.
	readonly pierSide: PierSide
	// Whether the mount is tracking once the action returns.
	readonly tracking: boolean
}

// What a centering achieved, measured by the last solve it performed.
export interface SequencerCenterOutcome {
	// Number of exposures the loop spent, at least one.
	readonly attempts: number
	// Separation in radians between the last solved field centre and the requested coordinates.
	readonly separation: Angle
	// Solved right ascension in radians, J2000, of the last frame.
	readonly rightAscension: Angle
	// Solved declination in radians, J2000, of the last frame.
	readonly declination: Angle
	// True when the reported separation was measured after the last correction, which is what proves the field
	// is where it was asked to be. It is false for a centering that corrected without solving again, which is
	// what `finalSolve: false` asks for.
	readonly verified: boolean
	// Whether the mount model was synchronized to a solved position during the loop.
	readonly synced: boolean
}

// Collaborators the centering block commands, injected so the handler stays free of device managers.
export interface SequencerCenteringServices {
	// Owner of the auxiliary exposure the loop solves.
	readonly cameraHandler: CameraHandler
	// Owner of every mount movement and of the sync.
	readonly mountCommander: MountCommander
	// Owner of the wheel, used only when the centering recipe names a filter of its own.
	readonly wheelCommander: WheelCommander
	// Backend solving each auxiliary frame.
	readonly plateSolver: PlateSolverHandler
}

// Handler version of the pointing blocks. It changes whenever the meaning of their configuration or of their
// execution changes, which refuses a session compiled against the older meaning instead of running it here.
const SEQUENCER_POINTING_VERSION = 1

// Extension of one auxiliary frame, which names the container the camera was asked to transfer.
//
// The camera writes the bytes of the declared transfer format under whatever name it is given, so a name that
// disagrees with the format is a file every reader after it decodes by the wrong rules: the plate solver of
// this very loop is the first one to open it.
function auxiliaryExtension(recipe: SequencerAuxiliaryCapture) {
	return recipe.transferFormat === 'XISF' ? 'xisf' : 'fits'
}

// Coordinates the plate solution is compared against.
//
// A solution is J2000, so the J2000 point of the target is the one that can be compared with it directly. A
// target declared in another frame carries its J2000 point as well — the lowering resolves every frame it was
// given — and a target that somehow carries none is compared against its primary point, which is the closest
// thing to an answer available and is only ever reached by a coordinate the compiler did not fill in.
function j2000Of(coordinates: MountTargetCoordinate<Angle>, longitude: Angle) {
	if (coordinates.type === 'J2000') return [coordinates.J2000!.x, coordinates.J2000!.y] as const
	const info = coordinateInfo(timeNow(true), longitude, coordinates, { equatorialJ2000: true })
	return info.equatorialJ2000
}

// Builds the camera request of one auxiliary exposure from a declared recipe and the destination the runtime
// reserved for it. The frame is written where it is told and never auto-saved, which is what keeps it out of
// the namespace of the slots.
function auxiliaryCapture(recipe: SequencerAuxiliaryCapture, directory: string, fileName: string, mount: Mount): CameraCaptureStart {
	return {
		...DEFAULT_CAMERA_CAPTURE_START,
		exposureTime: recipe.exposureTime,
		exposureTimeUnit: 'second',
		frameType: recipe.frameType,
		exposureMode: 'single',
		count: 1,
		delay: 0,
		binX: recipe.binX,
		binY: recipe.binY,
		gain: recipe.gain,
		offset: recipe.offset,
		subframe: recipe.subframe.enabled,
		x: recipe.subframe.x,
		y: recipe.subframe.y,
		width: recipe.subframe.width,
		height: recipe.subframe.height,
		transferFormat: recipe.transferFormat,
		compressed: recipe.compressed,
		autoSave: false,
		outputPath: directory,
		outputName: fileName,
		mount: mount.name,
	}
}

// Builds the solver request for one auxiliary frame, hinted with the coordinates the field is expected at.
//
// The hint is the target rather than where the mount believes it is pointing: a mount whose model is wrong is
// exactly the case centering exists for, and hinting with its own error would search around the wrong place.
// A blind solve ignores both, and its search radius is dropped so the backend does not narrow itself.
function solveRequest(solver: SequencerPlateSolver, path: string, id: string, rightAscension: Angle, declination: Angle) {
	return {
		id,
		type: solver.type,
		executable: solver.executable ?? '',
		path,
		focalLength: 0,
		pixelSize: 0,
		fov: 0,
		blind: solver.blind,
		rightAscension,
		declination,
		radius: solver.blind ? 0 : solver.searchRadius * RAD2DEG,
		downsample: solver.downsample,
		timeout: solver.timeout * 1000,
	}
}

// Slew block: sends the mount to the target coordinates, verifies where it stopped, and establishes the
// tracking the target asked for.
//
// The arrival check belongs to the commander, which compares the position the mount publishes once it has
// stopped against `arrivalTolerance` and refuses a slew that ended somewhere else. `skipWhenAlreadyAtTarget`
// is expressed as the commander's `tolerance`, which is the separation below which nothing is commanded at
// all; a definition that turns the skip off asks for the movement to be commanded unconditionally, which is a
// tolerance of zero.
export function sequencerSlewHandler(mountCommander: MountCommander): SequencerActionHandler<SequencerSlew, SequencerSlewOutcome> {
	return {
		type: SEQUENCER_BLOCK_TYPE.slew,
		version: SEQUENCER_POINTING_VERSION,
		validate: (configuration, context) => validatePointing<SequencerSlew>(configuration, context, ['mount']),
		resources: () => [{ role: 'mount' }],
		execute: async (context, configuration) => {
			const mount = sequencerDeviceOf(context, 'mount', isMount)

			if (mount === undefined) return sequencerMissingRole('mount')

			context.progress({ detail: 'slewing to the target' })

			const options = { timeout: configuration.timeout * 1000, tolerance: configuration.skipWhenAlreadyAtTarget ? configuration.tolerance : 0, arrivalTolerance: configuration.arrivalTolerance }
			const slewed = await mountCommander.goTo(context.scope, mount, configuration.coordinates, options)

			if (!slewed.ok) return sequencerActionFailure(slewed, 'the mount did not reach the target')

			// Tracking is established after the arrival, never before it: a mount tracking while it slews drags
			// the target it is being sent to, and the mode the definition asks for only means something once the
			// mount is standing on the field it will follow.
			if (configuration.tracking !== undefined) {
				context.progress({ detail: 'establishing tracking' })

				const mode = await mountCommander.setTrackMode(context.scope, mount, configuration.tracking.mode)

				if (!mode.ok) return sequencerActionFailure(mode, `the mount did not accept the ${configuration.tracking.mode} track mode`)

				const tracking = await mountCommander.setTracking(context.scope, mount, true, { timeout: configuration.timeout * 1000 })

				if (!tracking.ok) return sequencerActionFailure(tracking, 'the mount did not start tracking')
			}

			const settled = await sequencerSettle(context, configuration.settle)

			if (!settled.ok) return sequencerActionFailure(settled, 'the settle after the slew was interrupted')

			return { type: 'completed', value: { ...slewed.value, tracking: mount.tracking } }
		},
	}
}

// Roles the centering commands, which are the loop plus the wheel its recipe reaches a declared filter
// through.
//
// The wheel is bound only when the recipe names a filter, and bound as optional because a rig without one
// solves through whatever is installed rather than refusing to centre — the solution comes from the star
// field, which every filter shows.
function centeringResources(configuration: SequencerCenter): ResourceBinding[] {
	const roles: ResourceBinding[] = [{ role: 'mount' }, { role: 'camera' }]

	if (configuration.capture.filter !== undefined) roles.push({ role: 'wheel', optional: true })

	return roles
}

// Centering block: captures, solves, and corrects until the solved field centre is within tolerance of the
// target or the attempts run out.
//
// The loop always measures before it corrects, so the first exposure of a mount that is already centred ends
// it without commanding anything. `finalSolve` decides what happens after a correction: with it, the loop
// solves again and only stops once the separation it measured was measured on the corrected position, which is
// what makes the reported outcome a verified one; without it, the first correction ends the centering and the
// outcome reports the separation that motivated the correction rather than the one that followed it.
//
// `syncMount` corrects the mount's own model before commanding it back to the target, which is what turns a
// pointing error into a corrected slew instead of repeating the same wrong movement; without it, the loop still
// converges through the residual error of successive slews, only more slowly.
export function sequencerCenterHandler(services: SequencerCenteringServices): SequencerActionHandler<SequencerCenter, SequencerCenterOutcome> {
	return {
		type: SEQUENCER_BLOCK_TYPE.center,
		version: SEQUENCER_POINTING_VERSION,
		validate: (configuration, context) => validatePointing<SequencerCenter>(configuration, context, ['mount', 'camera']),
		resources: (configuration) => centeringResources(configuration),
		execute: (context, configuration) => runCentering(services, context, configuration),
	}
}

// Runs the centering loop of the block above, and of every other block that has to re-establish the field.
//
// It is exported because a meridian flip centres again on the other side of the meridian with exactly this
// routine and the same configuration, under its own node; the loop keeps no state of its own between calls, so
// running it twice in one safe point is running it twice, not resuming it.
export async function runCentering(services: SequencerCenteringServices, context: SequencerActionContext, configuration: SequencerCenter): Promise<SequencerActionResult<SequencerCenterOutcome>> {
	const mount = sequencerDeviceOf(context, 'mount', isMount)

	if (mount === undefined) return sequencerMissingRole('mount')

	const camera = sequencerDeviceOf(context, 'camera', isCamera)

	if (camera === undefined) return sequencerMissingRole('camera')

	const target = j2000Of(configuration.coordinates, mount.geographicCoordinate.longitude)

	const prepared = await prepareCenteringFilter(services, context, configuration)

	if (prepared !== undefined) return prepared

	let synced = false

	for (let attempt = 1; attempt <= configuration.maximumAttempts; attempt++) {
		context.progress({ fraction: (attempt - 1) / configuration.maximumAttempts, detail: `centering attempt ${attempt}` })

		const solution = await solveOneFrame(services, context, configuration, camera, mount, attempt)

		if (solution.type !== 'completed') return solution

		const separation = sphericalSeparation(solution.value.rightAscension, solution.value.declination, target[0], target[1])
		const outcome: SequencerCenterOutcome = { attempts: attempt, separation, rightAscension: solution.value.rightAscension, declination: solution.value.declination, verified: true, synced }

		if (separation <= configuration.tolerance) return { type: 'completed', value: outcome }

		// The last attempt of a verifying centering has no solve left to prove the correction with, so
		// correcting here would end the action reporting a field nothing measured. Reporting the miss instead
		// lets the retry policy decide, with the separation that was actually observed.
		//
		// A centering that does not verify makes the opposite trade on purpose: the correction is what ends it,
		// and the outcome says so with `verified: false`. Stopping it here would leave `maximumAttempts: 1`
		// unable to correct at all, failing every time on a field it was one slew away from fixing.
		if (attempt === configuration.maximumAttempts && configuration.finalSolve) {
			return { type: 'retryableFailure', reason: 'unexpectedState', detail: `centering stopped ${(separation * RAD2DEG).toFixed(4)}° from the target after ${attempt} attempts` }
		}

		context.progress({ detail: 'correcting the pointing' })

		if (configuration.syncMount) {
			const sync = await services.mountCommander.sync(context.scope, mount, { type: 'J2000', J2000: { x: solution.value.rightAscension, y: solution.value.declination } })

			if (!sync.ok) return sequencerActionFailure(sync, 'the mount did not accept the solved position')

			synced = true
		}

		const slewed = await services.mountCommander.goTo(context.scope, mount, configuration.coordinates, { tolerance: 0 })

		if (!slewed.ok) return sequencerActionFailure(slewed, 'the correcting slew did not reach the target')

		const settled = await sequencerSettle(context, configuration.settle)

		if (!settled.ok) return sequencerActionFailure(settled, 'the settle after the correcting slew was interrupted')

		if (!configuration.finalSolve) {
			return { type: 'completed', value: { ...outcome, verified: false, synced } }
		}
	}

	// Unreachable for a positive attempt limit, and the honest answer for a definition that asked for none.
	return { type: 'fatalFailure', reason: 'unexpectedState', detail: 'the centering was allowed no attempt' }
}

// Moves the wheel to the filter the centering recipe declares, when it declares one.
//
// Returns the failure that must end the action, or undefined when there was nothing to do or the move
// succeeded. A recipe naming a filter on a session without a wheel is left alone rather than failed: the
// solution comes from the star field, which every filter shows, so the exposure through whatever filter is
// mounted is worth more than refusing to centre at all.
async function prepareCenteringFilter(services: SequencerCenteringServices, context: SequencerActionContext, configuration: SequencerCenter): Promise<SequencerActionResult<never> | undefined> {
	if (configuration.capture.filter === undefined) return undefined

	const wheel = sequencerDeviceOf(context, 'wheel', isWheel)

	if (wheel === undefined) return undefined

	const slot = sequencerFilterSlot(wheel, configuration.capture.filter)

	if (slot === undefined || slot === wheel.position) return undefined

	const moved = await services.wheelCommander.moveTo(context.scope, wheel, slot)

	return moved.ok ? undefined : sequencerActionFailure(moved, 'the wheel did not reach the centering filter')
}

// Captures one auxiliary frame and solves it, reporting the solved field centre.
//
// The destination is reserved before the exposure starts, because a frame with nowhere proven to go must not
// be exposed at all; the capture is nested in the action's scope, so it inherits the camera the session already
// holds instead of competing with it, and the solver inherits the action's signal, so a stopped session stops
// the backend it started.
async function solveOneFrame(services: SequencerCenteringServices, context: SequencerActionContext, configuration: SequencerCenter, camera: Camera, mount: Mount, attempt: number): Promise<SequencerActionResult<PlateSolution>> {
	const target = context.auxiliary('centering', auxiliaryExtension(configuration.capture))

	if (target === undefined) return { type: 'fatalFailure', reason: 'unexpectedState', detail: 'the centering frame has no destination the session could prove' }

	const handle = services.cameraHandler.capture(context.scope, camera, auxiliaryCapture(configuration.capture, target.directory, target.fileName, mount))
	const started = await handle.started

	if (!started.ok) return sequencerActionFailure(started, 'the centering exposure did not start')

	const captured = await handle.result

	if (!captured.ok) return sequencerActionFailure(captured, 'the centering exposure failed')

	const path = captured.value.paths.at(-1)

	if (path === undefined) return { type: 'retryableFailure', reason: 'unexpectedState', detail: 'the centering exposure produced no frame' }

	context.progress({ detail: `solving the centering frame ${attempt}` })

	const hint = j2000Of(configuration.coordinates, mount.geographicCoordinate.longitude)
	const request = solveRequest(configuration.solver, path, `${context.sessionId}:${context.nodeId}:${attempt}`, hint[0], hint[1])
	const solution = await services.plateSolver.start(request, context.signal)

	if (solution === undefined) {
		return context.signal.aborted ? { type: 'fatalFailure', reason: 'aborted' } : { type: 'retryableFailure', reason: 'commandFailed', detail: 'the centering frame could not be solved' }
	}

	return { type: 'completed', value: solution }
}

// Narrows a stored pointing configuration and refuses it when a role it commands is not part of the session.
//
// The configuration itself is what the compiler emitted, so it is taken as the shape the compiler produced;
// the roles are not, because a definition can be edited to drop a device after the block that needs it was
// lowered, and finding that out at the first command means finding it out with the observatory already open.
function validatePointing<C>(configuration: unknown, context: SequencerValidationContext, roles: readonly ('mount' | 'camera')[]): SequencerValidationResult<C> {
	const issues = roles.filter((role) => context.devices[role] === undefined).map((role) => ({ path: `devices.${role}`, message: `the ${role} is required to point the telescope` }))
	return issues.length > 0 ? { ok: false, issues } : { ok: true, configuration: configuration as C }
}
