import { Button, Tooltip } from '@heroui/react'
import { ScopeProvider, useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { createPortal } from 'react-dom'
import { useSnapshot } from 'valtio'
import { useDraggableModal } from '@/shared/hooks'
import { FilePickerScope, HomeMolecule } from '@/shared/molecules'
import { FilePicker } from './FilePicker'

export function OpenImageButton() {
	const home = useMolecule(HomeMolecule)
	const { openImageLastPath } = useSnapshot(home.state)
	const openImageModal = useDraggableModal({ name: 'open-image' })

	function handleChoose(paths?: string[]) {
		if (paths?.length) {
			for (const path of paths) {
				home.addImage(path)
			}
		}
	}

	return (
		<>
			<Tooltip content='Open Image' showArrow>
				<Button color='secondary' isIconOnly onPointerUp={() => openImageModal.show()} variant='light'>
					<Lucide.ImagePlus />
				</Button>
			</Tooltip>
			{openImageModal.isOpen &&
				createPortal(
					<ScopeProvider scope={FilePickerScope} value={{ path: openImageLastPath, filter: '*.{fits,fit,xisf}', multiple: true }}>
						<FilePicker draggable={openImageModal} header='Open Image' onChoose={handleChoose} />
					</ScopeProvider>,
					document.body,
				)}
		</>
	)
}
