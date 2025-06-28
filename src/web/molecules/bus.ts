import { molecule } from 'bunshi'
import type { Camera, CameraUpdated, Confirmation, GuideOutput, GuideOutputUpdated, Thermometer, ThermometerUpdated } from 'src/api/types'

export type BusListener<T> = (arg: T) => void

export type BusUnsubscriber = VoidFunction

export interface BusListenerMap {
	readonly confirmation: Confirmation
	readonly toggleHomeMenu: boolean
	readonly addCamera: Camera
	readonly updateCamera: CameraUpdated
	readonly removeCamera: Camera
	readonly addGuideOutput: GuideOutput
	readonly updateGuideOutput: GuideOutputUpdated
	readonly removeGuideOutput: GuideOutput
	readonly addThermometer: Thermometer
	readonly updateThermometer: ThermometerUpdated
	readonly removeThermometer: Thermometer
}

// Molecule that manages the bus for inter-component communication
export const BusMolecule = molecule(() => {
	const bus = new Map<string, Set<BusListener<never>>>()

	// Subscribes to an event
	function subscribe<K extends keyof BusListenerMap>(event: K, listener: BusListener<BusListenerMap[K]>): BusUnsubscriber {
		if (!bus.has(event)) bus.set(event, new Set())
		bus.get(event)!.add(listener as never)
		return () => unsubscribe(event, listener)
	}

	// Unsubscribes from an event
	function unsubscribe<K extends keyof BusListenerMap>(event: K, listener: BusListener<BusListenerMap[K]>) {
		bus.get(event)?.delete(listener as never)
	}

	// Emits an event to all subscribers
	function emit<K extends keyof BusListenerMap>(event: K, arg: BusListenerMap[K]) {
		bus.get(event)?.forEach((e) => e(arg as never))
	}

	return { subscribe, unsubscribe, emit }
})
