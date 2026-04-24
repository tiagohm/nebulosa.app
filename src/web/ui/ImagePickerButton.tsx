import { ScopeProvider, useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerScope } from '@/molecules/filepicker'
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

export const ImagePickerButton = memo(() => {
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { show } = useSnapshot(workspace.state.picker)

	return (
		<>
			<IconButton color="secondary" icon={Icons.ImagePlus} onPointerUp={workspace.showPicker} tooltipContent="Open Image" variant="ghost" />
			<ScopeProvider scope={FilePickerScope} value={{ path: workspace.state.picker.path, filter: '*.{fits,fit,xisf}', multiple: true }}>
				<Activity mode={show ? 'visible' : 'hidden'}>
					<FilePicker header="Open Image" id="open-image" onChoose={workspace.choose} />
				</Activity>
			</ScopeProvider>
		</>
	)
})
