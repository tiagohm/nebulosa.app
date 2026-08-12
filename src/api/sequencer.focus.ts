import { isCamera, isFocuser, isWheel } from 'nebulosa/src/devices/indi/device'
import type { Wheel } from 'nebulosa/src/devices/indi/device'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import type { AutoFocusStart } from '#/autofocus'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { SequencerAutofocus, SequencerAuxiliaryCapture, SequencerStarDetection } from '#/sequencer'
import type { AutoFocusRunner } from './autofocus.runner'
import type { FocuserCommander } from './focuser.commander'
import { sequencerActionFailure, sequencerDeviceOf, sequencerMissingRole, sequencerSettle } from './sequencer.action'
import { SEQUENCER_BLOCK_TYPE } from './sequencer.compiler'
import { sequencerFilterSlot, sequencerFocusOffsetShift } from './sequencer.optics'
import type { SequencerActionContext, SequencerActionHandler, SequencerActionResult, SequencerValidationContext, SequencerValidationResult } from './sequencer.registry'
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

// Extension of every auxiliary frame, which is the container the sequencer asks the camera to transfer.
const SEQUENCER_AUXILIARY_EXTENSION = 'fits'

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

// Autofocus block: focuses through the declared path and leaves the focuser where the next frame needs it.
export function sequencerAutofocusHandler(services: SequencerAutofocusServices): SequencerActionHandler<SequencerAutofocusTrigger, SequencerAutofocusOutcome> {
	return {
		type: SEQUENCER_BLOCK_TYPE.autofocus,
		version: SEQUENCER_FOCUS_VERSION,
		validate: (configuration, context) => validateAutofocus(configuration, context),
		resources: () => [{ role: 'camera' }, { role: 'focuser' }],
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
	// Slot the frame about to be exposed will be taken through, which is the one the wheel is already on: the
	// preparation of the frame runs after this block, so what is installed now is what the offsets are
	// measured back to.
	const installedSlot = wheel?.position
	const focusSlot = focusThroughSlot(wheel, configuration)

	if (wheel !== undefined && focusSlot !== undefined && focusSlot !== installedSlot) {
		context.progress({ detail: 'moving to the autofocus filter' })

		const moved = await services.wheelCommander.moveTo(context.scope, wheel, focusSlot)

		if (!moved.ok) return sequencerActionFailure(moved, 'the wheel did not reach the autofocus filter')
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

	const { handle } = services.runner.start(context.scope, camera, focuser, request, () => context.auxiliary('autofocus', SEQUENCER_AUXILIARY_EXTENSION))
	const result = await handle.result

	if (!result.ok) return sequencerActionFailure(result, 'the autofocus search failed')

	// The search reports a curve it could not fit as a successful operation, because no device misbehaved. For
	// the session it is still a run that produced no focus, and treating it as completed would advance the
	// anchor and silence the condition that asked for the run until it came back on its own.
	if (result.value.outcome !== 'focused') {
		return { type: 'retryableFailure', reason: 'unexpectedState', detail: `the autofocus found no focus: ${result.value.message}` }
	}

	const measured = result.value.position
	let position = measured

	// The wheel goes back before the offset is applied, so the position the action reports is the one the
	// installed path is standing at rather than one that assumes a move still to come.
	if (wheel !== undefined && focusSlot !== undefined && focusSlot !== installedSlot && installedSlot !== undefined) {
		context.progress({ detail: 'restoring the frame filter' })

		const restored = await services.wheelCommander.moveTo(context.scope, wheel, installedSlot)

		if (!restored.ok) return sequencerActionFailure(restored, 'the wheel did not return to the frame filter')

		const shift = sequencerFocusOffsetShift(wheel, configuration.filterOffsets, focusSlot, installedSlot)

		if (shift !== 0) {
			position = measured + shift

			const moved = await services.focuserCommander.moveTo(context.scope, focuser, position)

			if (!moved.ok) return sequencerActionFailure(moved, 'the focuser did not accept the filter offset')

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
