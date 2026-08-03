import type { Notification, Severity } from '#/notification'
import type { OperationFailureReason, OperationResult } from '#/orchestration'
import type { NotificationHandler } from './notification'

// Browser notifications for coordinated operations that fail where nothing else can report it.
// A command whose physical effect outlasts its request answers before the device has done anything, and a
// refused one moves nothing at all, so it emits no device update either: without a notification the user
// would see the action silently discarded. Messages go over the same WebSocket channel the rest of the API
// already notifies through. The reason is what the user reads; the detail carried by a failure is
// diagnostic, often a resource key and an operation id, and stays in the log.

// User-facing sentence per terminal failure reason, completing "<device> could not <action>: ".
const FAILURE_DESCRIPTIONS: Readonly<Record<OperationFailureReason, string>> = {
	busy: 'it is in use by another operation or not ready',
	aborted: 'the operation was stopped',
	disconnected: 'the device is disconnected',
	removed: 'the device is no longer available',
	timeout: 'the device did not respond in time',
	alert: 'the driver reported an error',
	commandFailed: 'the driver refused the command',
	unexpectedState: 'the device is not in a state that allows it',
}

// Severity per reason, defaulting to danger. A refused acquisition is expected in a system where one
// device serves several features: it means the device is held by another operation or is not yet
// connected and quiescent, both of which pass on their own, so it is a warning rather than an error.
// The two cases are only told apart by the diagnostic detail, so the sentence has to cover both.
const FAILURE_SEVERITIES: Readonly<Partial<Record<OperationFailureReason, Severity>>> = {
	busy: 'warning',
}

// Reasons that never notify. A stop the user asked for is not a failure to report back to them, and a
// cancellation the lifecycle triggers is already explained by the disconnection that caused it.
const SILENT_REASONS: ReadonlySet<OperationFailureReason> = new Set<OperationFailureReason>(['aborted'])

// Builds the notification for one failed outcome.
// - title: feature heading shown by the toast, conventionally the device type in upper case.
// - subject: what failed, normally the device name.
// - action: what it was asked to do, phrased to follow "could not", such as `move to position 1000`.
export function operationFailureNotification(title: string, subject: string, action: string, reason: OperationFailureReason): Notification {
	return { title, description: `${subject} could not ${action}: ${FAILURE_DESCRIPTIONS[reason]}`, color: FAILURE_SEVERITIES[reason] ?? 'danger' }
}

// Notifies the browser when an outcome failed for a reason worth reporting, and returns whether it did.
// A successful or deliberately silent outcome sends nothing, so this can be applied to every terminal
// result without deciding at the call site whether the failure is one the user should see.
export function notifyOperationFailure(notification: NotificationHandler, title: string, subject: string, action: string, result: OperationResult<unknown>): boolean {
	if (result.ok) return false

	console.error('%s failed to %s:', subject, action, result.reason, result.error ?? '')

	if (SILENT_REASONS.has(result.reason)) return false

	notification.send(operationFailureNotification(title, subject, action, result.reason))

	return true
}

// Runs a command whose physical completion outlasts the request that asked for it, reporting only its
// failure. Nothing is awaited: the caller returns to the transport immediately, and the notification is
// what carries the outcome the response could no longer describe.
export function detachOperation(notification: NotificationHandler, title: string, subject: string, action: string, command: () => Promise<OperationResult<unknown>>) {
	void command().then((result) => notifyOperationFailure(notification, title, subject, action, result))
}
