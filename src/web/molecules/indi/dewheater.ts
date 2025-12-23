import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_DEW_HEATER, type DewHeater } from 'nebulosa/src/indi.device'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface DewHeaterScopeValue {
	readonly dewHeater: DewHeater
}

export interface DewHeaterState {
	dewHeater: EquipmentDevice<DewHeater>
}

export const DewHeaterScope = createScope<DewHeaterScopeValue>({ dewHeater: DEFAULT_DEW_HEATER })

const stateMap = new Map<string, DewHeaterState>()

export const DewHeaterMolecule = molecule(() => {
	const scope = use(DewHeaterScope)
	const equipment = use(EquipmentMolecule)

	const dewHeater = equipment.get('DEW_HEATER', scope.dewHeater.name)!

	const state =
		stateMap.get(dewHeater.name) ??
		proxy<DewHeaterState>({
			dewHeater,
		})

	stateMap.set(dewHeater.name, state)

	onMount(() => {
		state.dewHeater = equipment.get('DEW_HEATER', state.dewHeater.name)!
	})

	function connect() {
		return equipment.connect(dewHeater)
	}

	function update(value: number | number[]) {
		dewHeater.pwm.value = typeof value === 'number' ? value : value[0]
	}

	function pwm(value: number | number[]) {
		return Api.DewHeaters.pwm(dewHeater, typeof value === 'number' ? value : value[0])
	}

	function hide() {
		equipment.hide('DEW_HEATER', dewHeater)
	}

	return { state, scope, connect, update, pwm, hide } as const
})
