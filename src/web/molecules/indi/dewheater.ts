import { addToast } from '@heroui/react'
import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_DEW_HEATER, type DewHeater } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { DewHeaterUpdated } from 'src/shared/types'
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

		const unsubscriber = bus.subscribe<DewHeaterUpdated>('dewHeater:update', (event) => {
			if (event.device.name === dewHeater.name) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						addToast({ title: 'DEW HEATER', description: `Failed to connect to dew heater ${dewHeater.name}`, color: 'danger' })
					}

					state.dewHeater.connecting = false
				}
			}
		})

		return () => {
			unsubscriber()
		}
	})

	function connect() {
		return equipment.connect(dewHeater)
	}

	function update(value: number | number[]) {
		dewHeater.dutyCycle.value = typeof value === 'number' ? value : value[0]
	}

	function dutyCycle(value: number | number[]) {
		return Api.DewHeaters.dutyCycle(dewHeater, typeof value === 'number' ? value : value[0])
	}

	function hide() {
		equipment.hide('DEW_HEATER', dewHeater)
	}

	return { state, scope, connect, update, dutyCycle, hide } as const
})
