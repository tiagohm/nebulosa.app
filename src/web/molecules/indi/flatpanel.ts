import { addToast } from '@heroui/react'
import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_FLAT_PANEL, type FlatPanel } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { FlatPanelUpdated } from 'src/shared/types'
import type { DeepReadonly } from 'utility-types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface FlatPanelScopeValue {
	readonly flatPanel: DeepReadonly<Omit<FlatPanel, symbol>>
}

export interface FlatPanelState {
	flatPanel: EquipmentDevice<FlatPanel>
}

export const FlatPanelScope = createScope<FlatPanelScopeValue>({ flatPanel: DEFAULT_FLAT_PANEL })

const stateMap = new Map<string, FlatPanelState>()

export const FlatPanelMolecule = molecule(() => {
	const scope = use(FlatPanelScope)
	const equipment = use(EquipmentMolecule)

	const flatPanel = equipment.get('FLAT_PANEL', scope.flatPanel.name)!

	const state =
		stateMap.get(flatPanel.name) ??
		proxy<FlatPanelState>({
			flatPanel,
		})

	stateMap.set(flatPanel.name, state)

	onMount(() => {
		state.flatPanel = equipment.get('FLAT_PANEL', state.flatPanel.name)!

		const unsubscriber = bus.subscribe<FlatPanelUpdated>('flatPanel:update', (event) => {
			if (event.device.name === flatPanel.name) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						addToast({ title: 'FLAT PANEL', description: `Failed to connect to flat panel ${flatPanel.name}`, color: 'danger' })
					}

					state.flatPanel.connecting = false
				}
			}
		})

		return () => {
			unsubscriber()
		}
	})

	function connect() {
		return equipment.connect(flatPanel)
	}

	function update(value: number | number[]) {
		flatPanel.intensity.value = typeof value === 'number' ? value : value[0]
	}

	function enable() {
		return Api.FlatPanels.enable(flatPanel)
	}

	function disable() {
		return Api.FlatPanels.disable(flatPanel)
	}

	function toggle(force?: boolean) {
		return (force ?? !flatPanel.enabled) ? enable() : disable()
	}

	function intensity(value: number | number[]) {
		return Api.FlatPanels.intensity(flatPanel, typeof value === 'number' ? value : value[0])
	}

	function hide() {
		equipment.hide('FLAT_PANEL', flatPanel)
	}

	return { state, scope, connect, update, enable, disable, toggle, intensity, hide } as const
})
