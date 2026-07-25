import { errorMessage } from 'src/api/util'
import type { OperationFailureReason, OperationResult } from './operation'

export interface WaitForDeviceOptions<D, U> {
	// Device associated with the wait; retained in the contract for device-specific callers.
	readonly device: D
	// Operation signal that cancels the wait and its optional physical abort.
	readonly signal: AbortSignal
	// Maximum wait duration in milliseconds.
	readonly timeout: number
	// Installs the update observer and returns an idempotent unsubscriber.
	readonly subscribe: (listener: (update: U) => void) => VoidFunction
	// Reads current state after the command has been sent.
	readonly current: () => U
	// Classifies each state as pending, successful, or an expected failure.
	readonly evaluate: (update: U) => 'pending' | 'success' | OperationFailureReason
	// Sends the state-changing command after subscription and timeout setup.
	readonly command: () => void | Promise<void>
	// Stops or quiesces physical work on abort or timeout before the result settles.
	readonly abort?: () => void | Promise<void>
}

// Waits for a temporal delay in milliseconds and removes its timer/listener on abort.
export function abortableDelay(ms: number, signal: AbortSignal): Promise<OperationResult<void>> {
	if (signal.aborted) return Promise.resolve(aborted(signal))

	const delayed = Promise.withResolvers<OperationResult<void>>()
	let settled = false
	const finish = (result: OperationResult<void>) => {
		if (settled) return
		settled = true
		clearTimeout(timer)
		signal.removeEventListener('abort', onAbort)
		delayed.resolve(result)
	}

	const onAbort = () => {
		finish(aborted(signal))
	}

	const timer = setTimeout(() => finish({ ok: true, value: undefined }), Math.max(0, ms))
	signal.addEventListener('abort', onAbort, { once: true })
	return delayed.promise
}

// Subscribes before commanding a device and resolves once from observed state, timeout, or abort.
export function waitForDeviceState<D, U>(options: WaitForDeviceOptions<D, U>): Promise<OperationResult<U>> {
	const { signal } = options

	if (signal.aborted) return Promise.resolve(aborted(signal))

	return new Promise((resolve) => {
		let settled = false
		let commandCompleted = false
		let pendingResult: OperationResult<U> | undefined
		let unsubscribe: VoidFunction = () => {}

		const cleanup = () => {
			clearTimeout(timer)
			unsubscribe()
			signal.removeEventListener('abort', onAbort)
		}

		const finish = (result: OperationResult<U>) => {
			if (settled) return
			settled = true
			cleanup()
			resolve(result)
		}

		const finishAfterAbort = async (reason: OperationFailureReason, error?: string) => {
			if (settled) return
			settled = true
			cleanup()

			try {
				await options.abort?.()
			} catch (abortError) {
				const detail = errorMessage(abortError)
				error = error ? `${error}; abort failed: ${detail}` : `abort failed: ${detail}`
			}

			resolve(error === undefined ? { ok: false, reason } : { ok: false, reason, error })
		}

		const evaluate = (update: U): OperationResult<U> | undefined => {
			let evaluation: ReturnType<typeof options.evaluate>

			try {
				evaluation = options.evaluate(update)
			} catch (error) {
				return { ok: false, reason: 'unexpectedState', error: errorMessage(error) }
			}

			if (evaluation === 'success') {
				return { ok: true, value: update }
			} else if (evaluation !== 'pending') {
				return { ok: false, reason: evaluation }
			}
		}

		const listener = (update: U) => {
			const result = evaluate(update)

			if (result !== undefined) {
				if (commandCompleted) finish(result)
				else pendingResult ??= result
			}
		}

		const onAbort = () => void finishAfterAbort(abortReason(signal))
		const timer = setTimeout(() => void finishAfterAbort('timeout'), Math.max(0, options.timeout))

		signal.addEventListener('abort', onAbort, { once: true })

		try {
			unsubscribe = options.subscribe(listener)
		} catch (error) {
			finish({ ok: false, reason: 'commandFailed', error: errorMessage(error) })
			return
		}

		if (settled) {
			unsubscribe()
			return
		}

		void (async () => {
			try {
				await options.command()
			} catch (error) {
				finish({ ok: false, reason: 'commandFailed', error: errorMessage(error) })
				return
			}

			if (settled) return
			commandCompleted = true

			if (pendingResult !== undefined) {
				finish(pendingResult)
				return
			}

			try {
				const result = evaluate(options.current())
				if (result !== undefined) finish(result)
			} catch (error) {
				finish({ ok: false, reason: 'unexpectedState', error: errorMessage(error) })
			}
		})()
	})
}

// Maps AbortSignal reasons into the finite operational failure contract.
export function abortReason(signal: AbortSignal): OperationFailureReason {
	const reason = signal.reason

	switch (reason) {
		case 'busy':
		case 'aborted':
		case 'disconnected':
		case 'removed':
		case 'timeout':
		case 'alert':
		case 'commandFailed':
		case 'unexpectedState':
			return reason
		default:
			return 'aborted'
	}
}

// Builds an aborted result using the signal's normalized operational reason.
function aborted<T>(signal: AbortSignal): OperationResult<T> {
	return { ok: false, reason: abortReason(signal) }
}
