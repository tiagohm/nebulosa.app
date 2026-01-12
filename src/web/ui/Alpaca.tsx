import { Listbox, ListboxItem, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { AlpacaMolecule } from '@/molecules/alpaca'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const Alpaca = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { devices, running, serverPort } = useSnapshot(alpaca.state.status)
	const { port } = useSnapshot(alpaca.state, { sync: true })

	const Footer = (
		<>
			<div className='flex flex-1 flex-row items-center'>
				<NumberInput className='max-w-25' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => (alpaca.state.port = value)} size='sm' value={running ? serverPort : port} />
			</div>
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={alpaca.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={running} label='Start' onPointerUp={alpaca.start} startContent={<Icons.Play />} />
		</>
	)

	return (
		<Modal footer={Footer} header='ASCOM Alpaca' id='alpaca' maxWidth='300px' onHide={alpaca.hide} subHeader={running ? `${devices.length} devices` : undefined}>
			<div className='mt-0 grid grid-cols-1 gap-2'>
				<Listbox classNames={{ list: 'max-h-[120px] overflow-scroll pe-1' }} emptyContent='No devices' items={devices}>
					{(item) => (
						<ListboxItem description={item.DeviceType} key={item.UniqueID}>
							{item.DeviceName} (#{item.DeviceNumber})
						</ListboxItem>
					)}
				</Listbox>
			</div>
		</Modal>
	)
})
