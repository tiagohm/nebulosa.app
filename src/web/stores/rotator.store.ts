import type { Rotator } from 'nebulosa/src/devices/indi/device'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { equipmentStore, type DeviceState } from './equipment.store'

export type RotatorStore = ReturnType<typeof rotatorStore>

export interface RotatorState {
	rotator: DeviceState<Rotator>
	readonly angle: number
}

const PROXY_PROPERTIES = ['p:angle'] as const

export function rotatorStore(rotator: Rotator) {
	const state = proxy<RotatorState>({
		rotator,
		angle: rotator.angle.value,
	})

	console.info('rotator created:', rotator.name)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('rotator mounted:', rotator.name)

		mounted = true

		u[0] = initProxy(state, `rotator.${rotator.id}`, PROXY_PROPERTIES)
	}

	function unmount() {
		if (!mounted) return
		console.info('rotator unmounted:', rotator.name)
		unsubscribe(u)
		mounted = false
	}

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

	function show() {
		equipmentStore.show(rotator)
	}

	function hide() {
		equipmentStore.hide(rotator)
	}

	return {
		state,
		mount,
		unmount,
		update,
		connect,
		moveTo,
		sync,
		reverse,
		home,
		stop,
		show,
		hide,
	} as const
}
