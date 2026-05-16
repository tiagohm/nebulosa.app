import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_DEW_HEATER, type DewHeater } from 'nebulosa/src/indi.device'
import type { DeepReadonly } from 'nebulosa/src/types'
import bus from 'src/shared/bus'
import type { DewHeaterUpdated } from 'src/shared/types'
import { equipment, type DeviceState } from 'src/web/store/equipment.store'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { toast } from '@/shared/toast'

export interface DewHeaterScopeValue {
	readonly dewHeater: DeepReadonly<Omit<DewHeater, symbol>>
}

export interface DewHeaterState {
	dewHeater: DeviceState<DewHeater>
}

export const DewHeaterScope = createScope<DewHeaterScopeValue>({ dewHeater: DEFAULT_DEW_HEATER })

const stateMap = new Map<string, DewHeaterState>()

export const DewHeaterMolecule = molecule(() => {
	const scope = use(DewHeaterScope)

	const dewHeater = equipment.get('dewHeater', scope.dewHeater.id)!

	const state =
		stateMap.get(dewHeater.id) ??
		proxy<DewHeaterState>({
			dewHeater,
		})

	stateMap.set(dewHeater.id, state)

	onMount(() => {
		state.dewHeater = equipment.get('dewHeater', state.dewHeater.id)!

		const unsubscriber = bus.subscribe<DewHeaterUpdated>('dewHeater:update', (event) => {
			if (event.device.id === dewHeater.id) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						toast({ title: 'DEW HEATER', description: `Failed to connect to dew heater ${dewHeater.name}`, color: 'danger' })
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
		state.dewHeater.show = false
	}

	return { state, scope, connect, update, dutyCycle, hide } as const
})
