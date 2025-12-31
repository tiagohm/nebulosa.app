import { Listbox, ListboxItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { AlpacaMolecule } from '@/molecules/alpaca'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const Alpaca = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { devices, running } = useSnapshot(alpaca.state.status)

	const Footer = (
		<>
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={alpaca.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={running} label='Start' onPointerUp={alpaca.start} startContent={<Icons.Play />} />
		</>
	)

	return (
		<Modal footer={Footer} header='ASCOM Alpaca' id='alpaca' maxWidth='300px' onHide={alpaca.hide}>
			<div className='mt-0 grid grid-cols-1 gap-2'>
				<Listbox classNames={{ list: 'max-h-[200px] overflow-scroll pe-1' }} items={devices}>
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
