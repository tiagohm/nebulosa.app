import { Listbox, ListboxItem, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import type { AlpacaConfiguredDevice } from 'nebulosa/src/alpaca.types'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { AlpacaMolecule } from '@/molecules/alpaca'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const AlpacaServer = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { devices, running } = useSnapshot(alpaca.state.status)

	return (
		<Modal footer={<Footer />} header='ASCOM Alpaca Server' id='alpaca' maxWidth='296px' onHide={alpaca.hide} subHeader={running ? `${devices.length} devices` : undefined}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-1 gap-2'>
			<DeviceList />
		</div>
	)
})

const DeviceItem = (item: AlpacaConfiguredDevice) => (
	<ListboxItem description={item.DeviceType} key={item.UniqueID}>
		{item.DeviceName} (#{item.DeviceNumber})
	</ListboxItem>
)

const DeviceList = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { devices } = useSnapshot(alpaca.state.status)

	return (
		<Listbox classNames={{ list: 'max-h-[120px] overflow-scroll pe-1' }} emptyContent='No devices' items={devices}>
			{DeviceItem}
		</Listbox>
	)
})

const Footer = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { running } = useSnapshot(alpaca.state.status)
	const { port } = useSnapshot(alpaca.state)

	return (
		<>
			<NumberInput className='flex flex-1' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => (alpaca.state.port = value)} size='sm' value={port} />
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={alpaca.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={running} label='Start' onPointerUp={alpaca.start} startContent={<Icons.Play />} />
		</>
	)
})
