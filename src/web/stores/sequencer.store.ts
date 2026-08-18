import type { DockviewPanelApi } from 'dockview-react'
import { proxy } from 'valtio'
import { DEFAULT_SEQUENCER } from '#/sequencer'
import type { Sequencer } from '#/sequencer'

export type SequencerStore = ReturnType<typeof sequencerStore>

export interface SequencerState {
	readonly request: Sequencer
}

export function sequencerStore(api: DockviewPanelApi) {
	const state = proxy<SequencerState>({
		request: structuredClone(DEFAULT_SEQUENCER),
	})

	function mount() {}

	function unmount() {}

	return {
		state,
		mount,
		unmount,
	} as const
}
