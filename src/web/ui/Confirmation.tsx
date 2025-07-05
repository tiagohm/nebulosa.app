import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConfirmationMolecule } from '@/molecules/confirmation'
import { useModal } from '@/shared/hooks'

export const Confirmation = memo(() => {
	const confirmation = useMolecule(ConfirmationMolecule)
	const { message } = useSnapshot(confirmation.state)
	const modal = useModal(() => confirmation.close())

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[340px] max-h-[90vh]', wrapper: 'pointer-events-none' }} hideCloseButton>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-row items-center'>
							Confirmation
						</ModalHeader>
						<ModalBody>
							<div className='w-full px-1 py-2'></div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='danger' onPointerUp={confirmation.reject} startContent={<Lucide.X size={18} />} variant='flat'>
								Cancel
							</Button>
							<Button color='success' onPointerUp={confirmation.accept} startContent={<Lucide.Check size={18} />} variant='flat'>
								OK
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
