import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { useModal } from '@/shared/hooks'
import { ImageViewerMolecule } from '@/shared/molecules'

export function PlateSolver() {
	const viewer = useMolecule(ImageViewerMolecule)
	const { plateSolver, info } = useSnapshot(viewer.state)
	const modal = useModal(() => (viewer.state.plateSolver.showModal = false))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[410px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-col gap-0'>
							<span>Plate Solver</span>
							<span className='text-xs font-normal text-gray-400'>{info.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'></div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='success' isLoading={plateSolver.loading} startContent={<Lucide.Sigma />} variant='flat'>
								Solve
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
