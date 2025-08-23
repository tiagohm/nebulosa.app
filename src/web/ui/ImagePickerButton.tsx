import { Button, Tooltip } from '@heroui/react'
import { ScopeProvider, useMolecule } from 'bunshi/react'
import { memo, useCallback } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerScope } from '@/molecules/filepicker'
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'

export const ImagePickerButton = memo(() => {
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { showModal } = useSnapshot(workspace.state)

	const handleChoose = useCallback((paths?: string[]) => {
		if (paths?.length) {
			for (const path of paths) {
				workspace.add(path, undefined, 'file')
			}
		}

		workspace.state.showModal = false
	}, [])

	return (
		<>
			<Tooltip content='Open Image' showArrow>
				<Button color='secondary' isIconOnly onPointerUp={() => (workspace.state.showModal = true)} variant='light'>
					<Icons.ImagePlus />
				</Button>
			</Tooltip>
			{showModal && (
				<ScopeProvider scope={FilePickerScope} value={{ path: workspace.state.initialPath, filter: '*.{fits,fit,xisf}', multiple: true }}>
					<FilePicker header='Open Image' name='open-image' onChoose={handleChoose} />
				</ScopeProvider>
			)}
		</>
	)
})
