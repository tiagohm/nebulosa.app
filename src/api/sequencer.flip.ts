import { isMount } from 'nebulosa/src/devices/indi/device'
import type { Mount, MountTargetCoordinate, PierSide } from 'nebulosa/src/devices/indi/device'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { sequencerActionFailure, sequencerDeviceOf, sequencerMissingRole, sequencerSettle } from './sequencer.action'
import { SEQUENCER_BLOCK_TYPE } from './sequencer.compiler'
import type { SequencerMeridianFlipTrigger } from './sequencer.compiler'
import { runAutofocus } from './sequencer.focus'
import type { SequencerAutofocusOutcome, SequencerAutofocusServices } from './sequencer.focus'
import { runCentering } from './sequencer.pointing'
import type { SequencerCenteringServices, SequencerCenterOutcome } from './sequencer.pointing'
import type { ResourceBinding, SequencerActionContext, SequencerActionHandler, SequencerActionResult, SequencerValidationContext, SequencerValidationResult } from './sequencer.registry'

// The meridian flip as a safe-point action: the mount changes sides, and everything the crossing invalidated is
// re-established before the next frame is exposed.
//
// The flip is the first step of a safe point because it invalidates what every step after it assumes. Pointing
// is gone — the same sky coordinate is reached with the tube on the other side of the pier — and focus may be
// gone with it, since the optical train hangs the other way around. So this block runs the crossing, then the
// recentering and the refocusing the definition asked for, in that order, under the same node and the same
// reservation.
//
// What this block does not do is suspend and resume guiding. That is the interlock bracket of the safe point,
// which is single for the whole safe point and pays one settle for every step that moves pointing, focus or
// angle; a flip that suspended guiding on its own would pay a second one. The outcome reports the crossing so
// the bracket can decide whether the resume also has to recalibrate, which after a flip is the one case where
// the calibration really is invalid: the declination axis now moves the star the other way.
//
// Angles are radians and the declared settle and timeout are seconds.

// What one crossing left behind, including what it re-established afterwards.
export interface SequencerMeridianFlipOutcome {
	// Pier side the mount reports once it has stopped, NEITHER when the driver publishes none.
	readonly pierSide: PierSide
	// Pier side observed immediately before the crossing was commanded.
	readonly initialPierSide: PierSide
	// True only when the driver publishes a pier side on both ends and it actually changed, which is the only
	// evidence that the mount mechanically changed sides rather than only slewing.
	readonly verified: boolean
	// Right ascension in radians, in the equinox of date, the mount stopped at.
	readonly rightAscension: Angle
	// Declination in radians, in the equinox of date, the mount stopped at.
	readonly declination: Angle
	// Outcome of the recentering, absent when the flip does not recenter.
	readonly centering?: SequencerCenterOutcome
	// Outcome of the refocusing, absent when the flip does not focus.
	readonly focusing?: SequencerAutofocusOutcome
}

// Collaborators the flip commands: its own mount movement, plus everything the recentering and the refocusing
// need, since both run under this node instead of as steps of their own.
export interface SequencerMeridianFlipServices extends SequencerCenteringServices, SequencerAutofocusServices {}

// Handler version of the meridian-flip block. It changes whenever the meaning of its configuration or of its
// execution changes, which refuses a session compiled against the older meaning instead of running it here.
const SEQUENCER_FLIP_VERSION = 1

// Where the mount is pointing right now, as the target of the crossing.
//
// The flip re-points at the coordinate the mount itself reports, in the equinox of date it reports it in, which
// is the pointing the session was already keeping. It is deliberately not the target of the plan: a session
// whose pointing has drifted, or that was centered onto an offset field, must come back to where it actually
// was and not to where it started the night. Restoring the pointing accurately is the recentering's job.
function currentTarget(mount: Mount): MountTargetCoordinate<Angle> {
	return { type: 'JNOW', JNOW: { x: mount.equatorialCoordinate.rightAscension, y: mount.equatorialCoordinate.declination } }
}

// Meridian-flip block: crosses the meridian and re-establishes pointing and focus on the other side.
export function sequencerMeridianFlipHandler(services: SequencerMeridianFlipServices): SequencerActionHandler<SequencerMeridianFlipTrigger, SequencerMeridianFlipOutcome> {
	return {
		type: SEQUENCER_BLOCK_TYPE.meridianFlip,
		version: SEQUENCER_FLIP_VERSION,
		validate: (configuration, context) => validateMeridianFlip(configuration, context),
		resources: (configuration) => flipResources(configuration),
		execute: (context, configuration) => runMeridianFlip(services, context, configuration),
	}
}

// Roles the flip commands, which are the roles of everything it runs.
//
// The recentering exposes and solves, so it needs the camera; the refocusing needs the camera and the focuser.
// Declaring them here is what puts them in the reservation set of the session, so a flip never finds a device
// it is about to need held by something else.
//
// The recovery it nests is the same code the standalone blocks run, so the wheel a centering or an autofocus
// recipe names a filter for has to be declared here too: a role this list omits is a device those blocks never
// receive, and they would recover through the installed path while the definition asked for another one.
function flipResources(configuration: SequencerMeridianFlipTrigger): ResourceBinding[] {
	const roles: ResourceBinding[] = [{ role: 'mount' }]

	if (configuration.centering !== undefined || configuration.focusing !== undefined) roles.push({ role: 'camera' })
	if (configuration.focusing !== undefined) roles.push({ role: 'focuser' })
	if (configuration.centering?.capture.filter !== undefined || configuration.focusing?.capture.filter !== undefined) roles.push({ role: 'wheel', optional: true })

	return roles
}

