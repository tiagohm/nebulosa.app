// Expected operational terminal causes that callers can handle without exceptions.
export type OperationFailureReason = 'busy' | 'aborted' | 'disconnected' | 'removed' | 'timeout' | 'alert' | 'commandFailed' | 'unexpectedState'

// Discriminated terminal outcome for expected success and operational failure.
export type FailedOperationResult = { readonly ok: false; readonly reason: OperationFailureReason; readonly error?: string }
export type SuccesfulOperationResult<T = never> = { readonly ok: true; readonly value: T }
export type OperationResult<T> = FailedOperationResult | SuccesfulOperationResult<T>

export function failedOperationResult(reason: OperationFailureReason, error?: string): FailedOperationResult {
	return { ok: false, reason, error }
}

export function successfulOperationResult<T>(value: T): SuccesfulOperationResult<T> {
	return { ok: true, value }
}
