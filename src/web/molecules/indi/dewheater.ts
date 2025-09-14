import { createScope, molecule } from 'bunshi'
import { DEFAULT_DEW_HEATER, type DewHeater } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface DewHeaterScopeValue {
	readonly dewHeater: DewHeater
}

export interface DewHeaterState {
	readonly dewHeater: EquipmentDevice<DewHeater>
}

export const DewHeaterScope = createScope<DewHeaterScopeValue>({ dewHeater: DEFAULT_DEW_HEATER })

const dewHeaterStateMap = new Map<string, DewHeaterState>()

export const DewHeaterMolecule = molecule((m, s) => {
	const scope = s(DewHeaterScope)
	const equipment = m(EquipmentMolecule)

	const state =
		dewHeaterStateMap.get(scope.dewHeater.name) ??
		proxy<DewHeaterState>({
			dewHeater: equipment.get('DEW_HEATER', scope.dewHeater.name)!,
		})

	dewHeaterStateMap.set(scope.dewHeater.name, state)

	function connect() {
		return equipment.connect(state.dewHeater)
	}

	function pwm(value: number) {
		return Api.DewHeaters.pwm(scope.dewHeater, value)
	}

	function hide() {
		equipment.hide('DEW_HEATER', scope.dewHeater)
	}

	return { state, scope, connect, pwm, hide } as const
})
