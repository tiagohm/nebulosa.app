import type { PHD2Settle } from 'nebulosa/src/devices/guiding/phd2'
import type { SequencerGuiderSettle } from '#/sequencer'
import type { GuiderCommander } from './guider.session'
import { sequencerActionFailure } from './sequencer.action'
import type { SequencerDitherTrigger } from './sequencer.compiler'
import { SEQUENCER_BLOCK_TYPE } from './sequencer.compiler'
import type { SequencerActionContext, SequencerActionHandler, SequencerActionResult, SequencerValidationContext, SequencerValidationResult } from './sequencer.registry'

// Guiding as the capture loop uses it: the dither taken at a safe point, before the exposure that follows it.
//
// A dither is a command to the guider and not to a device of the session, so it takes no role and holds no
// lease: the guiding session already owns the guide camera and the guide output, and the sequencer commands
// it through the session that was connected before start. What the block owns is the decision of what to do
// when there is nothing to dither, which is to skip rather than to fail — a session guiding through nothing
// is a session that was configured that way, not one whose guider misbehaved.
//
// The settle of a dither is established on the guiding session rather than passed per command, because the
// guider settles by its own telemetry and the parameters are part of how it guides. Only the time this block
// is willing to wait is passed here.
//
// Displacements are guider pixels and the declared settle is seconds.

// What one dither commanded and settled for. The guider reports its terminal settle and not the displacement
// it ended up applying, so what is recorded here is what was asked of it.
export interface SequencerDitherOutcome {
	// Displacement requested, in guider pixels.
	readonly amount: number
	// Whether the movement was restricted to right ascension.
	readonly raOnly: boolean
	// Guiding session that took the dither.
	readonly guider: string
}

// Collaborators the dither block commands.
export interface SequencerGuidingServices {
	// Owner of every guiding session, including the one the sequencer commands.
	readonly guiderCommander: GuiderCommander
}

// Handler version of the dither block. It changes whenever the meaning of its configuration or of its
// execution changes, which refuses a session compiled against the older meaning instead of running it here.
const SEQUENCER_GUIDING_VERSION = 1

// Translates a declared settle into the settle the guider transport understands.
//
// The tolerance is guider pixels on both sides, and the time and the timeout are seconds on both sides, so
// only the names change.
export function sequencerGuiderSettle(settle: SequencerGuiderSettle): PHD2Settle {
	return { pixels: settle.tolerance, time: settle.time, timeout: settle.timeout }
}

// Strongest guiding settle of one safe point: the session policy, raised to any wall-clock settle that
// also has to be paid here — typically the meridian flip's. The interlock resume is the one wait the
// safe point takes for all of them, so the longer time and the longer timeout win and the others are
// dropped.
export function fuseGuidingSettle(base: SequencerGuiderSettle, extra?: number): SequencerGuiderSettle {
	if (extra === undefined || extra <= 0) return base

	return { ...base, time: Math.max(base.time, extra), timeout: Math.max(base.timeout, extra) }
}

// Dither block: displaces the guide star and returns only once the guider has settled again.
export function sequencerDitherHandler(services: SequencerGuidingServices): SequencerActionHandler<SequencerDitherTrigger, SequencerDitherOutcome> {
	return {
		type: SEQUENCER_BLOCK_TYPE.dither,
		version: SEQUENCER_GUIDING_VERSION,
		validate: (configuration, context) => validateDither(configuration, context),
		resources: () => [],
		execute: (context, configuration) => runDither(services, context, configuration),
	}
}

// Runs one dither at a safe point, or reports why there was nothing to dither.
//
// It is exported because the guiding interlock emits the dither together with the resume it already pays a
// settle for, rather than as a step of its own after a second one.
export async function runDither(services: SequencerGuidingServices, context: SequencerActionContext, configuration: SequencerDitherTrigger): Promise<SequencerActionResult<SequencerDitherOutcome>> {
	const { guider } = context

	if (guider === undefined) return { type: 'skipped', detail: 'the session guides through no guider' }

	// A guider that is connected but not guiding has no lock to displace, and the command would be refused by
	// the transport with the same information this already has. The session is unguided at this instant by
	// configuration or by a recovery still in progress, and neither is this block's failure to report.
	if (!services.guiderCommander.running(guider)) return { type: 'skipped', detail: 'the guider is not guiding' }

	context.progress({ detail: 'dithering' })

	const dithered = await services.guiderCommander.dither(
		guider,
		{ amount: configuration.amount, raOnly: configuration.raOnly },
		{
			signal: context.signal,
			// The guider is given the settle its own session was configured with; this is only how long the
			// session is willing to stand still for it before treating the dither as failed.
			timeout: configuration.settle.timeout * 1000,
			onPhase: (phase) => context.progress({ detail: `dither ${phase}` }),
		},
	)

	if (!dithered.ok) return sequencerActionFailure(dithered, 'the dither did not settle')

	return { type: 'completed', value: { amount: configuration.amount, raOnly: configuration.raOnly, guider } }
}

// Narrows a stored dither configuration.
//
// There is no role to re-check: the dither commands the guiding session and not a device of the definition,
// and whether that session exists is decided when the sequencer session starts rather than when it compiles.
function validateDither(configuration: unknown, _context: SequencerValidationContext): SequencerValidationResult<SequencerDitherTrigger> {
	return { ok: true, configuration: configuration as SequencerDitherTrigger }
}
