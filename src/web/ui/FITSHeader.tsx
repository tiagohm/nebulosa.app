import { Listbox, ListboxItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageHeaderMolecule } from '@/molecules/image/header'
import { Modal } from './Modal'

export const FITSHeader = memo(() => {
	const header = useMolecule(ImageHeaderMolecule)
	const { info } = useSnapshot(header.viewer.state)

	if (!info) return null

	return (
		<Modal header='FITS Header' id={`fits-header-${header.viewer.storageKey}`} maxWidth='296px' onHide={header.hide}>
			<div className='mt-0 px-1 py-2'>
				<Listbox
					isVirtualized
					selectionMode='none'
					virtualization={{
						maxListboxHeight: 300,
						itemHeight: 40,
					}}>
					{Object.entries(info.headers).map(([key, value]) => (
						<ListboxItem description={key} key={key}>
							{value === true ? 'T' : value === false ? 'F' : value}
						</ListboxItem>
					))}
				</Listbox>
			</div>
		</Modal>
	)
})
