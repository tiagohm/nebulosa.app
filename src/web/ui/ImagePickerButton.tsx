import { ScopeProvider, useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerScope } from '@/molecules/filepicker'
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { IconButton } from './components/IconButton'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'

const IMAGE_FILE_FILTER = '*.{fits,fit,xisf}'

export const ImagePickerButton = memo(() => {
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { path, show } = useSnapshot(workspace.state.picker)

	return (
		<>
			<IconButton color="secondary" icon={Icons.ImagePlus} onClick={workspace.showPicker} tooltipContent="Open Image" variant="ghost" />
			<ScopeProvider scope={FilePickerScope} value={{ filter: IMAGE_FILE_FILTER, multiple: true, path }}>
				{show && <FilePicker header="Open Image" id="open-image" onChoose={workspace.choose} />}
			</ScopeProvider>
		</>
	)
})
