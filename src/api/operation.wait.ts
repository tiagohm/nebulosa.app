import { errorMessage, settlesWithin } from 'src/api/util'
import type { OperationFailureReason, OperationResult } from '#/orchestration'

// Everything needed to command a device and wait for the physical state that proves the command took
// effect. The device itself is not a field: subscribe, current, and command already close over it.
export interface WaitForDeviceOptions<U> {
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
	// Sends the state-changing command after setup; the signal aborts before timeout or abort cleanup can settle.
	readonly command: (signal: AbortSignal) => void | Promise<void>
	// Maximum milliseconds to wait for a canceled command before forcing physical abort cleanup.
	readonly commandAbortTimeout?: number
	// Stops or quiesces physical work before any non-successful result settles, whether the cause was an
	// abort, a timeout, a failed command, or a failure verdict the device itself reported. Only a wait
	// whose command was never dispatched skips it.
	readonly abort?: () => void | Promise<void>
}

// Default grace period in milliseconds for a canceled command to stop before physical abort runs.
const DEFAULT_COMMAND_ABORT_TIMEOUT = 1000

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

// Subscribes before commanding a device and settles only after any canceled command has stopped.
export function waitForDeviceState<U>(options: WaitForDeviceOptions<U>): Promise<OperationResult<U>> {
	const { signal } = options

	if (signal.aborted) return Promise.resolve(aborted(signal))

	return new Promise((resolve) => {
		const commandController = new AbortController()
		const commandCompletion = Promise.withResolvers<void>()
		let settled = false
		let commandStarted = false
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
			commandController.abort(reason)

			if (commandStarted && !commandCompleted) {
				const stopped = await settlesWithin(commandCompletion.promise, options.commandAbortTimeout ?? DEFAULT_COMMAND_ABORT_TIMEOUT)

				if (!stopped) {
					const detail = 'command did not stop before abort cleanup'
					error = error ? `${error}; ${detail}` : detail
				}
			}

			try {
				await options.abort?.()
			} catch (abortError) {
				const detail = errorMessage(abortError)
				error = error ? `${error}; abort failed: ${detail}` : `abort failed: ${detail}`
			}

			resolve(error === undefined ? { ok: false, reason } : { ok: false, reason, error })
		}

		// Concludes through the physical abort path whenever the device did not reach the intended state.
		// A verdict such as Alert in the middle of a slew means the command failed while the device may
		// still be moving, so resolving without stopping it would release the resource on a live axis.
		const settle = (result: OperationResult<U>) => {
			if (result.ok) finish(result)
			else void finishAfterAbort(result.reason, result.error)
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
				if (commandCompleted) settle(result)
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

		commandStarted = true

		void (async () => {
			try {
				await options.command(commandController.signal)
			} catch (error) {
				// The device may have accepted part of the command before failing, so this settles through the
				// abort path too; the completion promise it awaits resolves in the finally block below.
				settle({ ok: false, reason: 'commandFailed', error: errorMessage(error) })
				return
			} finally {
				commandCompletion.resolve()
			}

			if (settled) return
			commandCompleted = true

			if (pendingResult !== undefined) {
				settle(pendingResult)
				return
			}

			try {
				const result = evaluate(options.current())
				if (result !== undefined) settle(result)
			} catch (error) {
				settle({ ok: false, reason: 'unexpectedState', error: errorMessage(error) })
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
