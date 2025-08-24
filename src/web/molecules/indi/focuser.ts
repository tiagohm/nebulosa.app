import { createScope, molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import { DEFAULT_FOCUSER, type Focuser, type FocuserUpdated } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { EquipmentMolecule } from './equipment'

export interface FocuserScopeValue {
	readonly focuser: Focuser
}

export interface FocuserState {
	readonly focuser: Focuser
	connecting: boolean
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

	const request = simpleLocalStorage.get<FocuserState['request']>(`focuser.${scope.focuser.name}.request`, () => ({ absolute: 0, relative: 100 }))

	const state =
		focuserStateMap.get(scope.focuser.name) ??
		proxy<FocuserState>({
			focuser: equipment.get('focuser', scope.focuser.name)!,
			connecting: false,
			request,
		})

	focuserStateMap.set(scope.focuser.name, state)

	Api.Focusers.get(scope.focuser.name).then((focuser) => {
		if (!focuser) return
		Object.assign(state.focuser, focuser)
		state.connecting = false
	})

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<FocuserUpdated>('focuser:update', (event) => {
			if (event.device.name === state.focuser.name) {
				if (event.property === 'connected') {
					state.connecting = false
				}
			}
		})

		unsubscribers[1] = subscribe(state.request, () => simpleLocalStorage.set(`focuser.${scope.focuser.name}.request`, state.request))

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof FocuserState['request']>(key: K, value: FocuserState['request'][K]) {
		state.request[key] = value
	}

	async function connect() {
		state.connecting = true

		if (state.focuser.connected) {
			await Api.Indi.disconnect(state.focuser)
		} else {
			await Api.Indi.connect(state.focuser)
		}
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

	function close() {
		equipment.close('focuser', scope.focuser)
	}

	return { state, scope, update, connect, moveTo, moveIn, moveOut, sync, reverse, stop, close } as const
})
