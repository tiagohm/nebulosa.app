import { Listbox, ListboxItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { Modal } from './Modal'

export const FITSHeader = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { info } = useSnapshot(viewer.state)

	return (
		<Modal
			header={
				<div className='w-full flex flex-col justify-center gap-0'>
					<span>FITS Header</span>
					<span className='text-xs font-normal text-gray-400 max-w-full'>{info.originalPath}</span>
				</div>
			}
			maxWidth='300px'
			name={`fits-header-${viewer.scope.image.key}`}
			onClose={() => viewer.close('fitsHeader')}>
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
