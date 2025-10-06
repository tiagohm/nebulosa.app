import { proxy, subscribe } from 'valtio'
import storage from './storage'

export function persistProxy<T extends object>(key: string, fallback: T | (() => T)) {
	const value = storage.get<T>(key, fallback)
	const state = proxy<T>(value)
	// let previousState = snapshot(state)

	const unsubscribe = subscribe(state, () => {
		// const currentState = snapshot(state)
		storage.set(key, state)
		// Update previous state for next comparison
		// previousState = currentState
	})

	return { state, unsubscribe } as const
}
