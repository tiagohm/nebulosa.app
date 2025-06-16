import type { UseDraggableModalResult } from '@/shared/hooks'
import { ConnectionMolecule } from '@/shared/molecules'
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'

export interface ConnectionEditProps {
	readonly draggable: UseDraggableModalResult
}

export function ConnectionEdit({ draggable }: ConnectionEditProps) {
	const connection = useMolecule(ConnectionMolecule)
	const state = useSnapshot(connection.state)

	return (
		<Modal size='sm' ref={draggable.targetRef} isOpen={draggable.isOpen} onOpenChange={draggable.onOpenChange} backdrop='transparent' classNames={{ wrapper: 'pointer-events-none' }} isDismissable={false} onPointerUp={draggable.onPointerUp}>
			<ModalContent>
				{(onClose) => (
					<>
						<ModalHeader {...draggable.moveProps} className='flex flex-row items-center'>
							Connection
						</ModalHeader>
						<ModalBody>
							<div className='grid grid-cols-6 gap-2'>
								<Input label='Name' size='sm' className='col-span-full' placeholder='Local' type='text' maxLength={64} value={state.edited?.name} onValueChange={(value) => connection.update('name', value)} />
								<Input label='Host' size='sm' className='col-span-4' placeholder='localhost' type='text' maxLength={128} value={state.edited?.host} onValueChange={(value) => connection.update('host', value)} />
								<NumberInput label='Port' size='sm' className='col-span-2' placeholder='7624' minValue={80} maxValue={65535} value={state.edited?.port} onValueChange={(value) => connection.update('port', value)} />
							</div>
						</ModalBody>
						<ModalFooter>
							<Button isDisabled={!state.edited?.name || !state.edited?.host || !state.edited?.port} color='success' variant='flat' startContent={<Lucide.Check />} onPointerUp={() => connection.save(draggable)}>
								Save
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
