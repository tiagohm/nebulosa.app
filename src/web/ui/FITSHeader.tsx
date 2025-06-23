import { Listbox, ListboxItem, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { useModal } from '@/shared/hooks'

export const FITSHeader = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { info } = useSnapshot(viewer.state)
	const modal = useModal(() => viewer.closeModal('fitsHeader'))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[340px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-row items-center'>
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
									{Object.entries(info.headers).map(([key, value]) => (
										<ListboxItem description={key} key={key}>
											{value === true ? 'T' : value === false ? 'F' : value}
										</ListboxItem>
									))}
								</Listbox>
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}></ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
