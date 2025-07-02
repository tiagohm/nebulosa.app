import { molecule } from 'bunshi'

export type BusCallback<T> = (data: T) => void

// Molecule for managing a simple publish-subscribe bus
export const BusMolecule = molecule(() => {
	const bus = new Map<string, Set<BusCallback<never>>>()

	// Subscribes to a topic with a callback
	function subscribe<T>(topic: string, callback: BusCallback<T>) {
		if (!bus.has(topic)) bus.set(topic, new Set())
		bus.get(topic)!.add(callback)
		return () => bus.get(topic)?.delete(callback)
	}

	// Subscribes to a topic with a callback that will be called only once
	function subscribeOnce<T>(topic: string, callback: BusCallback<T>) {
		const wrapped: BusCallback<T> = (data) => {
			callback(data)
			bus.get(topic)?.delete(wrapped)
		}

		return subscribe(topic, wrapped)
	}

	// Emits data to all subscribers of a topic
	function emit<T>(topic: string, data: T) {
		if (bus.has(topic)) {
			for (const callback of bus.get(topic)!) {
				callback(data as never)
			}
		}
	}

	return { subscribe, subscribeOnce, emit } as const
})
