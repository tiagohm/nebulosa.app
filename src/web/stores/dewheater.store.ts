import { Api } from '@shared/api'
import { equipmentStore, type DeviceState } from '@stores/equipment.store'
import type { DewHeater } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'

export type DewHeaterStore = ReturnType<typeof dewHeaterStore>

export interface DewHeaterState {
	dewHeater: DeviceState<DewHeater>
}

export function dewHeaterStore(dewHeater: DewHeater) {
	const state = proxy<DewHeaterState>({
		dewHeater,
	})

	console.info('dew heater created:', dewHeater.name)

	function mount() {
		console.info('dew heater mounted:', dewHeater.name)
	}

	function unmount() {
		console.info('dew heater unmounted:', dewHeater.name)
	}

	function connect() {
		return equipmentStore.connect(dewHeater)
	}

	function update(value: number) {
		dewHeater.dutyCycle.value = value
	}

	function dutyCycle(value: number) {
		return Api.DewHeaters.dutyCycle(dewHeater, value)
	}

	return {
		state,
		mount,
		unmount,
		connect,
		update,
		dutyCycle,
	} as const
}
