import { Checkbox } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageFilterMolecule } from '@/molecules/image/filter'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageFilter = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, blur, median, sharpen } = useSnapshot(filter.state)

	const Footer = (
		<>
			<TextButton color='danger' isDisabled={!enabled} label='Reset' onPointerUp={filter.reset} startContent={<Icons.Restore />} />
			<TextButton color='success' label='Apply' onPointerUp={filter.apply} startContent={<Icons.Check />} />
		</>
	)

	return (
		<Modal footer={Footer} header='Filter' id={`filter-${filter.scope.image.key}`} maxWidth='200px' onHide={filter.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
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
