import { useDraggableModal } from '@/shared/hooks'
import { FilePickerScope, HomeMolecule } from '@/shared/molecules'
// biome-ignore format:
import { Button, Navbar, NavbarBrand, NavbarContent, Tooltip } from '@heroui/react'
import { ScopeProvider, useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { About } from './About'
import { ConnectionBox } from './ConnectionBox'
import { FilePicker } from './FilePicker'
import { HomeMenu, type HomeMenuItem } from './HomeMenu'
import { ImageWorkspace } from './ImageWorkspace'

export default function Home() {
	return (
		<div className='w-full h-full flex flex-col'>
			<TopBar />
			<ImageWorkspace />
		</div>
	)
}

function TopBar() {
	const home = useMolecule(HomeMolecule)
	const { openImageLastPath } = useSnapshot(home.state)
	const openImageModal = useDraggableModal({ name: 'open-image' })
	const aboutModal = useDraggableModal({ name: 'about' })

	function handleImageChoose(paths?: string[]) {
		if (paths?.length) {
			for (const path of paths) {
				home.addImage(path)
			}
		}
	}

	function handleHomeMenuPointerUp(type: HomeMenuItem) {
		if (type === 'about') aboutModal.show()
	}

	return (
		<>
			<Navbar isBlurred={false} className='bg-neutral-900 shadow'>
				<NavbarBrand>
					<ConnectionBox />
				</NavbarBrand>
				<NavbarContent className='flex gap-4 flex-1' justify='center'>
					<div className='flex flex-row w-full justify-start items-center gap-2'>
						<HomeMenu onItemPointerUp={handleHomeMenuPointerUp} />
						<Tooltip content='Open Image' showArrow>
							<Button isIconOnly color='secondary' variant='light' onPointerUp={() => openImageModal.show()}>
								<Lucide.ImagePlus />
							</Button>
						</Tooltip>
					</div>
				</NavbarContent>
			</Navbar>
			<ScopeProvider scope={FilePickerScope} value={{ path: openImageLastPath, filter: '*.{fits,fit,xisf}', multiple: true }}>
				<FilePicker draggable={openImageModal} onChoose={handleImageChoose} header='Open Image' />
			</ScopeProvider>
			<About draggable={aboutModal} />
		</>
	)
}
