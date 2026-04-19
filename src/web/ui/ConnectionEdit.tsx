import { Input, Listbox, ListboxItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import type { AlpacaDeviceServer } from 'nebulosa/src/alpaca.discovery'
import { memo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { ConnectionMolecule } from '@/molecules/connection'
import { Button } from '@/ui/components/Button'
import { ClientTypeSelect } from './ClientTypeSelect'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { PopoverButton } from './PopoverButton'

export const ConnectionEdit = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const { mode } = useSnapshot(connection.state)

	return (
		<Modal footer={<Footer />} header='Connection' id='connection' maxWidth='256px' onHide={connection.hide} subHeader={mode}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const { name, host, port, type, secured } = useSnapshot(connection.state.edited, { sync: true })

	return (
		<div className='mt-0 grid grid-cols-12 gap-2 items-center'>
			<Input className='col-span-full' label='Name' maxLength={64} onValueChange={(value) => connection.update('name', value)} placeholder='Local' size='sm' type='text' value={name} />
			<Input className='col-span-7' isDisabled={type === 'SIMULATOR'} label='Host' maxLength={128} onValueChange={(value) => connection.update('host', value)} placeholder='localhost' size='sm' type='text' value={host} />
			<NumberInput className='col-span-5' disabled={type === 'SIMULATOR'} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => connection.update('port', value)} placeholder={type === 'INDI' ? '7624' : '32323'} value={port} />
			<ClientTypeSelect className='col-span-5' onValueChange={(value) => connection.update('type', value)} value={type} />
			<Checkbox className='col-span-5' disabled={type !== 'ALPACA'} label='Secured' onValueChange={(value) => connection.update('secured', value)} value={secured} />
			<div className='col-span-2'>
				<AlpacaDeviceServerDiscovery />
			</div>
		</div>
	)
})

const Footer = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const { name, host, port } = useSnapshot(connection.state.edited, { sync: true })

	return <Button color='success' disabled={!name || !host || !port} label='Save' onPointerUp={connection.save} startContent={<Icons.Check />} />
})

const AlpacaDeviceServerItem = (item: AlpacaDeviceServer) => (
	<ListboxItem description={item.devices.map((e) => e.DeviceName).join(' | ')} key={`${item.address}:${item.port}`}>
		{item.address}:{item.port}
	</ListboxItem>
)

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
		<PopoverButton color='secondary' disabled={edited.type !== 'ALPACA'} icon={Icons.Radar} isOpen={open} onOpenChange={setOpen} tooltipContent='Discovery'>
			<div className='max-w-100 mt-0 grid grid-cols-12 gap-2 p-4 items-center'>
				<p className='font-bold text-center col-span-full'>ALPACA DEVICE SERVER DISCOVERY</p>
				<Listbox className='col-span-full min-w-90' classNames={{ list: 'max-h-40 overflow-scroll' }} emptyContent='No servers' items={alpaca.servers} onAction={handleOnAction}>
					{AlpacaDeviceServerItem}
				</Listbox>
				<div className='col-span-full flex flex-row items-center justify-end'>
					<Button color='primary' label='Discovery' loading={alpaca.discovering} onPointerUp={connection.discovery} startContent={<Icons.Reload />} />
				</div>
			</div>
		</PopoverButton>
	)
})