// Runs one meridian flip at a safe point: the crossing, the settle, and the recovery the definition declared.
export async function runMeridianFlip(services: SequencerMeridianFlipServices, context: SequencerActionContext, configuration: SequencerMeridianFlipTrigger): Promise<SequencerActionResult<SequencerMeridianFlipOutcome>> {
	const mount = sequencerDeviceOf(context, 'mount', isMount)

	if (mount === undefined) return sequencerMissingRole('mount')

	context.progress({ detail: 'flipping the mount' })

	const flipped = await services.mountCommander.flip(context.scope, mount, currentTarget(mount), { timeout: configuration.timeout * 1000 })

	if (!flipped.ok) return sequencerActionFailure(flipped, 'the mount did not cross the meridian')

	// A driver that publishes no pier side still performs the movement, and the definition decides what that is
	// worth. Demanding the verification and not getting it is a failure of the flip and not of the mount: the
	// session cannot tell a crossing apart from a slew that went back to the same side, and every frame after
	// it would be exposed on an unknown side of the pier.
	if (configuration.verifyPierSide && !flipped.value.pierSideVerified) {
		return { type: 'retryableFailure', reason: 'unexpectedState', detail: `the mount did not confirm a pier side change, reporting ${flipped.value.pierSide}` }
	}

	const settled = await sequencerSettle(context, configuration.settle)

	if (!settled.ok) return sequencerActionFailure(settled, 'the settle after the flip was interrupted')

	const outcome: SequencerMeridianFlipOutcome = {
		pierSide: flipped.value.pierSide,
		initialPierSide: flipped.value.initialPierSide,
		verified: flipped.value.pierSideVerified,
		rightAscension: flipped.value.rightAscension,
		declination: flipped.value.declination,
	}

	// The recovery runs in the order the safe point runs it outside a flip: the pointing first, because the
	// focus routine assumes the field it is going to measure, and the focus after it.
	if (configuration.centering !== undefined) {
		const centered = await runCentering(services, context, configuration.centering)

		if (centered.type !== 'completed') return crossed(centered)

		return await refocus(services, context, configuration, { ...outcome, centering: centered.value })
	}

	return await refocus(services, context, configuration, outcome)
}

// Reports a recovery failure of a flip whose crossing already happened, refusing to let it be retried.
//
// A retry re-executes the whole node, and the first thing the node does is command the crossing again. The
// mount is already on the other side by then, so the second crossing takes it back to the side the flip
// existed to leave — and with the hour angle now past the meridian, that is the side the mount cannot track
// on. Nothing durable records that the crossing succeeded, so the retry has no way to start at the recovery,
// and the recentering and the autofocus have already spent their own attempts internally before answering.
//
// The failure is therefore made terminal: the session stops with the mount safely on the post-flip side
// instead of being sent back across it. A failure that is already fatal passes through untouched, and so does
// anything that is not a failure.
function crossed(result: SequencerActionResult<never>): SequencerActionResult<never> {
	if (result.type !== 'retryableFailure') return result

	return { type: 'fatalFailure', reason: result.reason, detail: result.detail === undefined ? 'the mount had already crossed the meridian' : `${result.detail}, with the mount already across the meridian` }
}

// Runs the refocusing of a flip, or returns the outcome unchanged when the flip does not focus.
//
// A flip that fails to refocus is reported as the failure it is rather than as a flip that completed: the
// crossing already happened, but the anchor of the trigger must not move on a recovery that did not finish,
// or the session would keep exposing through a focus the flip itself invalidated. It is reported through
// `crossed` for the same reason the recentering is: the crossing is not repeatable.
async function refocus(services: SequencerMeridianFlipServices, context: SequencerActionContext, configuration: SequencerMeridianFlipTrigger, outcome: SequencerMeridianFlipOutcome): Promise<SequencerActionResult<SequencerMeridianFlipOutcome>> {
	if (configuration.focusing === undefined) return { type: 'completed', value: outcome }

	const focused = await runAutofocus(services, context, configuration.focusing)

	if (focused.type !== 'completed') return crossed(focused)

	return { type: 'completed', value: { ...outcome, focusing: focused.value } }
}

// Narrows a stored flip configuration and refuses it when a role the recovery commands is not part of the
// session.
//
// The mount is always required, and the camera and the focuser only when the flip recenters or refocuses: a
// definition can be edited to drop the focuser after the flip that refocuses was lowered, and finding that out
// at the first crossing means finding it out in the middle of the night, with the mount already on the other
// side.
//
// Only the mandatory bindings are demanded. The wheel is bound as optional precisely so a rig without one
// recovers through the installed path instead of refusing, and requiring it here would refuse the whole
// session at validation for the device the binding exists to do without.
function validateMeridianFlip(configuration: unknown, context: SequencerValidationContext): SequencerValidationResult<SequencerMeridianFlipTrigger> {
	const flip = configuration as SequencerMeridianFlipTrigger
	const issues = flipResources(flip)
		.filter((binding) => binding.optional !== true && context.devices[binding.role] === undefined)
		.map((binding) => ({ path: `devices.${binding.role}`, message: `the ${binding.role} is required to flip across the meridian` }))

	return issues.length > 0 ? { ok: false, issues } : { ok: true, configuration: flip }
}
