import { Checkbox, NumberInput, Tab, Tabs } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageFilterMolecule } from '@/molecules/image/filter'
import { DECIMAL_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { ImageFFTFilterTypeRadioGroup } from './ImageFFTFilterTypeRadioGroup'
import { ImageKernelFilterTypeRadioGroup } from './ImageKernelFilterTypeRadioGroup'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageFilter = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)

	return (
		<Modal footer={<Footer />} header='Filter' id={`filter-${filter.viewer.storageKey}`} maxWidth='216px' onHide={filter.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Tabs classNames={{ base: 'col-span-full', panel: 'col-span-full' }}>
				<Tab title='Kernel'>
					<Kernel />
				</Tab>
				<Tab title='FFT'>
					<FFT />
				</Tab>
			</Tabs>
		</div>
	)
})

const Kernel = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type } = useSnapshot(filter.state.kernel)

	return (
		<div className='grid grid-cols-12 gap-2'>
			<Checkbox className='col-span-full' isSelected={enabled} onValueChange={(value) => (filter.state.kernel.enabled = value)}>
				Enabled
			</Checkbox>
			<ImageKernelFilterTypeRadioGroup className='col-span-full' isDisabled={!enabled} onValueChange={filter.updateKernelType} value={type} />
			<Mean />
			<Blur />
			<GaussianBlur />
		</div>
	)
})

const Mean = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type, mean } = useSnapshot(filter.state.kernel)

	return (
		<Activity mode={type === 'mean' ? 'visible' : 'hidden'}>
			<div className='col-span-full flex flex-col gap-2'>
				<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Size' maxValue={15} minValue={3} onValueChange={(value) => filter.updateKernel('mean', 'size', value)} size='sm' step={2} value={mean.size} />
			</div>
		</Activity>
	)
})

const Blur = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type, blur } = useSnapshot(filter.state.kernel)

	return (
		<Activity mode={type === 'blur' ? 'visible' : 'hidden'}>
			<div className='col-span-full flex flex-col gap-2'>
				<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Size' maxValue={15} minValue={3} onValueChange={(value) => filter.updateKernel('blur', 'size', value)} size='sm' step={2} value={blur.size} />
			</div>
		</Activity>
	)
})

const GaussianBlur = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type, gaussianBlur } = useSnapshot(filter.state.kernel)

	return (
		<Activity mode={type === 'gaussianBlur' ? 'visible' : 'hidden'}>
			<div className='col-span-full flex flex-col gap-2'>
				<NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Size' maxValue={15} minValue={3} onValueChange={(value) => filter.updateKernel('gaussianBlur', 'size', value)} size='sm' step={2} value={gaussianBlur.size} />
				<NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Sigma' maxValue={3} minValue={1} onValueChange={(value) => filter.updateKernel('gaussianBlur', 'sigma', value)} size='sm' step={0.01} value={gaussianBlur.sigma} />
			</div>
		</Activity>
	)
})

const FFT = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type, cutoff, weight } = useSnapshot(filter.state.fft)

	return (
		<div className='grid grid-cols-12 gap-2'>
			<Checkbox className='col-span-full' isSelected={enabled} onValueChange={(value) => (filter.state.fft.enabled = value)}>
				Enabled
			</Checkbox>
			<ImageFFTFilterTypeRadioGroup className='col-span-full' isDisabled={!enabled} onValueChange={filter.updateFFTType} value={type} />
			<NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} label='Cutoff' maxValue={1} minValue={0} onValueChange={(value) => filter.updateFFT('cutoff', value)} size='sm' step={0.001} value={cutoff} />
			<NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} label='Weight' maxValue={1} minValue={0} onValueChange={(value) => filter.updateFFT('weight', value)} size='sm' step={0.001} value={weight} />
		</div>
	)
})

const Footer = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)

	return (
		<>
			<TextButton color='danger' label='Reset' onPointerUp={filter.reset} startContent={<Icons.Restore />} />
			<TextButton color='success' label='Apply' onPointerUp={filter.apply} startContent={<Icons.Check />} />
		</>
	)
})
