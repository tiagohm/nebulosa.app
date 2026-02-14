import { addToast } from '@heroui/react'
import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_WHEEL, type Wheel } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { WheelUpdated } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import type { DeepReadonly } from 'utility-types'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface WheelScopeValue {
	readonly wheel: DeepReadonly<Omit<Wheel, symbol>>
}

export interface WheelState {
	wheel: EquipmentDevice<Wheel>
	readonly selected: {
		position: number
		name: string
	}
}

export const WheelScope = createScope<WheelScopeValue>({ wheel: DEFAULT_WHEEL })

const stateMap = new Map<string, WheelState>()

export const WheelMolecule = molecule(() => {
	const scope = use(WheelScope)
	const equipment = use(EquipmentMolecule)

	const wheel = equipment.get('WHEEL', scope.wheel.name)!

	const state =
		stateMap.get(wheel.name) ??
		proxy<WheelState>({
			wheel,
			selected: {
				position: wheel.position,
				name: wheel.names[wheel.position] || '',
			},
		})

	stateMap.set(wheel.name, state)

	onMount(() => {
		state.wheel = equipment.get('WHEEL', state.wheel.name)!

		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<WheelUpdated>('wheel:update', (event) => {
			if (event.device.id === wheel.id) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						addToast({ title: 'FILTER WHEEL', description: `Failed to connect to filter wheel ${wheel.name}`, color: 'danger' })
					}

					state.wheel.connecting = false
				}
			}
		})

		unsubscribers[1] = subscribeKey(state.selected, 'position', (position) => {
			state.selected.name = wheel.names[position]
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof WheelState['selected']>(key: K, value: WheelState['selected'][K]) {
		state.selected[key] = value
	}

	function connect() {
		return equipment.connect(wheel)
	}

	function moveTo() {
		return Api.Wheels.moveTo(wheel, state.selected.position)
	}

	function apply() {
		const names = [...wheel.name]
		names[state.selected.position] = state.selected.name
		return Api.Wheels.names(wheel, names)
	}

	function hide() {
		equipment.hide('WHEEL', wheel)
	}

	return { state, scope, update, connect, moveTo, apply, hide } as const
})
