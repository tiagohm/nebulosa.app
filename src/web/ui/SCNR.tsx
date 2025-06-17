import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import type { UseDraggableModalResult } from '@/shared/hooks'
import { ImageViewerMolecule } from '@/shared/molecules'

export interface SCNRProps {
	readonly draggable: UseDraggableModalResult
}

export function SCNR({ draggable }: SCNRProps) {
	const viewer = useMolecule(ImageViewerMolecule)
	const { starDetection, info } = useSnapshot(viewer.state)

	return (
		<Modal backdrop='transparent' classNames={{ base: 'max-w-[410px] max-h-[90vh]', wrapper: 'pointer-events-none' }} isDismissable={false} isOpen={draggable.isOpen} onOpenChange={draggable.onOpenChange} onPointerUp={draggable.onPointerUp} ref={draggable.targetRef} size='sm'>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...draggable.moveProps} className='flex flex-col gap-0'>
							<span>SCNR</span>
							<span className='text-xs font-normal text-gray-400'>{info?.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'></div>
						</ModalBody>
						<ModalFooter>
							<Button color='success' isLoading={starDetection.loading} onPointerUp={() => viewer.detectStars()} startContent={<Lucide.Check />} variant='flat'>
								Apply
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
