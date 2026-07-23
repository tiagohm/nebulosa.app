import { equipmentStore, type DeviceState } from '@stores/equipment.store'
import type { Thermometer } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'

export type ThermometerStore = ReturnType<typeof thermometerStore>

export interface ThermometerState {
	thermometer: DeviceState<Thermometer>
}

export function thermometerStore(thermometer: Thermometer) {
	const state = proxy<ThermometerState>({
		thermometer,
	})

	console.info('thermometer created:', thermometer.name)

	let mounted = false

	function mount() {
		if (mounted) return unmount
		console.info('thermometer mounted:', thermometer.name)
		mounted = true
		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('thermometer unmounted:', thermometer.name)
		mounted = false
	}

	function connect() {
		return equipmentStore.connect(thermometer)
	}

	return {
		state,
		mount,
		unmount,
		connect,
	} as const
}
