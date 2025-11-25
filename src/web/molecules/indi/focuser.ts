import { createScope, molecule, onMount } from 'bunshi'
import { DEFAULT_FOCUSER, type Focuser } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
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

const stateMap = new Map<string, FocuserState>()

export const FocuserMolecule = molecule((m, s) => {
	const scope = s(FocuserScope)
	const equipment = m(EquipmentMolecule)

	const state =
		stateMap.get(scope.focuser.name) ??
		proxy<FocuserState>({
			focuser: equipment.get('FOCUSER', scope.focuser.name)!,
			request: { absolute: 0, relative: 100 },
		})

	stateMap.set(scope.focuser.name, state)

	onMount(() => {
		const unsubscriber = initProxy(state, `focuser.${scope.focuser.name}`, ['o:request'])

		return () => {
			unsubscriber()
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
