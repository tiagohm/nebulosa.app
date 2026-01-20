import { Checkbox, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageAdjustmentMolecule } from '@/molecules/image/adjustment'
import { DECIMAL_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { ImageChannelOrGrayInput } from './ImageChannelOrGrayInput'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageAdjustment = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { enabled } = useSnapshot(adjustment.state.adjustment)

	const Footer = (
		<>
			<TextButton color='danger' isDisabled={!enabled} label='Reset' onPointerUp={adjustment.reset} startContent={<Icons.Restore />} />
			<TextButton color='success' label='Adjust' onPointerUp={adjustment.apply} startContent={<Icons.Check />} />
		</>
	)

	return (
		<Modal footer={Footer} header='Adjustment' id={`adjustment-${adjustment.scope.image.key}`} maxWidth='256px' onHide={adjustment.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<Checkbox className='col-span-full' isSelected={enabled} onValueChange={(value) => (adjustment.state.adjustment.enabled = value)}>
					Enabled
				</Checkbox>
				<Brightness />
				<Contrast />
				<Gamma />
				<Saturation />
			</div>
		</Modal>
	)
})

const Brightness = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { enabled, brightness } = useSnapshot(adjustment.state.adjustment)

	return (
		<div className='col-span-full flex flex-col gap-2'>
			<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Brightness' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('brightness', 'value', value)} size='sm' step={0.01} value={brightness.value} />
		</div>
	)
})

const Contrast = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { enabled, contrast } = useSnapshot(adjustment.state.adjustment)

	return (
		<div className='col-span-full flex flex-col gap-2'>
			<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Contrast' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('contrast', 'value', value)} size='sm' step={0.01} value={contrast.value} />
		</div>
	)
})

const Gamma = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { enabled, gamma } = useSnapshot(adjustment.state.adjustment)

	return (
		<div className='col-span-full flex flex-col gap-2'>
			<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Gamma' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('gamma', 'value', value)} size='sm' step={0.01} value={gamma.value} />
		</div>
	)
})

const Saturation = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { info } = useSnapshot(adjustment.viewer.state)
	const { enabled, saturation } = useSnapshot(adjustment.state.adjustment)

	return (
		<Activity mode={info?.mono ? 'hidden' : 'visible'}>
			<div className='col-span-full flex flex-col gap-2'>
				<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Saturation' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('saturation', 'value', value)} size='sm' step={0.01} value={saturation.value} />
				<ImageChannelOrGrayInput isDisabled={!enabled || saturation.value === 1} onValueChange={(value) => adjustment.update('saturation', 'channel', value)} value={saturation.channel} />
			</div>
		</Activity>
	)
})
