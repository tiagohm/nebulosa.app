import { createScope, molecule } from 'bunshi'
import { DEFAULT_THERMOMETER, type Thermometer } from 'src/shared/types'
import { proxy } from 'valtio'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface ThermometerScopeValue {
	readonly thermometer: Thermometer
}

export interface ThermometerState {
	readonly thermometer: EquipmentDevice<Thermometer>
}

export const ThermometerScope = createScope<ThermometerScopeValue>({ thermometer: DEFAULT_THERMOMETER })

const thermometerStateMap = new Map<string, ThermometerState>()

export const ThermometerMolecule = molecule((m, s) => {
	const scope = s(ThermometerScope)
	const equipment = m(EquipmentMolecule)

	const state =
		thermometerStateMap.get(scope.thermometer.name) ??
		proxy<ThermometerState>({
			thermometer: equipment.get('THERMOMETER', scope.thermometer.name)!,
		})

	thermometerStateMap.set(scope.thermometer.name, state)

	function connect() {
		return equipment.connect(state.thermometer)
	}

	function hide() {
		equipment.hide('THERMOMETER', scope.thermometer)
	}

	return { state, scope, connect, hide } as const
})
