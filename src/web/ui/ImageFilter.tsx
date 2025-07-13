import { Button, Checkbox } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageFilterMolecule } from '@/molecules/image/filter'
import { Modal } from './Modal'

export const ImageFilter = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { viewer } = filter
	const { enabled, blur, median, sharpen } = useSnapshot(filter.state)
	const { info } = useSnapshot(viewer.state)

	return (
		<Modal
			footer={
				<>
					<Button color='danger' isDisabled={!enabled} onPointerUp={filter.reset} startContent={<Tabler.IconRestore size={18} />} variant='flat'>
						Reset
					</Button>
					<Button color='success' onPointerUp={filter.apply} startContent={<Lucide.Check size={18} />} variant='flat'>
						Apply
					</Button>
				</>
			}
			header={
				<div className='w-full flex flex-col justify-center gap-0'>
					<span>Filter</span>
					<span className='text-xs font-normal text-gray-400 max-w-full'>{info.originalPath}</span>
				</div>
			}
			name={`filter-${filter.scope.image.key}`}
			onClose={() => viewer.closeModal('filter')}>
			<div className='max-w-[190px] mt-0 grid grid-cols-12 gap-2'>
				<Checkbox className='col-span-full' isSelected={enabled} onValueChange={(value) => filter.update('enabled', value)}>
					Enabled
				</Checkbox>
				<Checkbox className='col-span-full' isDisabled={!enabled} isSelected={sharpen} onValueChange={(value) => filter.update('sharpen', value)}>
					Sharpen
				</Checkbox>
				<Checkbox className='col-span-full' isDisabled={!enabled} isSelected={blur} onValueChange={(value) => filter.update('blur', value)}>
					Blur
				</Checkbox>
				<Checkbox className='col-span-full' isDisabled={!enabled} isSelected={median} onValueChange={(value) => filter.update('median', value)}>
					Median
				</Checkbox>
			</div>
		</Modal>
	)
})
