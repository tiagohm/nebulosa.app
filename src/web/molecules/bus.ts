import { molecule } from 'bunshi'
import type { Camera, CameraUpdated, Confirmation, GuideOutput, GuideOutputUpdated, Thermometer, ThermometerUpdated } from 'src/api/types'

export type BusListener<T> = (arg: T) => void

export interface BusEventType {
	readonly CONFIRMATION: Confirmation
	readonly TOGGLE_HOME_MENU: boolean
	readonly CAMERA_ADD: Camera
	readonly CAMERA_UPDATE: CameraUpdated
	readonly CAMERA_REMOVE: Camera
	readonly GUIDE_OUTPUT_ADD: GuideOutput
	readonly GUIDE_OUTPUT_UPDATE: GuideOutputUpdated
	readonly GUIDE_OUTPUT_REMOVE: GuideOutput
	readonly THERMOMETER_ADD: Thermometer
	readonly THERMOMETER_UPDATE: ThermometerUpdated
	readonly THERMOMETER_REMOVE: Thermometer
}

const BUS: Partial<Record<keyof BusEventType, Set<(event: BusEventType[keyof BusEventType]) => void>>> = {}

// Molecule that manages the bus for inter-component communication
export const BusMolecule = molecule(() => {
	// Subscribes to an event
	function subscribe<K extends keyof typeof BUS>(event: K, listener: BusListener<BusEventType[K]>): VoidFunction {
		const listeners = (BUS[event] ??= new Set())
		listeners.add(listener as never)
		return () => unsubscribe(event, listener)
	}

	// Unsubscribes from an event
	function unsubscribe<K extends keyof typeof BUS>(event: K, listener: BusListener<BusEventType[K]>) {
		BUS[event]?.delete(listener as never)
	}

	// Emits an event to all subscribers
	function emit<K extends keyof typeof BUS>(event: K, arg: BusEventType[K]) {
		console.info('emitting event:', event, arg)
		BUS[event]?.forEach((e) => e(arg as never))
	}

	return { subscribe, unsubscribe, emit }
})
