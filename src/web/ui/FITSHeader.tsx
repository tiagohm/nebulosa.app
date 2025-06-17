import { Listbox, ListboxItem, Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { useSnapshot } from 'valtio'
import type { UseDraggableModalResult } from '@/shared/hooks'
import { ImageViewerMolecule } from '@/shared/molecules'

export interface FITSHeaderProps {
	readonly draggable: UseDraggableModalResult
}

export function FITSHeader({ draggable }: FITSHeaderProps) {
	const viewer = useMolecule(ImageViewerMolecule)
	const { info } = useSnapshot(viewer.state)

	return (
		<Modal backdrop='transparent' classNames={{ base: 'max-w-[390px] max-h-[90vh]', wrapper: 'pointer-events-none' }} isDismissable={false} isOpen={draggable.isOpen} onOpenChange={draggable.onOpenChange} ref={draggable.targetRef} size='sm'>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...draggable.moveProps} className='flex flex-row items-center'>
							FITS Header
						</ModalHeader>
						<ModalBody>
							<div className='w-full px-1 py-2'>
								<Listbox
									isVirtualized
									selectionMode='none'
									virtualization={{
										maxListboxHeight: 400,
										itemHeight: 40,
									}}>
									{Object.entries(info?.headers ?? {}).map(([key, value]) => (
										<ListboxItem description={key} key={key}>
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
