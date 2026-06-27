import type { FlatPanel } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { equipmentStore, type DeviceState } from './equipment.store'

export type FlatPanelStore = ReturnType<typeof flatPanelStore>

export interface FlatPanelState {
	flatPanel: DeviceState<FlatPanel>
}

export function flatPanelStore(flatPanel: FlatPanel) {
	const state = proxy<FlatPanelState>({
		flatPanel,
	})

	console.info('flat panel created:', flatPanel.name)

	function mount() {
		console.info('flat panel mounted:', flatPanel.name)
	}

	function unmount() {
		console.info('flat panel unmounted:', flatPanel.name)
	}

	function connect() {
		return equipmentStore.connect(flatPanel)
	}

	function update(value: number) {
		flatPanel.intensity.value = value
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

	function intensity(value: number) {
		return Api.FlatPanels.intensity(flatPanel, value)
	}

	function show() {
		return equipmentStore.show(flatPanel)
	}

	function hide() {
		return equipmentStore.hide(flatPanel)
	}

	return {
		state,
		mount,
		unmount,
		connect,
		update,
		enable,
		disable,
		toggle,
		intensity,
		show,
		hide,
	} as const
}
