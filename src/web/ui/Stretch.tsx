import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { useModal } from '@/shared/hooks'
import { ImageViewerMolecule } from '@/shared/molecules'

export function Stretch() {
	const viewer = useMolecule(ImageViewerMolecule)
	const { stretch, info } = useSnapshot(viewer.state)
	const modal = useModal(() => (viewer.state.stretch.showModal = false))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[410px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-col gap-0'>
							<span>Stretch</span>
							<span className='text-xs font-normal text-gray-400'>{info.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'></div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='success' startContent={<Lucide.Check />} variant='flat'>
								Apply
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
