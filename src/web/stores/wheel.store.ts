import { Api } from '@shared/api'
import { equipmentStore } from '@stores/equipment.store'
import type { DeviceState } from '@stores/equipment.store'
import type { Wheel } from 'nebulosa/src/devices/indi/device'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'

export type WheelStore = ReturnType<typeof wheelStore>

export interface WheelState {
	wheel: DeviceState<Wheel>
	readonly selected: {
		position: number
		name: string
	}
}

function slotCount(wheel: Wheel) {
	const count = Number.isFinite(wheel.count) ? Math.max(0, Math.trunc(wheel.count)) : 0
	return Math.max(count, wheel.names.length)
}

function isValidSlotPosition(wheel: Wheel, position: number) {
	return Number.isInteger(position) && position >= 0 && position < slotCount(wheel)
}

function slotName(wheel: Wheel, position: number) {
	return isValidSlotPosition(wheel, position) ? (wheel.names[position] ?? `Slot ${position + 1}`) : ''
}

export function wheelStore(wheel: Wheel) {
	const state = proxy<WheelState>({
		wheel,
		selected: {
			position: wheel.position,
			name: slotName(wheel, wheel.position),
		},
	})

	console.info('wheel created:', wheel.name)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return unmount

		console.info('wheel mounted:', wheel.name)

		mounted = true

		function refresh() {
			state.selected.name = slotName(wheel, state.selected.position)
		}

		u[0] = subscribeKey(wheel, 'position', refresh)
		u[1] = subscribeKey(wheel, 'names', refresh)

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('wheel unmounted:', wheel.name)
		unsubscribe(u)
		mounted = false
	}

	function setPosition(value: number) {
		if (!isValidSlotPosition(wheel, value)) return
		state.selected.position = value
	}

	function setName(value: string) {
		state.selected.name = value
	}

	function connect() {
		return equipmentStore.connect(wheel)
	}

	function move() {
		if (!wheel.connected || wheel.moving || !isValidSlotPosition(wheel, state.selected.position)) return
		return Api.Wheels.moveTo(wheel, state.selected.position)
	}

	function apply() {
		if (!wheel.connected || wheel.moving || !wheel.canSetNames || !isValidSlotPosition(wheel, state.selected.position) || !state.selected.name) return

		const names = new Array<string>(slotCount(wheel))
		for (let i = 0; i < names.length; i++) names[i] = wheel.names[i] ?? `Slot ${i + 1}`
		names[state.selected.position] = state.selected.name
		return Api.Wheels.names(wheel, names)
	}

	return {
		state,
		mount,
		unmount,
		setPosition,
		setName,
		connect,
		move,
		apply,
	} as const
}
