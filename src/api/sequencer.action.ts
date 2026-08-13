import type { Device } from 'nebulosa/src/devices/indi/device'
import type { FailedOperationResult, OperationResult } from '#/orchestration'
import type { SequencerDeviceRole } from '#/sequencer'
import { abortableDelay } from './operation.wait'
import type { SequencerActionContext, SequencerActionResult } from './sequencer.registry'

// Shared vocabulary of the executable blocks: how a device command failure becomes a session decision, how a
// declared role becomes the narrowed device the block commands, and how a declared settle becomes a wait.
//
// A block handler is the seam between two error models. Below it, a commander answers with an
// `OperationResult`, which says whether one device command worked; above it, the runtime expects a
// `SequencerActionResult`, which says what the session should do next. Every handler makes the same
// translation, so it is made once here instead of once per block.
//
// Durations declared by a definition are seconds; every duration handed to a commander is milliseconds.

// Turns a failed device command into the decision the runtime acts on.
//
// Only two causes are terminal. `aborted` means the session itself is stopping, so retrying would fight the
// stop that produced it, and `removed` means the device is gone, which no retry of the same node can undo.
// Everything else — a timeout, an Alert, a driver that refused, a resource momentarily busy — is a transient
// condition of the observatory, and whether it is worth another attempt is the retry policy's decision rather
// than the handler's.
export function sequencerActionFailure(result: FailedOperationResult, detail?: string): SequencerActionResult<never> {
	const type = result.reason === 'aborted' || result.reason === 'removed' ? 'fatalFailure' : 'retryableFailure'
	return { type, reason: result.reason, detail: detail === undefined ? result.error : result.error === undefined ? detail : `${detail}: ${result.error}` }
}

// Reports a block that cannot run at all because the role it commands is not part of the session.
//
// This is fatal rather than retryable: the roles of a session are fixed when it starts, so the same node would
// find the same absence on every attempt. It is reached only through a defect — the compiler refuses a
// definition whose block commands an undeclared role, and the runtime refuses a session whose roles do not
// resolve — which is why it names the role instead of describing a device problem.
export function sequencerMissingRole(role: SequencerDeviceRole): SequencerActionResult<never> {
	return { type: 'fatalFailure', reason: 'unexpectedState', detail: `the ${role} role is not available to this session` }
}

// Narrows the device answering for one role, or undefined when the session does not have it.
//
// The guard is the same interface check the resolution already applied, so it only restates what the
// reservation guarantees; it is repeated here because the request carries a `Device` and the commander needs
// the concrete interface.
export function sequencerDeviceOf<T extends Device>(context: SequencerActionContext, role: SequencerDeviceRole, is: (device: Device) => device is T): T | undefined {
	const device = context.request(role)?.device
	return device !== undefined && is(device) ? device : undefined
}

// Waits out a declared settling time, in seconds, interruptible by the action's own cancellation.
//
// A settle of zero still goes through the timer, which costs one turn of the loop and keeps a single path for
// the cancellation the caller has to observe either way.
export function sequencerSettle(context: SequencerActionContext, seconds: number): Promise<OperationResult<void>> {
	return abortableDelay(seconds * 1000, context.signal)
}
