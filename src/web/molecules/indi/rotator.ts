import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_ROTATOR, type Rotator } from 'nebulosa/src/indi.device'
import type { DeepReadonly } from 'nebulosa/src/types'
import bus from 'src/shared/bus'
import type { RotatorUpdated } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { equipmentStore, type DeviceState } from 'src/web/store/equipment.store'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { toast } from '@/shared/toast'

export interface RotatorScopeValue {
	readonly rotator: DeepReadonly<Omit<Rotator, symbol>>
}

export interface RotatorState {
	rotator: DeviceState<Rotator>
	readonly angle: number
}

export const RotatorScope = createScope<RotatorScopeValue>({ rotator: DEFAULT_ROTATOR })

const stateMap = new Map<string, RotatorState>()

export const RotatorMolecule = molecule(() => {
	const scope = use(RotatorScope)

	const rotator = equipmentStore.get('rotator', scope.rotator.id)!

	const state =
		stateMap.get(rotator.id) ??
		proxy<RotatorState>({
			rotator,
			angle: rotator.angle.value,
		})

	stateMap.set(rotator.id, state)

	onMount(() => {
		state.rotator = equipmentStore.get('rotator', state.rotator.id)!

		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<RotatorUpdated>('rotator:update', (event) => {
			if (event.device.id === rotator.id) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						toast({ title: 'ROTATOR', description: `Failed to connect to rotator ${rotator.name}`, color: 'danger' })
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
		return equipmentStore.connect(rotator)
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
		state.rotator.show = false
	}

	return { state, scope, update, connect, moveTo, sync, reverse, home, stop, hide } as const
})
