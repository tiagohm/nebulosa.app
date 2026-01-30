import { Checkbox, Chip, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { AutoFocusMolecule } from '@/molecules/autofocus'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { AutoFocusFittingModeSelect } from './AutoFocusFittingModeSelect'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { CameraDropdown, FocuserDropdown } from './DeviceDropdown'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { StarDetectionPopover } from './StarDetectionPopover'
import { StarDetectionSelect } from './StarDetectionSelect'
import { TextButton } from './TextButton'

export const AutoFocus = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)

	return (
		<Modal footer={<Footer />} header='Auto Focus' id='autofocus' maxWidth='376px' onHide={autoFocus.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<Devices />
				<Status />
				<Inputs />
			</div>
		</Modal>
	)
})

const Devices = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { running, camera, focuser } = useSnapshot(autoFocus.state)

	return (
		<div className='col-span-full flex flex-row justify-center items-center gap-2'>
			<CameraDropdown endContent={<CameraDropdownEndContent />} isDisabled={running} onValueChange={(value) => (autoFocus.state.camera = value)} showLabel value={camera} />
			<FocuserDropdown isDisabled={running} onValueChange={(value) => (autoFocus.state.focuser = value)} showLabel value={focuser} />
		</div>
	)
})

const Status = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { event } = useSnapshot(autoFocus.state)

	return (
		<div className='mt-2 col-span-full flex flex-row items-center justify-between'>
			<Chip color='primary' size='sm'>
				{event.state === 'IDLE' ? 'idle' : event.state === 'MOVING' ? 'moving' : event.state === 'CAPTURING' ? 'capturing' : 'computing'}
			</Chip>
			<span className='text-xs'>{event.message}</span>
		</div>
	)
})

const Inputs = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { focuser } = useSnapshot(autoFocus.state)
	const { starDetection, initialOffsetSteps, stepSize, fittingMode, rmsdThreshold, reversed } = useSnapshot(autoFocus.state.request)

	return (
		<>
			<StarDetectionSelect className='col-span-6' endContent={<StarDetectionSelectEndContent />} onValueChange={(value) => autoFocus.updateStarDetection('type', value)} value={starDetection.type} />
			<AutoFocusFittingModeSelect className='col-span-6' onValueChange={(value) => autoFocus.update('fittingMode', value)} value={fittingMode} />
			<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} label='Offset steps' maxValue={1000} minValue={0} onValueChange={(value) => autoFocus.update('initialOffsetSteps', value)} size='sm' value={initialOffsetSteps} />
			<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!focuser?.connected} label='Step size' maxValue={focuser?.position.max} minValue={focuser?.position.min} onValueChange={(value) => autoFocus.update('stepSize', value)} size='sm' value={stepSize} />
			<NumberInput className='col-span-5' formatOptions={DECIMAL_NUMBER_FORMAT} label='RMSD threshold' maxValue={1} minValue={0} onValueChange={(value) => autoFocus.update('rmsdThreshold', value)} size='sm' step={0.01} value={rmsdThreshold} />
			<Checkbox className='col-span-full' isSelected={reversed} onValueChange={(value) => autoFocus.update('reversed', value)}>
				Reversed
			</Checkbox>
		</>
	)
})

const Footer = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { running, camera, focuser } = useSnapshot(autoFocus.state)

	return (
		<>
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={autoFocus.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={!camera?.connected || !focuser?.connected} isLoading={running} label='Start' onPointerUp={autoFocus.start} startContent={<Icons.Play />} />
		</>
	)
})

const CameraDropdownEndContent = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { camera } = useSnapshot(autoFocus.state)
	const { capture } = useSnapshot(autoFocus.state.request)

	return camera && <CameraCaptureStartPopover camera={camera} isRounded mode='autoFocus' onValueChange={autoFocus.updateCapture} value={capture} />
})

const StarDetectionSelectEndContent = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { starDetection } = useSnapshot(autoFocus.state.request)

	return <StarDetectionPopover isRounded onValueChange={autoFocus.updateStarDetection} size='sm' value={starDetection} variant='light' />
})
