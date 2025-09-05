import { createScope, molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { DEFAULT_DEW_HEATER, type DewHeater, type DewHeaterUpdated } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { EquipmentMolecule } from './equipment'

export interface DewHeaterScopeValue {
	readonly dewHeater: DewHeater
}

export interface DewHeaterState {
	readonly dewHeater: DewHeater
	connecting: boolean
}

export const DewHeaterScope = createScope<DewHeaterScopeValue>({ dewHeater: DEFAULT_DEW_HEATER })

const dewHeaterStateMap = new Map<string, DewHeaterState>()

export const DewHeaterMolecule = molecule((m, s) => {
	const scope = s(DewHeaterScope)
	const equipment = m(EquipmentMolecule)

	const state =
		dewHeaterStateMap.get(scope.dewHeater.name) ??
		proxy<DewHeaterState>({
			dewHeater: equipment.get('dewHeater', scope.dewHeater.name)!,
			connecting: false,
		})

	dewHeaterStateMap.set(scope.dewHeater.name, state)

	Api.DewHeaters.get(scope.dewHeater.name).then((dewHeater) => {
		if (!dewHeater) return
		Object.assign(state.dewHeater, dewHeater)
		state.connecting = false
	})

	onMount(() => {
		const unsubscriber = bus.subscribe<DewHeaterUpdated>('dewHeater:update', (event) => {
			if (event.device.name === state.dewHeater.name) {
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

		if (state.dewHeater.connected) {
			await Api.Indi.disconnect(state.dewHeater)
		} else {
			await Api.Indi.connect(state.dewHeater)
		}
	}

	function pwm(value: number) {
		return Api.DewHeaters.pwm(scope.dewHeater, value)
	}

	function hide() {
		equipment.hide('dewHeater', scope.dewHeater)
	}

	return { state, scope, connect, pwm, hide } as const
})
