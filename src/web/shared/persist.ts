import { proxy, subscribe } from 'valtio'
import storage from './storage'

export interface PersistProxyOptions {
	autoStart?: boolean
	notifyInSync?: boolean
}

export const DEFAULT_PERSIST_PROXY_OPTIONS: PersistProxyOptions = {
	autoStart: true,
	notifyInSync: false,
}

export function persistProxy<T extends object>(key: string, fallback: T | (() => T), { autoStart = true, notifyInSync = false }: PersistProxyOptions = DEFAULT_PERSIST_PROXY_OPTIONS) {
	const value = storage.get<T>(key, fallback)
	const state = proxy<T>(value)
	// let previousState = snapshot(state)
	let unsubscriber: VoidFunction | undefined

	function start() {
		if (unsubscriber) return

		unsubscriber = subscribe(
			state,
			() => {
				// const currentState = snapshot(state)
				storage.set(key, state)
				// Update previous state for next comparison
				// previousState = currentState
			},
			notifyInSync,
		)
	}

	function stop() {
		unsubscriber?.()
		unsubscriber = undefined
	}

	if (autoStart) start()

	return { state, start, stop } as const
}
