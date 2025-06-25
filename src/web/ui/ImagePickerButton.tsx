import { Button, Tooltip } from '@heroui/react'
import { ScopeProvider, useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FilePickerScope } from '@/molecules/filepicker'
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { ModalScope } from '@/molecules/modal'
import { FilePicker } from './FilePicker'

export const ImagePickerButton = memo(() => {
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { showModal } = useSnapshot(workspace.state)

	function handleChoose(paths?: string[]) {
		if (paths?.length) {
			for (const path of paths) {
				workspace.add(path, undefined, 'file')
			}
		}

		workspace.state.showModal = false
	}

	return (
		<>
			<Tooltip content='Open Image' showArrow>
				<Button color='secondary' isIconOnly onPointerUp={() => (workspace.state.showModal = true)} variant='light'>
					<Lucide.ImagePlus />
				</Button>
			</Tooltip>
			{showModal && (
				<ScopeProvider scope={FilePickerScope} value={{ path: workspace.state.lastPath, filter: '*.{fits,fit,xisf}', multiple: true }}>
					<ScopeProvider scope={ModalScope} value={{ name: 'open-image', isAlwaysOnTop: true }}>
						<FilePicker header='Open Image' onChoose={handleChoose} />
					</ScopeProvider>
				</ScopeProvider>
			)}
		</>
	)
})
