import { createScope, molecule, use } from 'bunshi'
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
