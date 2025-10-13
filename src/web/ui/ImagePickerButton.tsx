import { Tooltip } from '@heroui/react'
import { ScopeProvider, useMolecule } from 'bunshi/react'
import { memo, useCallback } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerScope } from '@/molecules/filepicker'
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

export const ImagePickerButton = memo(() => {
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { showPicker } = useSnapshot(workspace.state)

	const handleChoose = useCallback((paths?: string[]) => {
		if (paths?.length) {
			for (const path of paths) {
				workspace.add(path, undefined, 'file')
			}
		}

		workspace.hidePicker()
	}, [])

	return (
		<>
			<Tooltip content='Open Image' showArrow>
				<IconButton color='secondary' icon={Icons.ImagePlus} onPointerUp={workspace.showPicker} variant='light' />
			</Tooltip>
			{showPicker && (
				<ScopeProvider scope={FilePickerScope} value={{ path: workspace.state.initialPath, filter: '*.{fits,fit,xisf}', multiple: true }}>
					<FilePicker header='Open Image' id='open-image' onChoose={handleChoose} />
				</ScopeProvider>
			)}
		</>
	)
})
