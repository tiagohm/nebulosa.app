import { Button, Tooltip } from '@heroui/react'
import { ScopeProvider, useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { FilePickerScope, HomeMolecule, ModalScope } from '@/shared/molecules'
import { FilePicker } from './FilePicker'

export function OpenImageButton() {
	const home = useMolecule(HomeMolecule)
	const { openImage } = useSnapshot(home.state)

	function handleChoose(paths?: string[]) {
		if (paths?.length) {
			for (const path of paths) {
				home.addImage(path)
			}
		}

		home.state.openImage.showModal = false
	}

	return (
		<>
			<Tooltip content='Open Image' showArrow>
				<Button color='secondary' isIconOnly onPointerUp={() => (home.state.openImage.showModal = true)} variant='light'>
					<Lucide.ImagePlus />
				</Button>
			</Tooltip>
			{openImage.showModal && (
				<ScopeProvider scope={FilePickerScope} value={{ path: openImage.lastPath, filter: '*.{fits,fit,xisf}', multiple: true }}>
					<ScopeProvider scope={ModalScope} value={{ name: 'open-image', isAlwaysOnTop: true }}>
						<FilePicker header='Open Image' onChoose={handleChoose} />
					</ScopeProvider>
				</ScopeProvider>
			)}
		</>
	)
}
