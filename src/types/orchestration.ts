// Expected operational terminal causes that callers can handle without exceptions.
export type OperationFailureReason = 'busy' | 'aborted' | 'disconnected' | 'removed' | 'timeout' | 'alert' | 'commandFailed' | 'unexpectedState'

// Discriminated terminal outcome for expected success and operational failure.
export type OperationResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: OperationFailureReason; readonly error?: string }
