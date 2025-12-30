import { addToast } from '@heroui/react'
import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_THERMOMETER, type Thermometer } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { ThermometerUpdated } from 'src/shared/types'
import type { DeepReadonly } from 'utility-types'
import { proxy } from 'valtio'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface ThermometerScopeValue {
	readonly thermometer: DeepReadonly<Omit<Thermometer, symbol>>
}

export interface ThermometerState {
	thermometer: EquipmentDevice<Thermometer>
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

	onMount(() => {
		state.thermometer = equipment.get('THERMOMETER', state.thermometer.name)!

		const unsubscriber = bus.subscribe<ThermometerUpdated>('thermometer:update', (event) => {
			if (event.device.name === thermometer.name) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						addToast({ title: 'THERMOMETER', description: `Failed to connect to thermometer ${thermometer.name}`, color: 'danger' })
					}

					state.thermometer.connecting = false
				}
			}
		})

		return () => {
			unsubscriber()
		}
	})

	function connect() {
		return equipment.connect(thermometer)
	}

	function hide() {
		equipment.hide('THERMOMETER', thermometer)
	}

	return { state, scope, connect, hide } as const
})
