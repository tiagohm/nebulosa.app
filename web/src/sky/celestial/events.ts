import type { CelestialEventCallback, CelestialEventMap, CelestialEventName } from './types'

// Typed event registry of the star map, with unsubscribe support and cheap "has listeners" checks so
// payloads are only built when someone listens.

// Callback stored without its event-specific payload type.
type AnyCelestialEventCallback = (payload: CelestialEventMap[CelestialEventName], eventName: CelestialEventName) => void

// Registry of event callbacks keyed by event name.
export class CelestialEventBus {
	// Callbacks per event name.
	private readonly callbacks = new Map<CelestialEventName, Set<AnyCelestialEventCallback>>()

	// Registers a callback and returns a function that unregisters it.
	on<K extends CelestialEventName>(eventName: K, callback: CelestialEventCallback<K>): () => void {
		let callbacks = this.callbacks.get(eventName)

		if (!callbacks) {
			callbacks = new Set()
			this.callbacks.set(eventName, callbacks)
		}

		callbacks.add(callback as AnyCelestialEventCallback)

		return () => this.off(eventName, callback)
	}

	// Unregisters a callback.
	off<K extends CelestialEventName>(eventName: K, callback: CelestialEventCallback<K>) {
		this.callbacks.get(eventName)?.delete(callback as AnyCelestialEventCallback)
	}

	// Returns whether any callback listens to an event.
	has(eventName: CelestialEventName) {
		const callbacks = this.callbacks.get(eventName)
		return callbacks !== undefined && callbacks.size > 0
	}

	// Calls every callback of an event synchronously with the payload.
	emit<K extends CelestialEventName>(eventName: K, payload: CelestialEventMap[K]) {
		const callbacks = this.callbacks.get(eventName)
		if (!callbacks) return

		for (const callback of callbacks) {
			callback(payload, eventName)
		}
	}

	// Unregisters every callback.
	clear() {
		this.callbacks.clear()
	}
}
