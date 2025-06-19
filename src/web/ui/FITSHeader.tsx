import { Listbox, ListboxItem, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { useSnapshot } from 'valtio'
import { useModal } from '@/shared/hooks'
import { ImageViewerMolecule } from '@/shared/molecules'

export function FITSHeader() {
	const modal = useModal()
	const viewer = useMolecule(ImageViewerMolecule)
	const { info } = useSnapshot(viewer.state)

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[390px] max-h-[90vh]', wrapper: 'pointer-events-none' }} onOpenChange={(value) => (viewer.state.fitsHeader.showModal = value)}>
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
									{Object.entries(info?.headers ?? {}).map(([key, value]) => (
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
}
