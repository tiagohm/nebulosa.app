import { Listbox, ListboxItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { AlpacaMolecule } from '@/molecules/alpaca'
import { Modal } from './Modal'

export const Alpaca = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { configuredDevices } = useSnapshot(alpaca.state)

	return (
		<Modal header='ASCOM Alpaca' id='alpaca' maxWidth='300px' onHide={alpaca.hide}>
			<div className='mt-0 grid grid-cols-1 gap-2'>
				<Listbox classNames={{ list: 'max-h-[200px] overflow-scroll pe-1' }} items={configuredDevices}>
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
