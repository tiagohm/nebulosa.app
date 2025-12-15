import { molecule, use } from 'bunshi'
import { Api } from '@/shared/api'
import { type ImageState, ImageViewerMolecule } from './viewer'

export const ImageSaveMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const state = viewer.state.save

	function update<K extends keyof ImageState['save']>(key: K, value: ImageState['save'][K]) {
		state[key] = value
	}

	async function save() {
		try {
			state.loading = true

			const transformation = { ...viewer.state.transformation, format: state.format }
			await Api.Image.save({ path: viewer.realPath(), transformation, saveAt: state.path, transformed: state.transformed })
		} finally {
			state.loading = false
		}
	}

	function show() {
		viewer.show('save')
	}

	function hide() {
		viewer.hide('save')
	}

	return { state, scope: viewer.scope, viewer, update, save, show, hide } as const
})
