import { Checkbox, Input, Listbox, ListboxItem, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { ConnectionMolecule } from '@/molecules/connection'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { ClientTypeSelect } from './ClientTypeSelect'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { PopoverButton } from './PopoverButton'
import { TextButton } from './TextButton'

export const ConnectionEdit = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const { mode } = useSnapshot(connection.state)
	const { name, host, port, type, secured } = useSnapshot(connection.state.edited, { sync: true })

	const Footer = <TextButton color='success' isDisabled={!name || !host || !port} label='Save' onPointerUp={connection.save} startContent={<Icons.Check />} />

	return (
		<Modal footer={Footer} header='Connection' id='connection' maxWidth='256px' onHide={connection.hide} subHeader={mode}>
			<div className='mt-0 grid grid-cols-12 gap-2 items-center'>
				<Input className='col-span-full' label='Name' maxLength={64} onValueChange={(value) => connection.update('name', value)} placeholder='Local' size='sm' type='text' value={name} />
				<Input className='col-span-7' label='Host' maxLength={128} onValueChange={(value) => connection.update('host', value)} placeholder='localhost' size='sm' type='text' value={host} />
				<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => connection.update('port', value)} placeholder={type === 'INDI' ? '7624' : '32323'} size='sm' value={port} />
				<ClientTypeSelect className='col-span-5' onValueChange={(value) => connection.update('type', value)} value={type} />
				<Checkbox className='col-span-5' isDisabled={type !== 'ALPACA'} isSelected={secured} onValueChange={(value) => connection.update('secured', value)}>
					Secured
				</Checkbox>
				<div className='col-span-2'>
					<AlpacaDeviceServerDiscovery />
				</div>
			</div>
		</Modal>
	)
})

const AlpacaDeviceServerDiscovery = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const { alpaca, edited } = useSnapshot(connection.state)
	const [open, setOpen] = useState(false)

	function handleOnAction(key: React.Key) {
		if (typeof key === 'string') {
			const [host, port] = key.split(':')
			connection.state.edited.host = host
			connection.state.edited.port = +port
			setOpen(false)
		}
	}

	return (
		<PopoverButton color='secondary' icon={Icons.Radar} isDisabled={edited.type !== 'ALPACA'} isOpen={open} onOpenChange={setOpen} tooltipContent='Discovery'>
			<div className='max-w-100 mt-0 grid grid-cols-12 gap-2 p-4 items-center'>
				<p className='font-bold text-center col-span-full'>ALPACA DEVICE SERVER DISCOVERY</p>
				<Listbox className='col-span-full min-w-90' classNames={{ list: 'max-h-[120px] overflow-scroll' }} emptyContent='No servers' items={alpaca.servers} onAction={handleOnAction}>
					{(item) => (
						<ListboxItem description={item.devices.map((e) => e.DeviceName).join(' | ')} key={`${item.address}:${item.port}`}>
							{item.address}:{item.port}
						</ListboxItem>
					)}
				</Listbox>
				<div className='col-span-full flex flex-row items-center justify-end'>
					<TextButton color='primary' isLoading={alpaca.discovering} label='Discovery' onPointerUp={connection.discovery} startContent={<Icons.Reload />} />
				</div>
			</div>
		</PopoverButton>
	)
})
