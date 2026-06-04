import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { imageWorkspaceStore } from '@/stores/image.workspace.store'
import { IconButton } from './components/IconButton'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'

const IMAGE_FILE_FILTER = '*.{fits,fit,xisf}'

export const ImagePickerButton = memo(() => {
	const { path, show } = useSnapshot(imageWorkspaceStore.state.picker)

	return (
		<>
			<IconButton color="secondary" icon={Icons.ImagePlus} onClick={imageWorkspaceStore.showPicker} tooltipContent="Open Image" variant="ghost" />
			{show && <FilePicker header="Open Image" id="open-image" onChoose={imageWorkspaceStore.choose} path={path} filter={IMAGE_FILE_FILTER} multiple />}
		</>
	)
})
