export type BusCallback<T> = (data: T) => void

const bus = new Map<string, Set<BusCallback<never>>>()

// Molecule for managing a simple publish-subscribe bus
export class EventBus {
	// Checks if there are any subscribers to the bus
	hasSubscribers() {
		return bus.size > 0
	}

	// Checks if there are subscribers for a specific topic
	hasSubscribersForTopic(topic: string) {
		return bus.has(topic)
	}

	// Subscribes to a topic with a callback
	subscribe<T>(topic: string, callback: BusCallback<T>) {
		if (!bus.has(topic)) bus.set(topic, new Set())
		bus.get(topic)!.add(callback)
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
		const subscribers = bus.get(topic)

		if (subscribers) {
			subscribers.delete(callback)

			if (subscribers.size === 0) {
				bus.delete(topic)
			}
		}
	}

	// Emits data to all subscribers of a topic
	emit<T>(topic: string, data: T) {
		if (bus.has(topic)) {
			for (const callback of bus.get(topic)!) {
				callback(data as never)
			}
		}
	}
}

export function unsubscribe(subscribers?: readonly (VoidFunction | undefined)[]) {
	subscribers?.forEach((e) => e?.())
}

export default new EventBus()
