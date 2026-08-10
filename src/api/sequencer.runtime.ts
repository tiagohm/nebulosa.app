// Session admission and bootstrap reversal for the sequencer runtime.
//
// "One active session per process" is a declared constraint, and a declared constraint without a mechanism
// is a race: two concurrent starts can both observe that nothing is running and both succeed. The resource
// arbiter does not cover it, because two sessions over disjoint devices reserve without conflicting, and the
// per-session intent queue does not either, because the race is global.
//
// The claim is deliberately distinct from the reservation: the reservation protects devices, the claim
// protects the single-session invariant, which holds even when two definitions share no device at all. When
// the constraint eventually becomes a configurable limit of simultaneous sessions, only this gate changes.

// Why an admission request was not granted a claim.
// - busy: another session holds the claim; its id is reported so the caller can say which one.
export type SessionAdmissionRefusal = 'busy'

// Process-wide claim of the single active session slot, released once the session is fully torn down.
export interface SessionClaim {
	// Session holding the claim.
	readonly sessionId: string
	// Releases the claim. Idempotent, and inert once another session has already been admitted.
	readonly release: VoidFunction
}

// Outcome of asking for admission.
// - admitted: the caller now owns the claim and must bootstrap the session.
// - reentrant: this same session already holds the claim, so the caller returns the current snapshot and
//   starts nothing. It deliberately carries no claim: a second start must not be able to release the first.
// - refused: another session holds the claim.
export type SessionAdmission = { readonly ok: true; readonly kind: 'admitted'; readonly claim: SessionClaim } | { readonly ok: true; readonly kind: 'reentrant'; readonly sessionId: string } | { readonly ok: false; readonly kind: 'refused'; readonly reason: SessionAdmissionRefusal; readonly sessionId: string }

// Live claim, kept by identity so a stale `release` cannot revoke a later session's claim.
interface ClaimRecord {
	// Session holding the slot.
	readonly sessionId: string
	// Set by the first release, making further releases inert.
	released: boolean
}

// Gate serializing session starts within the process.
export class SessionAdmissionGate {
	#claim?: ClaimRecord

	// Session currently holding the claim, or undefined when the process is admissible.
	get sessionId() {
		return this.#claim?.sessionId
	}

	// Claims the session slot.
	//
	// The whole decision is synchronous — there is no `await` between the test and the mark — which is what
	// makes it a gate on a single-threaded runtime. Callers must therefore claim before resolving roles and
	// before creating the reservation, since both of those suspend.
	//
	// A refusal is immediate and names the holder; the caller never waits for the slot.
	claim(sessionId: string): SessionAdmission {
		const claim = this.#claim

		if (claim !== undefined) {
			return claim.sessionId === sessionId ? { ok: true, kind: 'reentrant', sessionId } : { ok: false, kind: 'refused', reason: 'busy', sessionId: claim.sessionId }
		}

		const record: ClaimRecord = { sessionId, released: false }
		this.#claim = record

		return {
			ok: true,
			kind: 'admitted',
			claim: {
				sessionId,
				release: () => {
					if (record.released) return

					record.released = true

					// Only the record still installed is cleared. Releasing a claim the gate already moved past
					// would silently evict whichever session was admitted afterwards.
					if (this.#claim === record) this.#claim = undefined
				},
			},
		}
	}
}

// Ordered undo steps of a session bootstrap.
//
// Bootstrap acquires the claim, resolves roles, creates the reservation, and opens the scope, and any of
// those can fail after the previous ones succeeded. Unwinding in reverse order is what leaves the process
// admissible again instead of holding a claim over a session that never started.
//
// The same list is the teardown sequence of a session that did start: finalization runs the scope cleanups,
// releases the reservation, and releases the claim last, in the exact reverse of how they were acquired.
// The claim is released only there, never on reaching a terminal state, which still has work behind it.
export class SessionTeardown {
	readonly #steps: VoidFunction[] = []

	// Steps still pending.
	get size() {
		return this.#steps.length
	}

	// Records an undo step for a bootstrap stage that just succeeded.
	add(step: VoidFunction) {
		this.#steps.push(step)
	}

	// Runs every pending step in reverse order and empties the list, so a second call is inert.
	//
	// A step that throws never skips the ones behind it: giving up halfway would leak the reservation or the
	// claim precisely when the process is already in a bad state. Failures are reported through `onError`.
	run(onError?: (error: unknown) => void) {
		for (let i = this.#steps.length - 1; i >= 0; i--) {
			try {
				this.#steps[i]()
			} catch (e) {
				onError?.(e)
			}
		}

		this.#steps.length = 0
	}
}
