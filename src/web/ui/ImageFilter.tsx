import { Checkbox, Radio, RadioGroup } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageFilterMolecule } from '@/molecules/image/filter'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageFilter = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type } = useSnapshot(filter.state.filter, { sync: true })

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
				<RadioGroup className='col-span-full' isDisabled={!enabled} onValueChange={(value) => filter.update('type', value as never)} value={type}>
					<Radio value='sharpen'>Sharpen</Radio>
					<Radio value='mean'>Mean</Radio>
					<Radio value='blur'>Blur</Radio>
				</RadioGroup>
			</div>
		</Modal>
	)
})
