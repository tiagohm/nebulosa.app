import { Checkbox, NumberInput, Tab, Tabs } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageFilterMolecule } from '@/molecules/image/filter'
import { DECIMAL_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { ImageFilterTypeRadioGroup } from './ImageFilterTypeRadioGroup'
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
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled } = useSnapshot(filter.state.filter)

	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Checkbox className='col-span-full' isSelected={enabled} onValueChange={(value) => (filter.state.filter.enabled = value)}>
				Enabled
			</Checkbox>
			<Tabs classNames={{ base: 'col-span-full', panel: 'col-span-full' }}>
				<Tab title='Kernel'>
					<Kernel />
				</Tab>
			</Tabs>
		</div>
	)
})

const Kernel = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type } = useSnapshot(filter.state.filter)

	return (
		<div className='grid grid-cols-12 gap-2'>
			<ImageFilterTypeRadioGroup className='col-span-full' isDisabled={!enabled} onValueChange={filter.updateType} value={type} />
			<Mean />
			<Blur />
			<GaussianBlur />
		</div>
	)
})

const Mean = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type, mean } = useSnapshot(filter.state.filter)

	return (
		<Activity mode={type === 'mean' ? 'visible' : 'hidden'}>
			<div className='col-span-full flex flex-col gap-2'>
				<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Size' maxValue={15} minValue={3} onValueChange={(value) => filter.update('mean', 'size', value)} size='sm' step={2} value={mean.size} />
			</div>
		</Activity>
	)
})

const Blur = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type, blur } = useSnapshot(filter.state.filter)

	return (
		<Activity mode={type === 'blur' ? 'visible' : 'hidden'}>
			<div className='col-span-full flex flex-col gap-2'>
				<NumberInput className='col-span-full' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Size' maxValue={15} minValue={3} onValueChange={(value) => filter.update('blur', 'size', value)} size='sm' step={2} value={blur.size} />
			</div>
		</Activity>
	)
})

const GaussianBlur = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled, type, gaussianBlur } = useSnapshot(filter.state.filter)

	return (
		<Activity mode={type === 'gaussianBlur' ? 'visible' : 'hidden'}>
			<div className='col-span-full flex flex-col gap-2'>
				<NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Size' maxValue={15} minValue={3} onValueChange={(value) => filter.update('gaussianBlur', 'size', value)} size='sm' step={2} value={gaussianBlur.size} />
				<NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!enabled} label='Sigma' maxValue={3} minValue={1} onValueChange={(value) => filter.update('gaussianBlur', 'sigma', value)} size='sm' step={0.01} value={gaussianBlur.sigma} />
			</div>
		</Activity>
	)
})

const Footer = memo(() => {
	const filter = useMolecule(ImageFilterMolecule)
	const { enabled } = useSnapshot(filter.state.filter)

	return (
		<>
			<TextButton color='danger' isDisabled={!enabled} label='Reset' onPointerUp={filter.reset} startContent={<Icons.Restore />} />
			<TextButton color='success' label='Apply' onPointerUp={filter.apply} startContent={<Icons.Check />} />
		</>
	)
})
