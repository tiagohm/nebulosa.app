import { addToast } from '@heroui/react'
import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_FOCUSER, type Focuser } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { FocuserUpdated } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import type { DeepReadonly } from 'utility-types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface FocuserScopeValue {
	readonly focuser: DeepReadonly<Omit<Focuser, symbol>>
}

export interface FocuserState {
	focuser: EquipmentDevice<Focuser>
	readonly request: {
		readonly relative: number
		readonly absolute: number
	}
}

export const FocuserScope = createScope<FocuserScopeValue>({ focuser: DEFAULT_FOCUSER })

const stateMap = new Map<string, FocuserState>()

export const FocuserMolecule = molecule(() => {
	const scope = use(FocuserScope)
	const equipment = use(EquipmentMolecule)

	const focuser = equipment.get('FOCUSER', scope.focuser.name)!

	const state =
		stateMap.get(focuser.name) ??
		proxy<FocuserState>({
			focuser,
			request: { absolute: 0, relative: 100 },
		})

	stateMap.set(focuser.name, state)

	onMount(() => {
		state.focuser = equipment.get('FOCUSER', state.focuser.name)!

		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<FocuserUpdated>('focuser:update', (event) => {
			if (event.device.name === focuser.name) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						addToast({ title: 'FOCUSER', description: `Failed to connect to focuser ${focuser.name}`, color: 'danger' })
					}

					state.focuser.connecting = false
				}
			}
		})

		unsubscribers[1] = initProxy(state, `focuser.${focuser.name}`, ['o:request'])

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof FocuserState['request']>(key: K, value: FocuserState['request'][K]) {
		state.request[key] = value
	}

	function connect() {
		return equipment.connect(focuser)
	}

	function moveTo() {
		return Api.Focusers.moveTo(focuser, state.request.absolute)
	}

	function moveIn() {
		return Api.Focusers.moveIn(focuser, state.request.relative)
	}

	function moveOut() {
		return Api.Focusers.moveOut(focuser, state.request.relative)
	}

	function sync() {
		return Api.Focusers.sync(focuser, state.request.absolute)
	}

	function stop() {
		return Api.Focusers.stop(focuser)
	}

	function reverse(enabled: boolean) {
		return Api.Focusers.reverse(focuser, enabled)
	}

	function hide() {
		equipment.hide('FOCUSER', focuser)
	}

	return { state, scope, update, connect, moveTo, moveIn, moveOut, sync, reverse, stop, hide } as const
})
