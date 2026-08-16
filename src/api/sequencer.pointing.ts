import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { RAD2DEG } from 'nebulosa/src/core/constants'
import { isCamera, isMount, isWheel } from 'nebulosa/src/devices/indi/device'
import type { Camera, Mount, MountTargetCoordinate, PierSide, Wheel } from 'nebulosa/src/devices/indi/device'
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
	// is where it was asked to be. The centering loop always solves again after correcting, so a completed
	// centering reports it true.
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
//
// `instant` is the epoch the conversion is made for, in milliseconds since the Unix epoch. It matters for
// every target that is not fixed on the sky: a horizontal coordinate names a different celestial point at
// every moment, drifting at the sidereal rate, so a conversion made once and reused across the attempts of a
// loop would measure the field against a point the sky has already carried away — fifteen arcseconds of right
// ascension for every second between the conversion and the frame.
function j2000Of(coordinates: MountTargetCoordinate<Angle>, location: GeographicCoordinate, instant: number) {
	// The UI will always send the field specified by the type.
	if (coordinates.type === 'J2000') return [coordinates.J2000!.x, coordinates.J2000!.y] as const
	const time = timeUnix(instant / 1000, true)
	time.location = location
	const info = coordinateInfo(time, location.longitude, coordinates, { equatorialJ2000: true })
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
		autoSave: true,
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
// stopped against `arrivalTolerance` and refuses a slew that ended somewhere else. The declared `skipTolerance`
// is the separation below which nothing is commanded at all; a definition that wants the movement commanded
// unconditionally declares a skip tolerance of zero.
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

			const options = { timeout: configuration.timeout * 1000, tolerance: configuration.skipTolerance, arrivalTolerance: configuration.arrivalTolerance }
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
// it without commanding anything. A correction is always followed by another solve, so the loop only stops
// once the separation it reports was measured on the corrected position, which is what makes the outcome a
// verified one; the last attempt therefore reports the miss instead of correcting blindly.
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

	const transition = centeringFilter(context, configuration)

	if (transition !== undefined) {
		const moved = await services.wheelCommander.moveTo(context.scope, transition.wheel, transition.slot)

		if (!moved.ok) return sequencerActionFailure(moved, 'the wheel did not reach the centering filter')
	}

	const result = await runCenteringLoop(services, context, configuration, camera, mount)

	if (transition === undefined) return result

	// The wheel goes back to the filter it was found on. The centering moves the wheel and never the focuser,
	// so leaving it on the centering filter leaves the two describing different paths: the frame preparation
	// that runs next derives its focus shift from the slot the wheel is standing at, and would correct from an
	// offset the focuser was never moved to. Restoring here keeps the pair consistent without anything having
	// to remember what the centering did.
	const restored = await services.wheelCommander.moveTo(context.scope, transition.wheel, transition.installed)

	if (restored.ok || transition.wheel.position === transition.installed) return result

	// A wheel stranded on the centering filter is not something a retry repairs: the next run finds that filter
	// already installed, makes no transition of its own and restores nothing, so it ends on the centering slot
	// too, and every frame prepared after it derives a focus shift from a slot the focuser was never moved to.
	// The action is therefore ended rather than offered again, whatever the loop itself decided. An abort is
	// left alone: it already stops the session, and the failed restore is only the wheel refusing a command
	// nothing was going to accept.
	if (result.type === 'fatalFailure') return result

	return { type: 'fatalFailure', reason: restored.reason, detail: `the wheel did not return to the frame filter${restored.error === undefined ? '' : `: ${restored.error}`}` }
}

// Runs the attempts of the centering, with the wheel already standing on the filter the recipe declared.
async function runCenteringLoop(services: SequencerCenteringServices, context: SequencerActionContext, configuration: SequencerCenter, camera: Camera, mount: Mount): Promise<SequencerActionResult<SequencerCenterOutcome>> {
	let synced = false

	for (let attempt = 1; attempt <= configuration.maximumAttempts; attempt++) {
		context.progress({ fraction: (attempt - 1) / configuration.maximumAttempts, detail: `centering attempt ${attempt}` })

		const solved = await solveOneFrame(services, context, configuration, camera, mount, attempt)

		if (solved.type !== 'completed') return solved

		const { solution, observedAt } = solved.value
		const target = j2000Of(configuration.coordinates, mount.geographicCoordinate, observedAt)
		const separation = sphericalSeparation(solution.rightAscension, solution.declination, target[0], target[1])
		const outcome: SequencerCenterOutcome = { attempts: attempt, separation, rightAscension: solution.rightAscension, declination: solution.declination, verified: true, synced }

		if (separation <= configuration.tolerance) return { type: 'completed', value: outcome }

		// The last attempt has no solve left to prove the correction with, so correcting here would end the action
		// reporting a field nothing measured. Reporting the miss instead lets the retry policy decide, with the
		// separation that was actually observed.
		if (attempt === configuration.maximumAttempts) {
			return { type: 'retryableFailure', reason: 'unexpectedState', detail: `centering stopped ${(separation * RAD2DEG).toFixed(4)}° from the target after ${attempt} attempts` }
		}

		context.progress({ detail: 'correcting the pointing' })

		if (configuration.syncMount) {
			const sync = await services.mountCommander.sync(context.scope, mount, { type: 'J2000', J2000: { x: solution.rightAscension, y: solution.declination } })

			if (!sync.ok) return sequencerActionFailure(sync, 'the mount did not accept the solved position')

			synced = true
		}

		const slewed = await services.mountCommander.goTo(context.scope, mount, configuration.coordinates, { tolerance: 0 })

		if (!slewed.ok) return sequencerActionFailure(slewed, 'the correcting slew did not reach the target')

		const settled = await sequencerSettle(context, configuration.settle)

		if (!settled.ok) return sequencerActionFailure(settled, 'the settle after the correcting slew was interrupted')
	}

	// Unreachable for a positive attempt limit, and the honest answer for a definition that asked for none.
	return { type: 'fatalFailure', reason: 'unexpectedState', detail: 'the centering was allowed no attempt' }
}

