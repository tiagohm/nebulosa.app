import { addToast } from '@heroui/react'
import { molecule } from 'bunshi'
import type { HipsSurvey } from 'nebulosa/src/hips2fits'
import { DEFAULT_FRAMING, type Framing } from 'src/api/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { ImageWorkspaceMolecule } from './image/workspace'

export interface FramingState {
	showModal: boolean
	readonly request: Framing
	hipsSurveys: HipsSurvey[]
	loading: boolean
}

// Molecule that manages the Framing modal
export const FramingMolecule = molecule((m) => {
	const workspace = m(ImageWorkspaceMolecule)

	const state = proxy<FramingState>({
		showModal: false,
		request: structuredClone(DEFAULT_FRAMING),
		hipsSurveys: [],
		loading: false,
	})

	Api.Framing.hipsSurveys().then((hipsSurveys) => (state.hipsSurveys = hipsSurveys))

	// Updates the framing state
	function update<K extends keyof FramingState['request']>(key: K, value: FramingState['request'][K]) {
		state.request[key] = value
	}

	// Loads the framing image and opens it in the workspace
	async function load() {
		try {
			state.loading = true
			const { path } = await Api.Framing.frame(state.request)
			workspace.add(path, 'framing', 'framing')
		} catch {
			addToast({ title: 'ERROR', description: 'Failed to load framing', color: 'danger' })
		} finally {
			state.loading = false
		}
	}

	// Shows the modal
	function show() {
		state.showModal = true
	}

	// Closes the modal
	function close() {
		state.showModal = false
	}

	return { state, update, load, show, close }
})
