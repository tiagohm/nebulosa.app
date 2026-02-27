import { Chip, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FlatWizardMolecule } from '@/molecules/flatwizard'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { CameraDropdown } from './DeviceDropdown'
import { FilePickerInput } from './FilePickerInput'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const FlatWizard = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)

	return (
		<Modal footer={<Footer />} header='Flat Wizard' id='flatwizard' maxWidth='376px' onHide={flatWizard.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Devices />
			<Status />
			<Input />
		</div>
	)
})

const Devices = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)
	const { running, camera } = useSnapshot(flatWizard.state)

	return (
		<div className='col-span-full flex flex-row justify-center items-center gap-2'>
			<CameraDropdown endContent={<CameraDropdownEndContent />} isDisabled={running} onValueChange={(value) => (flatWizard.state.camera = value)} showLabel value={camera} />
		</div>
	)
})

const Status = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)
	const { state, message } = useSnapshot(flatWizard.state.event)

	return (
		<div className='mt-2 col-span-full flex flex-row items-center justify-between'>
			<Chip color='primary' size='sm'>
				{state === 'IDLE' ? 'idle' : state === 'CAPTURING' ? 'capturing' : 'computing'}
			</Chip>
			<span className='text-xs'>{message}</span>
		</div>
	)
})

const Input = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)
	const { camera } = useSnapshot(flatWizard.state)
	const { minExposure, maxExposure, meanTarget, meanTolerance, path } = useSnapshot(flatWizard.state.request)

	const exposureMinValue = (camera?.exposure.min ?? 0) * 1000
	const exposureMaxValue = (camera?.exposure.max ?? 0) * 1000

	return (
		<>
			<FilePickerInput className='col-span-full' id='flatwizard' mode='directory' onValueChange={flatWizard.updatePath} value={path} />
			<NumberInput className='col-span-6' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!camera?.connected} label='Min exposure (ms)' maxValue={exposureMaxValue} minValue={exposureMinValue} onValueChange={(value) => flatWizard.update('minExposure', value)} size='sm' value={minExposure} />
			<NumberInput className='col-span-6' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!camera?.connected} label='Max exposure (ms)' maxValue={exposureMaxValue} minValue={exposureMinValue} onValueChange={(value) => flatWizard.update('maxExposure', value)} size='sm' value={maxExposure} />
			<NumberInput className='col-span-6' formatOptions={INTEGER_NUMBER_FORMAT} label='Mean target' maxValue={65565} minValue={0} onValueChange={(value) => flatWizard.update('meanTarget', value)} size='sm' value={meanTarget} />
			<NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} label='Mean tolerance (%)' maxValue={100} minValue={0} onValueChange={(value) => flatWizard.update('meanTolerance', value)} size='sm' step={0.1} value={meanTolerance} />
		</>
	)
})

const Footer = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)
	const { running, camera } = useSnapshot(flatWizard.state)
	const { path: saveAt } = useSnapshot(flatWizard.state.request)

	return (
		<>
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={flatWizard.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={!camera?.connected || !saveAt} isLoading={running} label='Start' onPointerUp={flatWizard.start} startContent={<Icons.Play />} />
		</>
	)
})

const CameraDropdownEndContent = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)
	const { camera } = useSnapshot(flatWizard.state)
	const { capture } = useSnapshot(flatWizard.state.request)

	return camera && <CameraCaptureStartPopover camera={camera} isRounded mode='flatWizard' onValueChange={flatWizard.updateCapture} value={capture} />
})
