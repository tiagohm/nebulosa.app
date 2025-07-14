import { createScope, molecule, onMount } from 'bunshi'
import { BusMolecule } from 'src/shared/bus'
import { DEFAULT_THERMOMETER, type Thermometer, type ThermometerUpdated } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { EquipmentMolecule } from './equipment'

export interface ThermometerScopeValue {
	readonly thermometer: Thermometer
}

export interface ThermometerState {
	readonly thermometer: Thermometer
	connecting: boolean
}

export const ThermometerScope = createScope<ThermometerScopeValue>({ thermometer: DEFAULT_THERMOMETER })

const thermometerStateMap = new Map<string, ThermometerState>()

// Molecule that manages the thermometer device
export const ThermometerMolecule = molecule((m, s) => {
	const scope = s(ThermometerScope)
	const bus = m(BusMolecule)
	const equipment = m(EquipmentMolecule)

	const state =
		thermometerStateMap.get(scope.thermometer.name) ??
		proxy<ThermometerState>({
			thermometer: equipment.get('thermometer', scope.thermometer.name) as Thermometer,
			connecting: false,
		})

	thermometerStateMap.set(scope.thermometer.name, state)

	// Fetches the thermometer
	Api.Thermometers.get(scope.thermometer.name).then((thermometer) => {
		if (!thermometer) return
		Object.assign(state.thermometer, thermometer)
	})

	onMount(() => {
		const unsubscriber = bus.subscribe<ThermometerUpdated>('thermometer:update', (event) => {
			if (event.device.name === state.thermometer.name) {
				if (event.property === 'connected') {
					state.connecting = false
				}
			}
		})

		return () => {
			unsubscriber()
		}
	})

	// Connects or disconnects the mount based on its current state
	async function connectOrDisconnect() {
		state.connecting = true

		if (state.thermometer.connected) {
			await Api.Indi.disconnect(state.thermometer)
		} else {
			await Api.Indi.connect(state.thermometer)
		}
	}

	// Closes the thermometer modal
	function close() {
		equipment.closeModal('thermometer', scope.thermometer)
	}

	return { state, scope, connectOrDisconnect, close } as const
})
