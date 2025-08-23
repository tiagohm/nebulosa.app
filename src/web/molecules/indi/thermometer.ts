import { createScope, molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { DEFAULT_THERMOMETER, type Thermometer, type ThermometerUpdated } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { EquipmentMolecule } from './equipment'

export interface ThermometerScopeValue {
	readonly thermometer: Thermometer
}

export interface ThermometerState {
	readonly thermometer: Thermometer
	connecting: boolean
}

export const ThermometerScope = createScope<ThermometerScopeValue>({ thermometer: DEFAULT_THERMOMETER })

const thermometerStateMap = new Map<string, ThermometerState>()

export const ThermometerMolecule = molecule((m, s) => {
	const scope = s(ThermometerScope)
	const equipment = m(EquipmentMolecule)

	const state =
		thermometerStateMap.get(scope.thermometer.name) ??
		proxy<ThermometerState>({
			thermometer: equipment.get('thermometer', scope.thermometer.name)!,
			connecting: false,
		})

	thermometerStateMap.set(scope.thermometer.name, state)

	Api.Thermometers.get(scope.thermometer.name).then((thermometer) => {
		if (!thermometer) return
		Object.assign(state.thermometer, thermometer)
		state.connecting = false
	})

	onMount(() => {
		const unsubscriber = bus.subscribe<ThermometerUpdated>('thermometer:update', (event) => {
			if (event.device.name === state.thermometer.name) {
				if (event.property === 'connected') {
					state.connecting = false
				}
			}
		})

		return () => {
			unsubscriber()
		}
	})

	async function connect() {
		state.connecting = true

		if (state.thermometer.connected) {
			await Api.Indi.disconnect(state.thermometer)
		} else {
			await Api.Indi.connect(state.thermometer)
		}
	}

	function close() {
		equipment.close('thermometer', scope.thermometer)
	}

	return { state, scope, connect, close } as const
})
