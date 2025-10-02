import { Input, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConnectionMolecule } from '@/molecules/connection'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ConnectionEdit = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const { edited } = useSnapshot(connection.state, { sync: true })

	const Footer = <TextButton color='success' isDisabled={!edited?.name || !edited?.host || !edited?.port} label='Save' onPointerUp={connection.save} startContent={<Icons.Check />} />

	return (
		<Modal footer={Footer} header='Connection' id='connection' maxWidth='240px' onHide={connection.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<Input className='col-span-full' label='Name' maxLength={64} onValueChange={(value) => connection.update('name', value)} placeholder='Local' size='sm' type='text' value={edited?.name} />
				<Input className='col-span-7' label='Host' maxLength={128} onValueChange={(value) => connection.update('host', value)} placeholder='localhost' size='sm' type='text' value={edited?.host} />
				<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => connection.update('port', value)} placeholder='7624' size='sm' value={edited?.port} />
			</div>
		</Modal>
	)
})
