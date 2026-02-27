import { Listbox, ListboxItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import type { FitsHeaderValue } from 'nebulosa/src/fits'
import { memo, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageHeaderMolecule } from '@/molecules/image/header'
import { Modal } from './Modal'

export const FITSHeader = memo(() => {
	const header = useMolecule(ImageHeaderMolecule)

	return (
		<Modal header='FITS Header' id={`fits-header-${header.viewer.storageKey}`} maxWidth='296px' onHide={header.hide}>
			<Body />
		</Modal>
	)
})

const FitsKeywordItem = ([key, value]: [string, FitsHeaderValue]) => (
	<ListboxItem description={key} key={key}>
		{value === true ? 'T' : value === false ? 'F' : value}
	</ListboxItem>
)

const Body = memo(() => {
	const header = useMolecule(ImageHeaderMolecule)
	const { info } = useSnapshot(header.viewer.state)

	const entries = useMemo(() => Object.entries(info?.headers ?? {}), [info])

	return (
		<div className='mt-0 px-1 py-2'>
			<Listbox
				isVirtualized
				selectionMode='none'
				virtualization={{
					maxListboxHeight: 300,
					itemHeight: 40,
				}}>
				{entries.map(FitsKeywordItem)}
			</Listbox>
		</div>
	)
})