// Filter transition the centering has to make, or undefined when it has to make none.
//
// Undefined covers everything that leaves the wheel alone: a recipe naming no filter, a session commanding no
// wheel, a filter this wheel does not carry, and a filter already installed. A recipe naming a filter on a
// session without a wheel is left alone rather than failed, because the solution comes from the star field,
// which every filter shows, so exposing through whatever filter is mounted is worth more than refusing to
// centre at all.
//
// `installed` is the slot the wheel was found on, 0-based, which is the slot the focuser position serves and
// the one the wheel is put back to once the centering ends.
function centeringFilter(context: SequencerActionContext, configuration: SequencerCenter): { readonly wheel: Wheel; readonly slot: number; readonly installed: number } | undefined {
	if (configuration.capture.filter === undefined) return undefined

	const wheel = sequencerDeviceOf(context, 'wheel', isWheel)

	if (wheel === undefined) return undefined

	const slot = sequencerFilterSlot(wheel, configuration.capture.filter)

	if (slot === undefined || slot === wheel.position) return undefined

	return { wheel, slot, installed: wheel.position }
}

// Captures one auxiliary frame and solves it, reporting the solved field centre.
//
// The destination is reserved before the exposure starts, because a frame with nowhere proven to go must not
// be exposed at all; the capture is nested in the action's scope, so it inherits the camera the session already
// holds instead of competing with it, and the solver inherits the action's signal, so a stopped session stops
// the backend it started.
// The reported epoch is the middle of the exposure, measured from the moment the camera reported the exposure
// started rather than from the moment the attempt was decided: resolving the destination, configuring the
// camera and waiting for the driver to accept the command all advance the clock, and on a rig that is slow to
// arm an exposure the difference is the whole delay rather than half of it. A target that is not fixed on the
// sky names another celestial point over that interval, so the hint and the comparison would both be made
// against a position the frame never saw.
async function solveOneFrame(services: SequencerCenteringServices, context: SequencerActionContext, configuration: SequencerCenter, camera: Camera, mount: Mount, attempt: number): Promise<SequencerActionResult<{ readonly solution: PlateSolution; readonly observedAt: number }>> {
	const target = context.auxiliary('centering', auxiliaryExtension(configuration.capture))

	if (target === undefined) return { type: 'fatalFailure', reason: 'unexpectedState', detail: 'the centering frame has no destination the session could prove' }

	const handle = services.cameraHandler.capture(context.scope, camera, auxiliaryCapture(configuration.capture, target.directory, target.fileName, mount))
	const started = await handle.started

	if (!started.ok) return sequencerActionFailure(started, 'the centering exposure did not start')

	// Epoch of the frame this attempt measures with. Every attempt has one of its own, because a solve, a
	// settle and a correction all advance the clock between one frame and the next.
	const observedAt = context.now() + configuration.capture.exposureTime * 500
	const captured = await handle.result

	if (!captured.ok) return sequencerActionFailure(captured, 'the centering exposure failed')

	const path = captured.value.paths.at(-1)

	if (path === undefined) return { type: 'retryableFailure', reason: 'unexpectedState', detail: 'the centering exposure produced no frame' }

	context.progress({ detail: `solving the centering frame ${attempt}` })

	const hint = j2000Of(configuration.coordinates, mount.geographicCoordinate, observedAt)
	const request = solveRequest(configuration.solver, path, `${context.sessionId}:${context.nodeId}:${attempt}`, hint[0], hint[1])
	const solution = await services.plateSolver.start(request, context.signal)

	if (solution === undefined) {
		return context.signal.aborted ? { type: 'fatalFailure', reason: 'aborted' } : { type: 'retryableFailure', reason: 'commandFailed', detail: 'the centering frame could not be solved' }
	}

	return { type: 'completed', value: { solution, observedAt } }
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
