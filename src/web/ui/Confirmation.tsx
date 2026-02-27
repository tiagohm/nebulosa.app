import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConfirmationMolecule } from '@/molecules/confirmation'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const Confirmation = memo(() => {
	const confirmation = useMolecule(ConfirmationMolecule)

	if (!confirmation.state.show) return null

	return (
		<Modal footer={<Footer />} header='Confirmation' id='confirmation' maxWidth='336px' onHide={confirmation.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const confirmation = useMolecule(ConfirmationMolecule)
	const { message } = useSnapshot(confirmation.state)

	return <div className='px-1 py-2'>{message}</div>
})

const Footer = memo(() => {
	const confirmation = useMolecule(ConfirmationMolecule)

	return (
		<>
			<TextButton color='danger' label='Cancel' onPointerUp={confirmation.reject} startContent={<Icons.Close />} />
			<TextButton color='success' label='OK' onPointerUp={confirmation.accept} startContent={<Icons.Check />} />
		</>
	)
})
