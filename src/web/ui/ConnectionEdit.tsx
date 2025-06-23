import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConnectionMolecule } from '@/molecules/connection'
import { useModal } from '@/shared/hooks'

export const ConnectionEdit = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const state = useSnapshot(connection.state)
	const modal = useModal(() => (connection.state.showModal = false))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[300px]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-row items-center'>
							Connection
						</ModalHeader>
						<ModalBody>
							<div className='grid grid-cols-6 gap-2'>
								<Input className='col-span-full' label='Name' maxLength={64} onValueChange={(value) => connection.update('name', value)} placeholder='Local' size='sm' type='text' value={state.edited?.name} />
								<Input className='col-span-4' label='Host' maxLength={128} onValueChange={(value) => connection.update('host', value)} placeholder='localhost' size='sm' type='text' value={state.edited?.host} />
								<NumberInput className='col-span-2' label='Port' maxValue={65535} minValue={80} onValueChange={(value) => connection.update('port', value)} placeholder='7624' size='sm' value={state.edited?.port} />
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='success' isDisabled={!state.edited?.name || !state.edited?.host || !state.edited?.port} onPointerUp={() => connection.save()} startContent={<Lucide.Check />} variant='flat'>
								Save
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
