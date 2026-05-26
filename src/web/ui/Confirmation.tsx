import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { confirmationStore } from '@/stores/confirmation.store'
import { Button } from './components/Button'
import { Icons } from './Icon'
import { Modal } from './Modal'

export const Confirmation = memo(() => {
	const { show } = useSnapshot(confirmationStore.state)

	if (!show) return null

	return (
		<Modal footer={<Footer />} header="Confirmation" id="confirmation" maxWidth="336px" onHide={confirmationStore.reject}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const { message } = useSnapshot(confirmationStore.state)

	return <div className="max-h-[50vh] overflow-y-auto px-1 py-2 text-sm leading-5 wrap-break-word whitespace-pre-wrap text-neutral-200">{message}</div>
})

const Footer = memo(() => {
	const { pending } = useSnapshot(confirmationStore.state)
	const isPending = pending !== undefined

	return (
		<>
			<Button color="danger" disabled={isPending} label="Cancel" loading={pending === 'reject'} onClick={confirmationStore.reject} startContent={<Icons.Close />} />
			<Button color="success" disabled={isPending} label="OK" loading={pending === 'accept'} onClick={confirmationStore.accept} startContent={<Icons.Check />} />
		</>
	)
})
