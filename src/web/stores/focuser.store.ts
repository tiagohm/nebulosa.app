import type { Focuser } from 'nebulosa/src/indi.device'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { equipmentStore, type DeviceState } from './equipment.store'

export type FocuserStore = ReturnType<typeof focuserStore>

export interface FocuserState {
	focuser: DeviceState<Focuser>
	readonly request: {
		relative: number
		absolute: number
	}
}

const PROXY_PROPERTIES = ['o:request'] as const

export function focuserStore(focuser: Focuser) {
	const state = proxy<FocuserState>({
		focuser,
		request: { absolute: focuser.position.value, relative: 100 },
	})

	console.info('focuser created:', focuser.name)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('focuser mounted:', focuser.name)

		mounted = true

		u[0] = initProxy(state, `focuser.${focuser.id}`, PROXY_PROPERTIES)
	}

	function unmount() {
		if (!mounted) return
		console.info('focuser unmounted:', focuser.name)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof FocuserState['request']>(key: K, value: FocuserState['request'][K]) {
		state.request[key] = value
	}

	function connect() {
		return equipmentStore.connect(focuser)
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

	function show() {
		equipmentStore.show(focuser)
	}

	function hide() {
		equipmentStore.hide(focuser)
	}

	return {
		state,
		mount,
		unmount,
		update,
		connect,
		moveTo,
		moveIn,
		moveOut,
		sync,
		reverse,
		stop,
		show,
		hide,
	} as const
}
