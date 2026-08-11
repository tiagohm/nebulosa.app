import type { Sequencer } from '#/sequencer'
import { response } from './http'
import type { Endpoints } from './http'
import { validate } from './sequencer.preflight'

// HTTP surface of the Sequencer. It exposes the pre-flight view of a definition: the endpoint an editor
// calls while the operator types, before any session exists. The session endpoints of the same surface
// arrive with the session service; this one deliberately depends on nothing but the compiler, which is what
// makes it safe to call on every edit.

export class SequencerHandler {
	// Lowers a definition and returns its pre-flight view: the diagnostics that refuse it, the fields
	// removed from the executable plan, and the slots, limits and projected integration of every group.
	// No session is created and no device is reserved.
	validate(definition: Sequencer) {
		return validate(definition)
	}
}

export function sequencer(handler: SequencerHandler) {
	return {
		'/sequencer/definitions/validate': { POST: async (req) => response(handler.validate((await req.json()) as Sequencer)) },
	} as const satisfies Endpoints
}
