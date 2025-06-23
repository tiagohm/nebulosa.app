import { Button, Checkbox, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageFilterMolecule } from '@/molecules/image/filter'
import { useModal } from '@/shared/hooks'

export const ImageFilter = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { viewer } = filter
	const { enabled, blur, median, sharpen } = useSnapshot(filter.state)
	const { info } = useSnapshot(viewer.state)
	const modal = useModal(() => viewer.closeModal('filter'))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[230px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-col gap-0'>
							<span>Filter</span>
							<span className='text-xs font-normal text-gray-400'>{info.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'>
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
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='danger' isDisabled={!enabled} onPointerUp={() => filter.reset()} startContent={<Tabler.IconRestore />} variant='flat'>
								Reset
							</Button>
							<Button color='success' onPointerUp={() => filter.apply()} startContent={<Lucide.Check />} variant='flat'>
								Apply
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
