import type { Thermometer } from 'nebulosa/src/indi.device'
import { proxy } from 'valtio'
import { equipmentStore, type DeviceState } from './equipment.store'

export type ThermometerStore = ReturnType<typeof thermometerStore>

export interface ThermometerState {
	thermometer: DeviceState<Thermometer>
}

export function thermometerStore(thermometer: Thermometer) {
	const state = proxy<ThermometerState>({
		thermometer,
	})

	function mount() {
		console.info('thermometer mounted', thermometer.name)
	}

	function unmount() {
		console.info('thermometer unmounted', thermometer.name)
	}

	function connect() {
		return equipmentStore.connect(thermometer)
	}

	function show() {
		return equipmentStore.show(thermometer)
	}

	function hide() {
		return equipmentStore.hide(thermometer)
	}

	return {
		state,
		mount,
		unmount,
		connect,
		show,
		hide,
	} as const
}
