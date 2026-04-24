import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConfirmationMolecule } from '@/molecules/confirmation'
import { Button } from './components/Button'
import { Icons } from './Icon'
import { Modal } from './Modal'

export const Confirmation = memo(() => {
	const confirmation = useMolecule(ConfirmationMolecule)
	const { show } = useSnapshot(confirmation.state)

	if (!show) return null

	return (
		<Modal footer={<Footer />} header="Confirmation" id="confirmation" maxWidth="336px" onHide={confirmation.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const confirmation = useMolecule(ConfirmationMolecule)
	const { message } = useSnapshot(confirmation.state)

	return <div className="px-1 py-2">{message}</div>
})

const Footer = memo(() => {
	const confirmation = useMolecule(ConfirmationMolecule)

	return (
		<>
			<Button color="danger" label="Cancel" onPointerUp={confirmation.reject} startContent={<Icons.Close />} />
			<Button color="success" label="OK" onPointerUp={confirmation.accept} startContent={<Icons.Check />} />
		</>
	)
})
