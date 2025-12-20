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
	emit<T>(topic: string, data: T) {
		queueMicrotask(() => this.emitSync(topic, data))
	}

	// Emits data to all subscribers of a topic synchronously
	emitSync<T>(topic: string, data: T) {
		const callbacks = this.bus.get(topic)

		if (callbacks) {
			for (const callback of callbacks) {
				callback(data as never)
			}
		}
	}
}

export default new EventBus()
