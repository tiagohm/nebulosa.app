import { Button, Input, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConnectionMolecule } from '@/molecules/connection'
import { Modal } from './Modal'

export const ConnectionEdit = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const state = useSnapshot(connection.state)

	return (
		<Modal
			footer={
				<Button color='success' isDisabled={!state.edited?.name || !state.edited?.host || !state.edited?.port} onPointerUp={connection.save} startContent={<Lucide.Check size={18} />} variant='flat'>
					Save
				</Button>
			}
			header='Connection'
			name='connection'
			onClose={connection.close}>
			<div className='max-w-[260px] w-full grid grid-cols-12 gap-2'>
				<Input className='col-span-full' label='Name' maxLength={64} onValueChange={(value) => connection.update('name', value)} placeholder='Local' size='sm' type='text' value={state.edited?.name} />
				<Input className='col-span-7' label='Host' maxLength={128} onValueChange={(value) => connection.update('host', value)} placeholder='localhost' size='sm' type='text' value={state.edited?.host} />
				<NumberInput className='col-span-5' label='Port' maxValue={65535} minValue={80} onValueChange={(value) => connection.update('port', value)} placeholder='7624' size='sm' value={state.edited?.port} />
			</div>
		</Modal>
	)
})
