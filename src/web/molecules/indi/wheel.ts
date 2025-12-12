import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_WHEEL, type Wheel } from 'nebulosa/src/indi.device'
import { unsubscribe } from 'src/shared/bus'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface WheelScopeValue {
	readonly wheel: Wheel
}

export interface WheelState {
	readonly wheel: EquipmentDevice<Wheel>
	readonly selected: {
		slot: number
		name: string
	}
}

export const WheelScope = createScope<WheelScopeValue>({ wheel: DEFAULT_WHEEL })

const stateMap = new Map<string, WheelState>()

export const WheelMolecule = molecule(() => {
	const scope = use(WheelScope)
	const equipment = use(EquipmentMolecule)

	const wheel = equipment.get('WHEEL', scope.wheel.name)!

	const state =
		stateMap.get(wheel.name) ??
		proxy<WheelState>({
			wheel,
			selected: {
				slot: wheel.position,
				name: wheel.slots[wheel.position] || '',
			},
		})

	stateMap.set(wheel.name, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(1)

		unsubscribers[0] = subscribeKey(state.selected, 'slot', (position) => {
			state.selected.name = wheel.slots[position]
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update<K extends keyof WheelState['selected']>(key: K, value: WheelState['selected'][K]) {
		state.selected[key] = value

		if (key === 'name') {
			wheel.slots[state.selected.slot] = value as never
			void slots()
		}
	}

	function connect() {
		return equipment.connect(wheel)
	}

	function moveTo() {
		return Api.Wheels.moveTo(wheel, state.selected.slot)
	}

	function slots() {
		return Api.Wheels.slots(wheel, wheel.slots)
	}

	function hide() {
		equipment.hide('WHEEL', wheel)
	}

	return { state, scope, update, connect, moveTo, slots, hide } as const
})
