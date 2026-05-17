import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_WHEEL, type Wheel } from 'nebulosa/src/indi.device'
import type { DeepReadonly } from 'nebulosa/src/types'
import bus from 'src/shared/bus'
import type { WheelUpdated } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { equipmentStore, type DeviceState } from 'src/web/store/equipment.store'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { toast } from '@/shared/toast'

export interface WheelScopeValue {
	readonly wheel: DeepReadonly<Omit<Wheel, symbol>>
}

export interface WheelState {
	wheel: DeviceState<Wheel>
	readonly selected: {
		position: number
		name: string
	}
}

export const WheelScope = createScope<WheelScopeValue>({ wheel: DEFAULT_WHEEL })

const stateMap = new Map<string, WheelState>()

function slotCount(wheel: Pick<Wheel, 'count' | 'names'>) {
	const count = Number.isFinite(wheel.count) ? Math.max(0, Math.trunc(wheel.count)) : 0
	return Math.max(count, wheel.names.length)
}

function isValidSlotPosition(wheel: Pick<Wheel, 'count' | 'names'>, position: number) {
	return Number.isInteger(position) && position >= 0 && position < slotCount(wheel)
}

function slotName(wheel: Pick<Wheel, 'count' | 'names'>, position: number) {
	return isValidSlotPosition(wheel, position) ? (wheel.names[position] ?? `Slot ${position + 1}`) : ''
}

export const WheelMolecule = molecule(() => {
	const scope = use(WheelScope)

	const wheel = equipmentStore.get('wheel', scope.wheel.id)!

	const state =
		stateMap.get(wheel.id) ??
		proxy<WheelState>({
			wheel,
			selected: {
				position: wheel.position,
				name: slotName(wheel, wheel.position),
			},
		})

	stateMap.set(wheel.id, state)

	onMount(() => {
		state.wheel = equipmentStore.get('wheel', state.wheel.id)!

		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<WheelUpdated>('wheel:update', (event) => {
			if (event.device.id === state.wheel.id) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						toast({ title: 'FILTER WHEEL', description: `Failed to connect to filter wheel ${state.wheel.name}`, color: 'danger' })
					}

					state.wheel.connecting = false
				} else if (event.property === 'names') {
					state.selected.name = slotName(state.wheel, state.selected.position)
				}
			}
		})

		unsubscribers[1] = subscribeKey(state.selected, 'position', (position) => {
			state.selected.name = slotName(state.wheel, position)
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof WheelState['selected']>(key: K, value: WheelState['selected'][K]) {
		if (key === 'position') {
			if (!isValidSlotPosition(state.wheel, value as number)) return
		}

		state.selected[key] = value
	}

	async function connect() {
		try {
			return await equipmentStore.connect(state.wheel)
		} finally {
			state.wheel.connecting = false
		}
	}

	function moveTo() {
		if (!state.wheel.connected || state.wheel.moving || !isValidSlotPosition(state.wheel, state.selected.position)) return
		return Api.Wheels.moveTo(state.wheel, state.selected.position)
	}

	function apply() {
		if (!state.wheel.connected || state.wheel.moving || !state.wheel.canSetNames || !isValidSlotPosition(state.wheel, state.selected.position)) return

		const names = Array.from({ length: slotCount(state.wheel) }, (_, index) => state.wheel.names[index] ?? `Slot ${index + 1}`)
		names[state.selected.position] = state.selected.name
		return Api.Wheels.names(state.wheel, names)
	}

	function hide() {
		state.wheel.show = false
	}

	return { state, scope, update, connect, moveTo, apply, hide } as const
})
