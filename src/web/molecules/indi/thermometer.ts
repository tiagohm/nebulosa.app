import { createScope, molecule, use } from 'bunshi'
import { DEFAULT_THERMOMETER, type Thermometer } from 'nebulosa/src/indi.device'
import { proxy } from 'valtio'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface ThermometerScopeValue {
	readonly thermometer: Thermometer
}

export interface ThermometerState {
	readonly thermometer: EquipmentDevice<Thermometer>
}

export const ThermometerScope = createScope<ThermometerScopeValue>({ thermometer: DEFAULT_THERMOMETER })

const stateMap = new Map<string, ThermometerState>()

export const ThermometerMolecule = molecule(() => {
	const scope = use(ThermometerScope)
	const equipment = use(EquipmentMolecule)

	const thermometer = equipment.get('THERMOMETER', scope.thermometer.name)!

	const state =
		stateMap.get(thermometer.name) ??
		proxy<ThermometerState>({
			thermometer,
		})

	stateMap.set(thermometer.name, state)

	function connect() {
		return equipment.connect(thermometer)
	}

	function hide() {
		equipment.hide('THERMOMETER', thermometer)
	}

	return { state, scope, connect, hide } as const
})
