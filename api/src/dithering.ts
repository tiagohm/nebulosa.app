import { failedOperationResult, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { type DitherAmount, type DitherPhase, settleOnAbort } from 'nebulosa/src/observation/guiding/ditherer'
import type { GuidingSettle } from 'nebulosa/src/observation/guiding/session'
import { type CommandErrorCode, type CommandRefusal, refusal } from './commands'
import type { GuidingSessions } from './guiding'

// Automatic dithering of Camera Acquisition: the preflight, the device coordination, and the execution of the dithers a
// capture asks for between its frames, by the method its request names and never another. The capture owns the
// cadence (which frame boundary dithers, see ditherBoundary); this service owns how each dither runs, and what the
// capture holds for it from its admission to its end. Guided dithers are commands of the running native guiding
// session, whose dither commands the capture claims for its whole life (GuidingSessions.claimDither), so no other dither
// shifts the lock meanwhile; each resolves with the outcome of that exact command, once the guider settled. Nothing
// physical is held for them: the guider finishes its own settle after a stop or an abort. A failed dither ends the
// capture: there is no fallback to another method and no skipped dither. Guided amounts are guide-camera pixels and
// settle tolerances guide pixels, settle times seconds.

// Automatic dither of a capture through the guiding session that guides its setup.
export interface GuidedCaptureDither {
	readonly method: 'guided'
	// Frames taken between two dithers, an integer >= 1.
	readonly everyFrames: number
	// Id of the living native guiding session the dithers are commanded to; it must be guiding.
	readonly guidingSessionId: string
	// Size of each dither, in guide-camera pixels or as an angle in radians.
	readonly amount: DitherAmount
	// Whether each dither moves the RA axis only.
	readonly raOnly: boolean
	// Guided settle each dither waits for: guide error within pixels (guide pixels) for time seconds, at most timeout
	// seconds.
	readonly settle: GuidingSettle
}

// Automatic dither of a capture, by the method it names; absent from a request, the capture never dithers.
export type CaptureDither = GuidedCaptureDither

// Dithers a capture prepared, from its admission to its end.
export interface CaptureDitherPlan {
	readonly ok: true
	// Frames taken between two dithers, an integer >= 1.
	readonly everyFrames: number
	// Dithers once and resolves after the settle, or with the failure that must end the capture; never rejects. token
	// identifies this dither, so a repeated boundary never dithers twice. An abort of signal resolves at once with its
	// reason, while whatever moves is left to finish draining it. onPhase reports the progress synchronously.
	readonly dither: (token: string, signal: AbortSignal, onPhase: (phase: DitherPhase) => void) => Promise<OperationResult<void>>
	// Drains what a dither may still move and gives back what the capture held for its dithers. Idempotent; never rejects.
	readonly finish: () => Promise<void>
}

// Refusal codes of a dither preflight besides the command codes: notGuiding, the guiding session is not guiding.
export type CaptureDitherErrorCode = 'notGuiding'

// Outcome of preparing the dithers of a capture: its plan, or why the capture is refused.
export type CaptureDitherPreparation = CaptureDitherPlan | CommandRefusal<CommandErrorCode | CaptureDitherErrorCode>

// Guiding sessions as the dithering service uses them.
export type CaptureDitheringGuiding = Pick<GuidingSessions, 'summaryOf' | 'claimDither'>

// Name the dithering service holds guiding commands under, meant for people.
const HOLDER = 'Camera Acquisition'

// Whether the frame opening generation (the first frame is 1) is preceded by a dither of a capture dithering every
// everyFrames frames: never before the first frame, then before every frame that follows everyFrames frames taken.
export function ditherBoundary(generation: number, everyFrames: number) {
	return generation > 1 && (generation - 1) % everyFrames === 0
}

// Dithering service of the camera captures.
export class CaptureDithering {
	// Creates the service over the guiding sessions the guided dithers are commanded to.
	constructor(readonly guiding: CaptureDitheringGuiding) {}

	// Prepares the dithers of a capture before it is admitted: checks the method can dither now and takes what the capture
	// holds for its dithers. Synchronous, so nothing changes between the checks and the admission. Refused with 404 for an
	// unknown or ended guiding session, 409 notGuiding while it is not guiding, and 409 busy while another claimant holds
	// its dithers.
	prepare(dither: CaptureDither): CaptureDitherPreparation {
		return this.#guided(dither)
	}

	// Prepares guided dithers: the session must be guiding, and its dither commands are claimed until finish.
	#guided({ everyFrames, guidingSessionId, amount, raOnly, settle }: GuidedCaptureDither): CaptureDitherPreparation {
		const summary = this.guiding.summaryOf(guidingSessionId)
		if (!summary) return refusal('No guiding session is running with this id', 404, 'notFound')
		if (summary.state !== 'guiding') return refusal(`${summary.cameraName} is not guiding`, 409, 'notGuiding')

		const claim = this.guiding.claimDither(guidingSessionId, HOLDER)
		if (!claim.ok) return claim

		return {
			ok: true,
			everyFrames,
			dither: async (token, signal, onPhase) => {
				onPhase('dithering')
				const admitted = claim.admitDither({ token, amount, raOnly, settle })
				if (!admitted.ok) return failedOperationResult(admitted.code === 'busy' ? 'busy' : 'unexpectedState', `Dither failed: ${admitted.error}`)

				const settled = admitted.settled.then((status): OperationResult<void> => (status.state === 'succeeded' ? successfulOperationResult(undefined) : failedOperationResult(status.reason ?? 'commandFailed', `Dither failed: ${status.error ?? status.reason ?? 'the guider did not settle'}`)))
				const result = await settleOnAbort(settled, signal)
				if (result.ok) onPhase('settled')
				return result
			},
			finish: () => {
				claim[Symbol.dispose]()
				return Promise.resolve()
			},
		}
	}
}
