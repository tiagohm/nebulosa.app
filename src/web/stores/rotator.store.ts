import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { equipmentStore, type DeviceState } from '@stores/equipment.store'
import type { Rotator } from 'nebulosa/src/devices/indi/device'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type RotatorStore = ReturnType<typeof rotatorStore>

export interface RotatorState {
	rotator: DeviceState<Rotator>
	angle: number
}

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

		u[0] = initProxy(state, `rotator.${rotator.id}`, ['p:angle'])
	}

	function unmount() {
		if (!mounted) return
		console.info('rotator unmounted:', rotator.name)
		unsubscribe(u)
		mounted = false
	}

	function setAngle(value: number) {
		state.angle = value
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

	return {
		state,
		mount,
		unmount,
		setAngle,
		connect,
		moveTo,
		sync,
		reverse,
		home,
		stop,
	} as const
}
