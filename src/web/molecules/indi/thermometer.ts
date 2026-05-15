import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_THERMOMETER, type Thermometer } from 'nebulosa/src/indi.device'
import type { DeepReadonly } from 'nebulosa/src/types'
import bus from 'src/shared/bus'
import type { ThermometerUpdated } from 'src/shared/types'
import { equipment, type DeviceState } from 'src/web/store/equipment.store'
import { proxy } from 'valtio'
import { toast } from '@/shared/toast'

export interface ThermometerScopeValue {
	readonly thermometer: DeepReadonly<Omit<Thermometer, symbol>>
}

export interface ThermometerState {
	thermometer: DeviceState<Thermometer>
}

export const ThermometerScope = createScope<ThermometerScopeValue>({ thermometer: DEFAULT_THERMOMETER })

const stateMap = new Map<string, ThermometerState>()

export const ThermometerMolecule = molecule(() => {
	const scope = use(ThermometerScope)

	const thermometer = equipment.get('THERMOMETER', scope.thermometer.id)!

	const state =
		stateMap.get(thermometer.id) ??
		proxy<ThermometerState>({
			thermometer,
		})

	stateMap.set(thermometer.id, state)

	onMount(() => {
		state.thermometer = equipment.get('THERMOMETER', state.thermometer.id)!

		const unsubscriber = bus.subscribe<ThermometerUpdated>('thermometer:update', (event) => {
			if (event.device.id === thermometer.id) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						toast({ title: 'THERMOMETER', description: `Failed to connect to thermometer ${thermometer.name}`, color: 'danger' })
					}

					state.thermometer.connecting = false
				}
			}
		})

		return () => {
			unsubscriber()
		}
	})

	async function connect() {
		try {
			return await equipment.connect(state.thermometer)
		} finally {
			state.thermometer.connecting = false
		}
	}

	function hide() {
		state.thermometer.show = false
	}

	return { state, scope, connect, hide } as const
})
