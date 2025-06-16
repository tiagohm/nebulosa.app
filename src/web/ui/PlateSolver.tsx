import type { UseDraggableModalResult } from '@/shared/hooks'
import { ImageViewerMolecule } from '@/shared/molecules'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'

export interface PlateSolverProps {
	readonly draggable: UseDraggableModalResult
}

export function PlateSolver({ draggable }: PlateSolverProps) {
	const viewer = useMolecule(ImageViewerMolecule)
	const { starDetection, info } = useSnapshot(viewer.state)

	return (
		<Modal size='sm' ref={draggable.targetRef} isOpen={draggable.isOpen} onOpenChange={draggable.onOpenChange} classNames={{ base: 'max-w-[410px] max-h-[90vh]', wrapper: 'pointer-events-none' }} backdrop='transparent' isDismissable={false} onPointerUp={draggable.onPointerUp}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...draggable.moveProps} className='flex flex-col gap-0'>
							<span>Plate Solver</span>
							<span className='text-xs font-normal text-gray-400'>{info?.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'></div>
						</ModalBody>
						<ModalFooter>
							<Button isLoading={starDetection.loading} color='success' variant='flat' startContent={<Lucide.Sigma />} onPointerUp={() => viewer.detectStars()}>
								Solve
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
