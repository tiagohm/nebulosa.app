import { molecule } from 'bunshi'
import { Api } from '@/shared/api'
import { type ImageState, ImageViewerMolecule, ImageViewerScope } from './viewer'

export const ImageSaveMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const state = viewer.state.save

	function update<K extends keyof ImageState['save']>(key: K, value: ImageState['save'][K]) {
		state[key] = value
	}

	async function save() {
		try {
			state.loading = true
			const path = scope.image.path.split('#')[0]
			const transformation = { ...viewer.state.transformation, format: state.format }
			await Api.Image.save({ path, transformation, savePath: state.path, transformed: state.transformed })
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

	return { state, scope, viewer, update, save, show, hide } as const
})
