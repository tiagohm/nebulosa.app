import type { ServerEvent } from './websocket'

// Process-local fan-out of the server events: the one publication path of the connections, the operations, and the
// sessions, which hands every event, synchronously and in subscription order, to the WebSocket broadcast, the operation
// history, the notification history, and any service of the process that observes the others (a caller composing
// tools reacting to what they report). Delivery is in memory only and never replayed: an observer sees the events
// published while it is subscribed, nothing before and nothing after a restart, so the outcome of a command is what its
// service answers, never an event. An observer that throws is reported and skipped, so it can neither stop the
// observers after it nor reach the device operation that published the event.

// Receiver of the server events.
export type ServerEventObserver = (event: ServerEvent) => void

// Subscriptions of the server events of one process.
export class ServerEventDispatcher {
	// Observers in subscription order; each subscription is its own entry, so the same function subscribed twice is
	// called twice and each unsubscription removes only its own.
	#observers: readonly { readonly observer: ServerEventObserver }[] = []

	// Hands an event to every observer subscribed now, in subscription order. One that subscribes or unsubscribes during
	// the delivery changes only the next ones. Never throws.
	publish(event: ServerEvent) {
		for (const { observer } of this.#observers) {
			try {
				observer(event)
			} catch (error) {
				console.error('a server event observer failed:', event.type, error)
			}
		}
	}

	// Subscribes an observer to every event published from now on, and returns the function unsubscribing it; calling
	// that function again has no effect.
	subscribe(observer: ServerEventObserver): VoidFunction {
		const subscription = { observer }
		this.#observers = [...this.#observers, subscription]

		return () => {
			this.#observers = this.#observers.filter((each) => each !== subscription)
		}
	}
}
