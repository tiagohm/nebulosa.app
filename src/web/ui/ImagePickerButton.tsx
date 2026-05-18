import { ScopeProvider } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerScope } from '@/molecules/filepicker'
import { imageWorkspaceStore } from '../store/image.workspace.store'
import { IconButton } from './components/IconButton'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'

const IMAGE_FILE_FILTER = '*.{fits,fit,xisf}'

export const ImagePickerButton = memo(() => {
	const { path, show } = useSnapshot(imageWorkspaceStore.state.picker)

	return (
		<>
			<IconButton color="secondary" icon={Icons.ImagePlus} onClick={imageWorkspaceStore.showPicker} tooltipContent="Open Image" variant="ghost" />
			<ScopeProvider scope={FilePickerScope} value={{ filter: IMAGE_FILE_FILTER, multiple: true, path }}>
				{show && <FilePicker header="Open Image" id="open-image" onChoose={imageWorkspaceStore.choose} />}
			</ScopeProvider>
		</>
	)
})
