export type BusCallback<T> = (data: T) => void

// A simple publish-subscribe bus
export class EventBus {
	private readonly bus = new Map<string, Set<BusCallback<never>>>()

	// Checks if there are any subscribers to the bus
	hasSubscribers() {
		return this.bus.size > 0
	}

	// Checks if there are subscribers for a specific topic
	hasSubscribersForTopic(topic: string) {
		return this.bus.has(topic)
	}

	// Subscribes to a topic with a callback
	subscribe<T>(topic: string, callback: BusCallback<T>) {
		let callbacks = this.bus.get(topic)

		if (!callbacks) {
			callbacks = new Set()
			this.bus.set(topic, callbacks)
		}

		callbacks.add(callback)

		return () => this.unsubscribe(topic, callback)
	}

	// Subscribes to a topic with a callback that will be called only once
	subscribeOnce<T>(topic: string, callback: BusCallback<T>) {
		const wrapped: BusCallback<T> = (data) => {
			callback(data)
			this.unsubscribe(topic, wrapped)
		}

		return this.subscribe(topic, wrapped)
	}

	// Unsubscribes a callback from a topic
	unsubscribe<T>(topic: string, callback: BusCallback<T>) {
		const subscribers = this.bus.get(topic)

		if (subscribers) {
			subscribers.delete(callback)

			if (subscribers.size === 0) {
				this.bus.delete(topic)
			}
		}
	}

	// Emits data to all subscribers of a topic
	emit(topic: string, data: unknown) {
		queueMicrotask(() => this.emitSync(topic, data))
	}

	emitAll(event: string, devices?: readonly unknown[]) {
		if (devices !== undefined && devices.length > 0) queueMicrotask(() => this.emitAllSync(event, devices))
	}

	// Emits data to all subscribers of a topic synchronously
	emitSync(topic: string, data: unknown) {
		const callbacks = this.bus.get(topic)

		if (callbacks) {
			for (const callback of callbacks) {
				callback(data as never)
			}
		}
	}

	// Emits data to all subscribers of a topic synchronously
	emitAllSync(topic: string, data: readonly unknown[]) {
		const callbacks = this.bus.get(topic)

		if (callbacks && data.length > 0) {
			for (const item of data) {
				for (const callback of callbacks) {
					callback(item as never)
				}
			}
		}
	}
}

export default new EventBus()
