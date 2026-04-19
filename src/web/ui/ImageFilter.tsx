import { Tab, Tabs } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageFilterMolecule } from '@/molecules/image/filter'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { ImageFFTFilterTypeRadioGroup } from './ImageFFTFilterTypeRadioGroup'
import { ImageKernelFilterTypeRadioGroup } from './ImageKernelFilterTypeRadioGroup'
import { Modal } from './Modal'

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
			<Checkbox className='col-span-full' label='Enabled' onValueChange={(value) => (filter.state.kernel.enabled = value)} value={enabled} />
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
				<NumberInput className='col-span-full' disabled={!enabled} label='Size' maxValue={15} minValue={3} onValueChange={(value) => filter.updateKernel('mean', 'size', value)} step={2} value={mean.size} />
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
				<NumberInput className='col-span-full' disabled={!enabled} label='Size' maxValue={15} minValue={3} onValueChange={(value) => filter.updateKernel('blur', 'size', value)} step={2} value={blur.size} />
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
				<NumberInput className='col-span-6' disabled={!enabled} label='Size' maxValue={15} minValue={3} onValueChange={(value) => filter.updateKernel('gaussianBlur', 'size', value)} step={2} value={gaussianBlur.size} />
				<NumberInput className='col-span-6' disabled={!enabled} fractionDigits={2} label='Sigma' maxValue={3} minValue={1} onValueChange={(value) => filter.updateKernel('gaussianBlur', 'sigma', value)} step={0.01} value={gaussianBlur.sigma} />
			</div>
		</Activity>
	)
})

const FFT = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type, cutoff, weight } = useSnapshot(filter.state.fft)

	return (
		<div className='grid grid-cols-12 gap-2'>
			<Checkbox className='col-span-full' label='Enabled' onValueChange={(value) => (filter.state.fft.enabled = value)} value={enabled} />
			<ImageFFTFilterTypeRadioGroup className='col-span-full' isDisabled={!enabled} onValueChange={filter.updateFFTType} value={type} />
			<NumberInput className='col-span-6' fractionDigits={3} label='Cutoff' maxValue={1} minValue={0} onValueChange={(value) => filter.updateFFT('cutoff', value)} step={0.001} value={cutoff} />
			<NumberInput className='col-span-6' fractionDigits={3} label='Weight' maxValue={1} minValue={0} onValueChange={(value) => filter.updateFFT('weight', value)} step={0.001} value={weight} />
		</div>
	)
})

const Footer = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)

	return (
		<>
			<Button color='danger' label='Reset' onPointerUp={filter.reset} startContent={<Icons.Restore />} />
			<Button color='success' label='Apply' onPointerUp={filter.apply} startContent={<Icons.Check />} />
		</>
	)
})
