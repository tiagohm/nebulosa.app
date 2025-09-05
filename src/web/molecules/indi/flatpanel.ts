import { createScope, molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { DEFAULT_FLAT_PANEL, type FlatPanel, type FlatPanelUpdated } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { EquipmentMolecule } from './equipment'

export interface FlatPanelScopeValue {
	readonly flatPanel: FlatPanel
}

export interface FlatPanelState {
	readonly flatPanel: FlatPanel
	connecting: boolean
}

export const FlatPanelScope = createScope<FlatPanelScopeValue>({ flatPanel: DEFAULT_FLAT_PANEL })

const flatPanelStateMap = new Map<string, FlatPanelState>()

export const FlatPanelMolecule = molecule((m, s) => {
	const scope = s(FlatPanelScope)
	const equipment = m(EquipmentMolecule)

	const state =
		flatPanelStateMap.get(scope.flatPanel.name) ??
		proxy<FlatPanelState>({
			flatPanel: equipment.get('flatPanel', scope.flatPanel.name)!,
			connecting: false,
		})

	flatPanelStateMap.set(scope.flatPanel.name, state)

	Api.FlatPanels.get(scope.flatPanel.name).then((flatPanel) => {
		if (!flatPanel) return
		Object.assign(state.flatPanel, flatPanel)
		state.connecting = false
	})

	onMount(() => {
		const unsubscriber = bus.subscribe<FlatPanelUpdated>('flatPanel:update', (event) => {
			if (event.device.name === state.flatPanel.name) {
				if (event.property === 'connected') {
					state.connecting = false
				}
			}
		})

		return () => {
			unsubscriber()
		}
	})

	async function connect() {
		state.connecting = true

		if (state.flatPanel.connected) {
			await Api.Indi.disconnect(state.flatPanel)
		} else {
			await Api.Indi.connect(state.flatPanel)
		}
	}

	function enable() {
		return Api.FlatPanels.enable(scope.flatPanel)
	}

	function disable() {
		return Api.FlatPanels.disable(scope.flatPanel)
	}

	function intensity(value: number) {
		return Api.FlatPanels.intensity(scope.flatPanel, value)
	}

	function hide() {
		equipment.hide('flatPanel', scope.flatPanel)
	}

	return { state, scope, connect, enable, disable, intensity, hide } as const
})
