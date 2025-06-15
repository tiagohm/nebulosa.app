import type { UseDraggableModalResult } from '@/shared/hooks'
import { ImageViewerMolecule } from '@/shared/molecules'
import { Listbox, ListboxItem, Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { useSnapshot } from 'valtio'

export interface FITSHeaderProps {
	readonly draggable: UseDraggableModalResult
}

export function FITSHeader({ draggable }: FITSHeaderProps) {
	const viewer = useMolecule(ImageViewerMolecule)
	const { info } = useSnapshot(viewer.state)

	return (
		<Modal size='sm' ref={draggable.targetRef} isOpen={draggable.isOpen} onOpenChange={draggable.onOpenChange} classNames={{ base: 'max-w-[480px] max-h-[90vh]', wrapper: 'pointer-events-none' }} backdrop='transparent' isDismissable={false}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...draggable.moveProps} className='flex flex-row items-center'>
							FITS Header
						</ModalHeader>
						<ModalBody>
							<div className='w-full px-1 py-2'>
								<Listbox
									selectionMode='none'
									isVirtualized
									virtualization={{
										maxListboxHeight: 400,
										itemHeight: 40,
									}}>
									{Object.entries(info?.headers ?? {}).map(([key, value]) => (
										<ListboxItem key={key} description={key}>
											{value === true ? 'T' : value === false ? 'F' : value}
										</ListboxItem>
									))}
								</Listbox>
							</div>
						</ModalBody>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
