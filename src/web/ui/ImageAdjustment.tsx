import { Button, Checkbox, NumberInput } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageAdjustmentMolecule } from '@/molecules/image/adjustment'
import { Modal } from './Modal'

export const ImageAdjustment = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { viewer } = adjustment
	const { enabled, brightness, gamma, normalize, saturation } = useSnapshot(adjustment.state)
	const { info } = useSnapshot(viewer.state)

	return (
		<Modal
			footer={
				<>
					<Button color='danger' isDisabled={!enabled} onPointerUp={adjustment.reset} startContent={<Tabler.IconRestore size={18} />} variant='flat'>
						Reset
					</Button>
					<Button color='success' onPointerUp={adjustment.apply} startContent={<Lucide.Check size={18} />} variant='flat'>
						Adjust
					</Button>
				</>
			}
			header={
				<div className='w-full flex flex-col justify-center gap-0'>
					<span>Adjustment</span>
					<span className='text-xs font-normal text-gray-400 max-w-full'>{info.originalPath}</span>
				</div>
			}
			maxWidth='202px'
			name={`adjustment-${adjustment.scope.image.key}`}
			onClose={() => viewer.closeModal('adjustment')}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<Checkbox className='col-span-full' isSelected={enabled} onValueChange={(value) => adjustment.update('enabled', value)}>
					Enabled
				</Checkbox>
				<Checkbox className='col-span-full' isDisabled={!enabled} isSelected={normalize} onValueChange={(value) => adjustment.update('normalize', value)}>
					Normalize
				</Checkbox>
				<NumberInput className='col-span-full' isDisabled={!enabled} label='Brightness' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('brightness', value)} size='sm' step={0.01} value={brightness} />
				<NumberInput className='col-span-full' isDisabled={!enabled} label='Gamma' maxValue={3} minValue={1} onValueChange={(value) => adjustment.update('gamma', value)} size='sm' step={0.01} value={gamma} />
				<NumberInput className='col-span-full' isDisabled={!enabled} label='Saturation' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('saturation', value)} size='sm' step={0.01} value={saturation} />
			</div>
		</Modal>
	)
})
