import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageAdjustmentMolecule } from '@/molecules/image/adjustment'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { ImageChannelOrGrayInput } from './ImageChannelOrGrayInput'
import { Modal } from './Modal'

export const ImageAdjustment = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)

	return (
		<Modal footer={<Footer />} header='Adjustment' id={`adjustment-${adjustment.viewer.storageKey}`} maxWidth='256px' onHide={adjustment.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Enabled />
			<Brightness />
			<Contrast />
			<Gamma />
			<Saturation />
		</div>
	)
})

const Enabled = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { enabled } = useSnapshot(adjustment.state.adjustment)

	return <Checkbox className='col-span-full' label='Enabled' onValueChange={(value) => (adjustment.state.adjustment.enabled = value)} value={enabled} />
})

const Brightness = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { enabled, brightness } = useSnapshot(adjustment.state.adjustment)

	return (
		<div className='col-span-full flex flex-col gap-2'>
			<NumberInput className='col-span-full' disabled={!enabled} fractionDigits={2} label='Brightness' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('brightness', 'value', value)} step={0.01} value={brightness.value} />
		</div>
	)
})

const Contrast = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { enabled, contrast } = useSnapshot(adjustment.state.adjustment)

	return (
		<div className='col-span-full flex flex-col gap-2'>
			<NumberInput className='col-span-full' disabled={!enabled} fractionDigits={2} label='Contrast' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('contrast', 'value', value)} step={0.01} value={contrast.value} />
		</div>
	)
})

const Gamma = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { enabled, gamma } = useSnapshot(adjustment.state.adjustment)

	return (
		<div className='col-span-full flex flex-col gap-2'>
			<NumberInput className='col-span-full' disabled={!enabled} fractionDigits={2} label='Gamma' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('gamma', 'value', value)} step={0.01} value={gamma.value} />
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
				<NumberInput className='col-span-full' disabled={!enabled} fractionDigits={2} label='Saturation' maxValue={10} minValue={0} onValueChange={(value) => adjustment.update('saturation', 'value', value)} step={0.01} value={saturation.value} />
				<ImageChannelOrGrayInput isDisabled={!enabled || saturation.value === 1} onValueChange={(value) => adjustment.update('saturation', 'channel', value)} value={saturation.channel} />
			</div>
		</Activity>
	)
})

const Footer = memo(() => {
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { enabled } = useSnapshot(adjustment.state.adjustment)

	return (
		<>
			<Button color='danger' disabled={!enabled} label='Reset' onPointerUp={adjustment.reset} startContent={<Icons.Restore />} />
			<Button color='success' label='Adjust' onPointerUp={adjustment.apply} startContent={<Icons.Check />} />
		</>
	)
})
