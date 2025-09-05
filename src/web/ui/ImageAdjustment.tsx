import { Checkbox, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageAdjustmentMolecule } from '@/molecules/image/adjustment'
import { DECIMAL_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageAdjustment = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { enabled, brightness, contrast, gamma, normalize, saturation } = useSnapshot(adjustment.state)

	const Footer = (
		<>
			<TextButton color='danger' isDisabled={!enabled} label='Reset' onPointerUp={adjustment.reset} startContent={<Icons.Restore />} />
			<TextButton color='success' label='Adjust' onPointerUp={adjustment.apply} startContent={<Icons.Check />} />
		</>
	)

	return (
		<Modal footer={Footer} header='Adjustment' maxWidth='202px' name={`adjustment-${adjustment.scope.image.key}`} onHide={adjustment.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<Checkbox className='col-span-full' isSelected={enabled} onValueChange={(value) => adjustment.update('enabled', value)}>
					Enabled
				</Checkbox>
				<Checkbox className='col-span-full' isDisabled={!enabled} isSelected={normalize} onValueChange={(value) => adjustment.update('normalize', value)}>
					Normalize
				</Checkbox>
				<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Brightness' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('brightness', value)} size='sm' step={0.01} value={brightness} />
				<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Contrast' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('contrast', value)} size='sm' step={0.01} value={contrast} />
				<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Gamma' maxValue={3} minValue={1} onValueChange={(value) => adjustment.update('gamma', value)} size='sm' step={0.01} value={gamma} />
				<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Saturation' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('saturation', value)} size='sm' step={0.01} value={saturation} />
			</div>
		</Modal>
	)
})
