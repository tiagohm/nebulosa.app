import { createScope, molecule } from 'bunshi'
import { DEFAULT_FLAT_PANEL, type FlatPanel } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface FlatPanelScopeValue {
	readonly flatPanel: FlatPanel
}

export interface FlatPanelState {
	readonly flatPanel: EquipmentDevice<FlatPanel>
}

export const FlatPanelScope = createScope<FlatPanelScopeValue>({ flatPanel: DEFAULT_FLAT_PANEL })

const flatPanelStateMap = new Map<string, FlatPanelState>()

export const FlatPanelMolecule = molecule((m, s) => {
	const scope = s(FlatPanelScope)
	const equipment = m(EquipmentMolecule)

	const state =
		flatPanelStateMap.get(scope.flatPanel.name) ??
		proxy<FlatPanelState>({
			flatPanel: equipment.get('FLAT_PANEL', scope.flatPanel.name)!,
		})

	flatPanelStateMap.set(scope.flatPanel.name, state)

	function connect() {
		return equipment.connect(state.flatPanel)
	}

	function enable() {
		return Api.FlatPanels.enable(scope.flatPanel)
	}

	function disable() {
		return Api.FlatPanels.disable(scope.flatPanel)
	}

	function toggle(force?: boolean) {
		return (force === undefined ? !state.flatPanel.enabled : force) ? enable() : disable()
	}

	function intensity(value: number) {
		return Api.FlatPanels.intensity(scope.flatPanel, value)
	}

	function hide() {
		equipment.hide('FLAT_PANEL', scope.flatPanel)
	}

	return { state, scope, connect, enable, disable, toggle, intensity, hide } as const
})
