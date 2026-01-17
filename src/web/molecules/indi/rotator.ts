import { addToast } from '@heroui/react'
import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_ROTATOR, type Rotator } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { RotatorUpdated } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import type { DeepReadonly } from 'utility-types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface RotatorScopeValue {
	readonly rotator: DeepReadonly<Omit<Rotator, symbol>>
}

export interface RotatorState {
	rotator: EquipmentDevice<Rotator>
	readonly angle: number
}

export const RotatorScope = createScope<RotatorScopeValue>({ rotator: DEFAULT_ROTATOR })

const stateMap = new Map<string, RotatorState>()

export const RotatorMolecule = molecule(() => {
	const scope = use(RotatorScope)
	const equipment = use(EquipmentMolecule)

	const rotator = equipment.get('ROTATOR', scope.rotator.name)!

	const state =
		stateMap.get(rotator.name) ??
		proxy<RotatorState>({
			rotator,
			angle: 0,
		})

	stateMap.set(rotator.name, state)

	onMount(() => {
		state.rotator = equipment.get('ROTATOR', state.rotator.name)!

		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<RotatorUpdated>('rotator:update', (event) => {
			if (event.device.id === rotator.id) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						addToast({ title: 'ROTATOR', description: `Failed to connect to rotator ${rotator.name}`, color: 'danger' })
					}

					state.rotator.connecting = false
				}
			}
		})

		unsubscribers[1] = initProxy(state, `rotator.${rotator.name}`, ['p:angle'])

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof RotatorState>(key: K, value: RotatorState[K]) {
		state[key] = value
	}

	function connect() {
		return equipment.connect(rotator)
	}

	function moveTo() {
		return Api.Rotators.moveTo(rotator, state.angle)
	}

	function sync() {
		return Api.Rotators.sync(rotator, state.angle)
	}

	function home() {
		return Api.Rotators.home(rotator)
	}

	function stop() {
		return Api.Rotators.stop(rotator)
	}

	function reverse(enabled: boolean) {
		return Api.Rotators.reverse(rotator, enabled)
	}

	function hide() {
		equipment.hide('ROTATOR', rotator)
	}

	return { state, scope, update, connect, moveTo, sync, reverse, home, stop, hide } as const
})
