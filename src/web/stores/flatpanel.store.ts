import { Api } from '@shared/api'
import { equipmentStore, type DeviceState } from '@stores/equipment.store'
import type { FlatPanel } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'

export type FlatPanelStore = ReturnType<typeof flatPanelStore>

export interface FlatPanelState {
	flatPanel: DeviceState<FlatPanel>
}

export function flatPanelStore(flatPanel: FlatPanel) {
	const state = proxy<FlatPanelState>({
		flatPanel,
	})

	console.info('flat panel created:', flatPanel.name)

	let mounted = false

	function mount() {
		if (mounted) return unmount
		console.info('flat panel mounted:', flatPanel.name)
		mounted = true
		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('flat panel unmounted:', flatPanel.name)
		mounted = false
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
	} as const
}
