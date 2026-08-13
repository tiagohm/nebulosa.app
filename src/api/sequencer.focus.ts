import { isCamera, isFocuser, isWheel } from 'nebulosa/src/devices/indi/device'
import type { Focuser, Wheel } from 'nebulosa/src/devices/indi/device'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import type { AutoFocusStart } from '#/autofocus'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import { successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { SequencerAutofocus, SequencerAuxiliaryCapture, SequencerStarDetection } from '#/sequencer'
import type { AutoFocusRunner } from './autofocus.runner'
import type { FocuserCommander } from './focuser.commander'
import { sequencerActionFailure, sequencerDeviceOf, sequencerMissingRole, sequencerSettle } from './sequencer.action'
import { SEQUENCER_BLOCK_TYPE } from './sequencer.compiler'
import { sequencerFilterSlot, sequencerFocusOffsetShift } from './sequencer.optics'
import type { ResourceBinding, SequencerActionContext, SequencerActionHandler, SequencerActionResult, SequencerValidationContext, SequencerValidationResult } from './sequencer.registry'
import type { WheelCommander } from './wheel.commander'

// Autofocus as a safe-point action: the V-curve search of the focus feature, run under the session
// reservation and left in a state the frame about to be exposed can use.
//
// The search itself belongs to AutoFocusRunner and is the same one the manual route runs; what this block
// adds is everything about running it inside a night. The recipe may name a filter to focus through, which is
// usually a broader one than the frame will use, so the search happens on that path and the measured position
// is then carried back to the path the wheel was on with the declared filter offsets. Focus is measured where
// it can be measured and applied where it is needed, which is what an offset is for.
//
// A search that ends without focus — no stars, or a curve that could not be fitted — is a retryable failure
// rather than a completed action: the anchor of the trigger only moves after a run that focused, so reporting
// success here would silence the condition that asked for it until it came back.
//
// Focuser positions and offsets are device steps; the declared settle is seconds.

// What one autofocus run left behind, which is what the session records against the trigger anchor.
export interface SequencerAutofocusOutcome {
	// Position the focuser was left at, in device steps, already corrected for the filter below.
	readonly position: number
	// Fitted minimum of the V-curve, in device steps against HFD, as the search measured it.
	readonly focusPoint?: Point
	// Position the search itself converged on, before any offset correction, in device steps.
	readonly measured: number
	// Filter installed when the action returns, which is the path the reported position serves. Absent when
	// the session commands no wheel.
	readonly filter?: string
	// Filter the search actually measured through, absent when it measured through no wheel at all.
	readonly measuredFilter?: string
}

// Collaborators the autofocus block commands, injected so the handler stays free of device managers.
export interface SequencerAutofocusServices {
	// Owner of the V-curve search, shared with the manual autofocus route.
	readonly runner: AutoFocusRunner
	// Owner of the offset correction applied after the search.
	readonly focuserCommander: FocuserCommander
	// Owner of the wheel, used only when the recipe focuses through a filter of its own.
	readonly wheelCommander: WheelCommander
}

// Handler version of the autofocus block. It changes whenever the meaning of its configuration or of its
// execution changes, which refuses a session compiled against the older meaning instead of running it here.
const SEQUENCER_FOCUS_VERSION = 1

// Extension of one auxiliary frame, which names the container the camera was asked to transfer.
//
// The camera writes the bytes of the declared transfer format under whatever name it is given, so a name that
// disagrees with the format is a file every reader after it decodes by the wrong rules: the star detection of
// this very search is the first one to open it.
function auxiliaryExtension(recipe: SequencerAuxiliaryCapture) {
	return recipe.transferFormat === 'XISF' ? 'xisf' : 'fits'
}

// Configuration of the autofocus block, which is the feature without the flag that enabled it.
type SequencerAutofocusTrigger = Omit<SequencerAutofocus, 'enabled'>

// Name of the filter a wheel currently carries, or undefined when it publishes none for that slot.
//
// A wheel with unnamed slots is usable — the slot number still selects a physical path — but nothing can be
// recorded about which filter it was, which is exactly what an absent name means to the anchors.
function filterNameOf(wheel: Wheel | undefined, slot: number | undefined) {
	return wheel === undefined || slot === undefined ? undefined : wheel.names[slot] || undefined
}

// Builds the star-detection request of the search from the declared recipe.
//
// The path is filled per frame by the search itself, and the declared timeout is seconds while the backend
// takes milliseconds.
function starDetectionOf(starDetection: SequencerStarDetection) {
	return { type: starDetection.type, executable: starDetection.executable, path: '', timeout: starDetection.timeout * 1000, minSNR: starDetection.minimumSNR, maxStars: starDetection.maximumStars, slot: 0 }
}

// Builds the camera request of one sampled frame from the declared recipe.
//
// Everything the search owns — frame count, delay, frame type, exposure mode, auto-save — is normalized by the
// search itself, so only what the recipe decides is set here. The destination is left out and reserved one
// frame at a time, because a fixed output name refuses to overwrite and a search exposes many frames.
function autofocusCapture(recipe: SequencerAuxiliaryCapture) {
	return {
		...DEFAULT_CAMERA_CAPTURE_START,
		exposureTime: recipe.exposureTime,
		exposureTimeUnit: 'second' as const,
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
	}
}

// Roles the autofocus commands, which are the search plus the wheel the declared filter is reached through.
//
// The wheel is only bound when the recipe names a filter of its own, since that is the only reason this block
// touches it, and it is bound as optional because a rig without a wheel focuses through the installed path
// instead of refusing to focus. Without the binding the runtime never puts the wheel in the role map, and the
// declared filter would be ignored in silence: the search would run through whatever is installed and the
// offset between the two paths would never be applied.
function autofocusResources(configuration: SequencerAutofocusTrigger): ResourceBinding[] {
	const roles: ResourceBinding[] = [{ role: 'camera' }, { role: 'focuser' }]

	if (configuration.capture.filter !== undefined) roles.push({ role: 'wheel', optional: true })

	return roles
}

// Autofocus block: focuses through the declared path and leaves the focuser where the next frame needs it.
export function sequencerAutofocusHandler(services: SequencerAutofocusServices): SequencerActionHandler<SequencerAutofocusTrigger, SequencerAutofocusOutcome> {
	return {
		type: SEQUENCER_BLOCK_TYPE.autofocus,
		version: SEQUENCER_FOCUS_VERSION,
		validate: (configuration, context) => validateAutofocus(configuration, context),
		resources: (configuration) => autofocusResources(configuration),
		execute: (context, configuration) => runAutofocus(services, context, configuration),
	}
}

// Runs one autofocus at a safe point, from the optional filter change to the settle that ends it.
//
// It is exported because a meridian flip refocuses on the other side of the meridian with exactly this
// routine and the configuration the flip carries, under its own node.
export async function runAutofocus(services: SequencerAutofocusServices, context: SequencerActionContext, configuration: SequencerAutofocusTrigger): Promise<SequencerActionResult<SequencerAutofocusOutcome>> {
	const camera = sequencerDeviceOf(context, 'camera', isCamera)

	if (camera === undefined) return sequencerMissingRole('camera')

	const focuser = sequencerDeviceOf(context, 'focuser', isFocuser)

	if (focuser === undefined) return sequencerMissingRole('focuser')

	const wheel = sequencerDeviceOf(context, 'wheel', isWheel)
	// Position the focuser was found at, in device steps, which is the focus the frame filter was already
	// being exposed with. It is what the block restores when it measured a new focus it could not apply.
	const initialPosition = focuser.position.value
	// Slot the frame about to be exposed will be taken through, which is the one the wheel is already on: the
	// preparation of the frame runs after this block, so what is installed now is what the offsets are
	// measured back to.
	const installedSlot = wheel?.position
	const focusSlot = focusThroughSlot(wheel, configuration)
	// Filter change the search is performed through, absent when it happens on the installed path. Every exit
	// of the block undoes it, so the wheel never outlives the search that moved it.
	const transition = wheel !== undefined && installedSlot !== undefined && focusSlot !== undefined && focusSlot !== installedSlot ? { wheel, focusSlot, installedSlot } : undefined

	if (transition !== undefined) {
		context.progress({ detail: 'moving to the autofocus filter' })

		const moved = await services.wheelCommander.moveTo(context.scope, transition.wheel, transition.focusSlot)

		if (!moved.ok) return sequencerActionFailure(moved, 'the wheel did not reach the autofocus filter')

		// Correction from the frame filter to the autofocus one, in device steps. The search samples a fixed
		// number of steps around wherever the focuser stands, so starting it on the focus of the other path
		// biases the whole curve by the difference between the two: an offset larger than the half-sweep
		// `initialOffsetSteps * stepSize` puts every sampled frame outside the region where the star detection
		// can measure an HFD, and the run finds no focus for a reason that has nothing to do with the sky.
		const shift = sequencerFocusOffsetShift(transition.wheel, configuration.filterOffsets, transition.installedSlot, transition.focusSlot)

		if (shift !== 0) {
			const target = initialPosition + shift

			context.progress({ detail: `applying the offset of the autofocus filter at position ${target}` })

			const shifted = await services.focuserCommander.moveTo(context.scope, focuser, target)

			if (!shifted.ok) {
				const restored = await restoreFrameFilter(services, context, transition)
				return await strandedFrameOptics(services, context, focuser, initialPosition, transition, restored, sequencerActionFailure(shifted, 'the focuser did not take the offset of the autofocus filter'))
			}
		}
	}

	context.progress({ detail: 'searching for focus' })

	const request: AutoFocusStart = {
		capture: autofocusCapture(configuration.capture),
		starDetection: starDetectionOf(configuration.starDetection),
		initialOffsetSteps: configuration.algorithm.initialOffsetSteps,
		stepSize: configuration.algorithm.stepSize,
		fittingMode: configuration.algorithm.fittingMode,
		rmsdThreshold: configuration.algorithm.rmsdThreshold,
		reversed: configuration.algorithm.reversed,
		maxPosition: configuration.algorithm.maximumPosition,
	}

	const { handle, finish } = services.runner.start(context.scope, camera, focuser, request, () => context.auxiliary('autofocus', auxiliaryExtension(configuration.capture)))
	const result = await handle.result

	// The runner publishes the states a search passes through and never the one that ends it: the terminal
	// event belongs to whoever resolved the cause, because a start the arbiter refused never reaches the
	// executor. The session is that owner here, and the feed is the same one the manual route publishes to, so
	// leaving it unpublished would show every client an autofocus still running for the rest of the night.
	// It is emitted before anything else is decided, so that the restore of the wheel and the offset of the
	// filter cannot leave a path where the search never ended.
	finish(handle.id, result.ok ? result.value.message : (result.error ?? result.reason))

	if (!result.ok) {
		const restored = await restoreFrameFilter(services, context, transition)
		return await strandedFrameOptics(services, context, focuser, initialPosition, transition, restored, sequencerActionFailure(result, 'the autofocus search failed'))
	}

	// The search reports a curve it could not fit as a successful operation, because no device misbehaved. For
	// the session it is still a run that produced no focus, and treating it as completed would advance the
	// anchor and silence the condition that asked for the run until it came back on its own.
	if (result.value.outcome !== 'focused') {
		const restored = await restoreFrameFilter(services, context, transition)
		return await strandedFrameOptics(services, context, focuser, initialPosition, transition, restored, { type: 'retryableFailure', reason: 'unexpectedState', detail: `the autofocus found no focus: ${result.value.message}` })
	}

	const measured = result.value.position
	let position = measured

	// The wheel goes back before the offset is applied, so the position the action reports is the one the
	// installed path is standing at rather than one that assumes a move still to come.
	if (transition !== undefined) {
		const restored = await restoreFrameFilter(services, context, transition)

		if (!restored.ok) return await strandedFrameOptics(services, context, focuser, initialPosition, transition, restored, sequencerActionFailure(restored, 'the wheel did not return to the frame filter'))

		const shift = sequencerFocusOffsetShift(transition.wheel, configuration.filterOffsets, transition.focusSlot, transition.installedSlot)

		if (shift !== 0) {
			position = measured + shift

			const moved = await services.focuserCommander.moveTo(context.scope, focuser, position)

			if (!moved.ok) {
				const failure = sequencerActionFailure(moved, 'the focuser did not accept the filter offset')
				return failure.type === 'fatalFailure' ? failure : await restoreFrameFocus(services, context, focuser, initialPosition, failure)
			}

			position = focuser.position.value
		}
	}

	const settled = await sequencerSettle(context, configuration.settle)

	if (!settled.ok) return sequencerActionFailure(settled, 'the settle after the autofocus was interrupted')

	return {
		type: 'completed',
		value: { position, measured, focusPoint: result.value.focusPoint, filter: filterNameOf(wheel, installedSlot), measuredFilter: filterNameOf(wheel, focusSlot ?? installedSlot) },
	}
}

// Puts the wheel back on the slot the next frame is taken through, and does nothing when the search ran on
// the installed path.
//
// The block always undoes its own filter change, on the exits that failed as much as on the one that focused.
// The runner leaves the focuser on the position it started from when it finds no focus, so a wheel left on
// the autofocus filter would make the two describe different paths: the frame preparation that runs next
// derives the focus shift from the slot the wheel is standing at, and under a `continue` policy the science
// frames that follow would be taken with an offset applied on top of a focus that never moved.
//
// The result is returned because every exit has to know whether the wheel came back, and it is the caller
// that decides what a wheel left behind means for the failure it was already reporting.
async function restoreFrameFilter(services: SequencerAutofocusServices, context: SequencerActionContext, transition: { readonly wheel: Wheel; readonly installedSlot: number } | undefined) {
	if (transition === undefined) return successfulOperationResult(undefined)

	context.progress({ detail: 'restoring the frame filter' })

	return await services.wheelCommander.moveTo(context.scope, transition.wheel, transition.installedSlot)
}

// Puts the focuser back on the position the block found it at and reports the failure that asked for it.
//
// The wheel is already back on the frame filter by then, so a focuser left on the offset of the autofocus
// filter — the one applied before the search or the one measured by it — leaves the two describing different
// paths, and nothing downstream repairs it: the frame preparation derives its shift from the slot the wheel
// stands on, which did not change. Under a `continue` policy the frames taken after the retries ran out would be exposed out of
// focus by exactly the offset between the two filters. The position the frame filter was already focused at is
// the state the block started from, so restoring it leaves the retry the same run to make.
//
// A restore that does not land is terminal instead: nothing records the focus the night was using, so no later
// step can reconstruct it, and offering a retry from a focus nobody knows is worse than stopping.
async function restoreFrameFocus(services: SequencerAutofocusServices, context: SequencerActionContext, focuser: Focuser, initialPosition: number, failure: SequencerActionResult<SequencerAutofocusOutcome>): Promise<SequencerActionResult<SequencerAutofocusOutcome>> {
	if (focuser.position.value === initialPosition) return failure

	context.progress({ detail: `restoring the focus of the frame filter at position ${initialPosition}` })

	const restored = await services.focuserCommander.moveTo(context.scope, focuser, initialPosition)

	if (restored.ok || focuser.position.value === initialPosition) return failure

	return { type: 'fatalFailure', reason: restored.reason, detail: `the focuser did not return to the focus of the frame filter${restored.error === undefined ? '' : `: ${restored.error}`}` }
}

// Undoes what a failing exit left of the optical path and reports the failure that asked for it.
//
// The block moves both halves of the path to focus through another filter — the wheel to the autofocus slot and
// the focuser by the offset between the two — so an exit that reports no focus has to give both back or the
// frames that follow are exposed through one filter with the focus of the other. The wheel is answered first,
// because a wheel that stayed behind is terminal on its own and the focus of a path the session no longer knows
// is not worth commanding.
async function strandedFrameOptics(
	services: SequencerAutofocusServices,
	context: SequencerActionContext,
	focuser: Focuser,
	initialPosition: number,
	transition: { readonly wheel: Wheel; readonly installedSlot: number } | undefined,
	restored: OperationResult<unknown>,
	failure: SequencerActionResult<SequencerAutofocusOutcome>,
): Promise<SequencerActionResult<SequencerAutofocusOutcome>> {
	const stranded = strandedFrameFilter(failure, restored, transition)
	return stranded.type === 'fatalFailure' ? stranded : await restoreFrameFocus(services, context, focuser, initialPosition, stranded)
}

// Escalates a failing exit to a terminal one when the restore left the wheel on the autofocus filter.
//
// Nothing durable records the slot the block came from, so a retry would read the wheel as it stands and
// compute no transition at all: it would restore nothing, and the frames after it would be exposed through the
// search filter while the focus offsets are measured against the one the session believes is installed.
// Offering that retry is worse than stopping, so it is refused. The failure is returned untouched when the
// wheel is standing where it belongs — a refused move that changed nothing — or when it is already fatal,
// since an abort explains the run better than the wheel does.
function strandedFrameFilter<T>(failure: SequencerActionResult<T>, restored: OperationResult<unknown>, transition: { readonly wheel: Wheel; readonly installedSlot: number } | undefined): SequencerActionResult<T> {
	if (restored.ok || transition === undefined || transition.wheel.position === transition.installedSlot) return failure
	if (failure.type === 'fatalFailure') return failure

	return { type: 'fatalFailure', reason: restored.reason, detail: `the wheel did not return to the frame filter${restored.error === undefined ? '' : `: ${restored.error}`}` }
}

// Slot the search is performed through, or undefined when the recipe names no filter of its own or names one
// this wheel does not carry. In both cases the search happens on the path that is already installed.
function focusThroughSlot(wheel: Wheel | undefined, configuration: SequencerAutofocusTrigger) {
	if (wheel === undefined || configuration.capture.filter === undefined) return undefined
	return sequencerFilterSlot(wheel, configuration.capture.filter)
}

// Narrows a stored autofocus configuration and refuses it when a role it commands is not part of the session.
//
// The configuration is what the compiler emitted and is taken as such; the roles are re-checked, because a
// definition can be edited to drop the focuser after the block that needs it was lowered, and finding that out
// at the first command means finding it out in the middle of the night.
function validateAutofocus(configuration: unknown, context: SequencerValidationContext): SequencerValidationResult<SequencerAutofocusTrigger> {
	const issues = (['camera', 'focuser'] as const).filter((role) => context.devices[role] === undefined).map((role) => ({ path: `devices.${role}`, message: `the ${role} is required to autofocus` }))
	return issues.length > 0 ? { ok: false, issues } : { ok: true, configuration: configuration as SequencerAutofocusTrigger }
}
