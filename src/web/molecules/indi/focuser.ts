import { createScope, molecule, onMount } from 'bunshi'
import { unsubscribe } from 'src/shared/bus'
import { DEFAULT_FOCUSER, type Focuser } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { storage } from '@/shared/storage'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface FocuserScopeValue {
	readonly focuser: Focuser
}

export interface FocuserState {
	readonly focuser: EquipmentDevice<Focuser>
	readonly request: {
		readonly relative: number
		readonly absolute: number
	}
}

export const FocuserScope = createScope<FocuserScopeValue>({ focuser: DEFAULT_FOCUSER })

const focuserStateMap = new Map<string, FocuserState>()

export const FocuserMolecule = molecule((m, s) => {
	const scope = s(FocuserScope)
	const equipment = m(EquipmentMolecule)

	const request = storage.get<FocuserState['request']>(`focuser.${scope.focuser.name}.request`, () => ({ absolute: 0, relative: 100 }))

	const state =
		focuserStateMap.get(scope.focuser.name) ??
		proxy<FocuserState>({
			focuser: equipment.get('FOCUSER', scope.focuser.name)!,
			request,
		})

	focuserStateMap.set(scope.focuser.name, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(1)

		unsubscribers[0] = subscribe(state.request, () => {
			storage.set(`focuser.${scope.focuser.name}.request`, state.request)
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof FocuserState['request']>(key: K, value: FocuserState['request'][K]) {
		state.request[key] = value
	}

	function connect() {
		return equipment.connect(state.focuser)
	}

	function moveTo() {
		return Api.Focusers.moveTo(state.focuser, state.request.absolute)
	}

	function moveIn() {
		return Api.Focusers.moveIn(state.focuser, state.request.relative)
	}

	function moveOut() {
		return Api.Focusers.moveOut(state.focuser, state.request.relative)
	}

	function sync() {
		return Api.Focusers.sync(state.focuser, state.request.absolute)
	}

	function stop() {
		return Api.Focusers.stop(state.focuser)
	}

	function reverse(enabled: boolean) {
		return Api.Focusers.reverse(state.focuser, enabled)
	}

	function hide() {
		equipment.hide('FOCUSER', scope.focuser)
	}

	return { state, scope, update, connect, moveTo, moveIn, moveOut, sync, reverse, stop, hide } as const
})
