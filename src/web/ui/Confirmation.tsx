import { Button } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConfirmationMolecule } from '@/molecules/confirmation'
import { Icons } from './Icon'
import { Modal } from './Modal'

export const Confirmation = memo(() => {
	const confirmation = useMolecule(ConfirmationMolecule)
	const { message } = useSnapshot(confirmation.state)

	return (
		<Modal
			footer={
				<>
					<Button color='danger' onPointerUp={confirmation.reject} startContent={<Icons.Close />} variant='flat'>
						Cancel
					</Button>
					<Button color='success' onPointerUp={confirmation.accept} startContent={<Icons.Check />} variant='flat'>
						OK
					</Button>
				</>
			}
			header='Confirmation'
			maxWidth='340px'
			name='confirmation'
			onClose={confirmation.close}>
			<div className='px-1 py-2'>{message}</div>
		</Modal>
	)
})
