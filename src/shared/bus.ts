export type BusCallback<T> = (data: T) => void

// A simple publish-subscribe bus
export class EventBus<T extends object = Record<string, unknown>> {
	private readonly bus = new Map<keyof T, Set<BusCallback<never>>>()

	constructor(public forceSync: boolean = false) {}

	// Checks if there are any subscribers to the bus
	hasSubscribers() {
		return this.bus.size > 0
	}

	// Checks if there are subscribers for a specific topic
	hasSubscribersForTopic(topic: keyof T) {
		return this.bus.has(topic)
	}

	// Subscribes to a topic with a callback
	subscribe<K extends keyof T>(topic: K, callback: BusCallback<T[K]>) {
		let callbacks = this.bus.get(topic)

		if (!callbacks) {
			callbacks = new Set()
			this.bus.set(topic, callbacks)
		}

		callbacks.add(callback)

		return () => this.unsubscribe(topic, callback)
	}

	// Subscribes to a topic with a callback that will be called only once
	subscribeOnce<K extends keyof T>(topic: K, callback: BusCallback<T[K]>) {
		const wrapped: BusCallback<T[K]> = (data) => {
			this.unsubscribe(topic, wrapped)
			callback(data)
		}

		return this.subscribe(topic, wrapped)
	}

	// Unsubscribes a callback from a topic
	unsubscribe<K extends keyof T>(topic: K, callback: BusCallback<T[K]>) {
		const subscribers = this.bus.get(topic)

		if (subscribers) {
			subscribers.delete(callback)

			if (subscribers.size === 0) {
				this.bus.delete(topic)
			}
		}
	}

	// Emits data to all subscribers of a topic
	emit<K extends keyof T>(topic: K, data: T[K]) {
		const callbacks = this.bus.get(topic)

		if (callbacks !== undefined) {
			if (this.forceSync) this.emitCallbacks(callbacks, data)
			else queueMicrotask(() => this.emitCallbacks(callbacks, data))
		}
	}

	emitAll<K extends keyof T>(topic: K, data: readonly T[K][]) {
		const callbacks = this.bus.get(topic)

		if (callbacks && data !== undefined && data.length > 0) {
			if (this.forceSync) this.emitAllCallbacks(callbacks, data)
			else queueMicrotask(() => this.emitAllCallbacks(callbacks, data))
		}
	}

	// Emits data to all subscribers of a topic synchronously
	emitSync<K extends keyof T>(topic: K, data: T[K]) {
		const callbacks = this.bus.get(topic)

		if (callbacks !== undefined) {
			this.emitCallbacks(callbacks, data)
		}
	}

	// Emits data to all subscribers of a topic synchronously
	emitAllSync<K extends keyof T>(topic: K, data: readonly T[K][]) {
		const callbacks = this.bus.get(topic)

		if (callbacks !== undefined && data.length > 0) {
			this.emitAllCallbacks(callbacks, data)
		}
	}

	private emitCallbacks(callbacks: Set<BusCallback<never>>, data: unknown) {
		for (const callback of callbacks) {
			callback(data as never)
		}
	}

	private emitAllCallbacks(callbacks: Set<BusCallback<never>>, data: readonly unknown[]) {
		for (const item of data) {
			for (const callback of callbacks) {
				callback(item as never)
			}
		}
	}
}
