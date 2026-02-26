import { Chip, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { DarvMolecule } from '@/molecules/darv'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { CameraDropdown, MountDropdown } from './DeviceDropdown'
import { HemisphereSelect } from './HemisphereSelect'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const Darv = memo(() => {
	const darv = useMolecule(DarvMolecule)

	return (
		<Modal footer={<Footer />} header='Drift Alignment by Robert Vice' id='darv' maxWidth='360px' onHide={darv.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<DeviceChooser />
			<Status />
			<Input />
		</div>
	)
})

const DeviceChooser = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { running, camera, mount } = useSnapshot(darv.state)

	return (
		<div className='col-span-full flex flex-row justify-center items-center gap-2'>
			<CameraDropdown endContent={<CameraDropdownEndContent />} isDisabled={running} onValueChange={(value) => (darv.state.camera = value)} showLabel value={camera} />
			<MountDropdown isDisabled={running} onValueChange={(value) => (darv.state.mount = value)} showLabel value={mount} />
		</div>
	)
})

const Status = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { state } = useSnapshot(darv.state.event)

	return (
		<div className='mt-2 col-span-full flex flex-row items-center justify-between'>
			<Chip color='primary' size='sm'>
				{state === 'IDLE' ? 'idle' : state === 'WAITING' ? 'waiting' : state === 'FORWARDING' ? 'forwading' : 'backwarding'}
			</Chip>
		</div>
	)
})

const Input = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { running } = useSnapshot(darv.state)
	const { hemisphere, duration, initialPause } = useSnapshot(darv.state.request)

	return (
		<>
			<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Initial pause (s)' maxValue={60} minValue={1} onValueChange={(value) => darv.update('initialPause', value)} size='sm' value={initialPause} />
			<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Drift for (s)' maxValue={1200} minValue={1} onValueChange={(value) => darv.update('duration', value)} size='sm' value={duration} />
			<HemisphereSelect className='col-span-4' isDisabled={running} onValueChange={(value) => darv.update('hemisphere', value)} value={hemisphere} />
		</>
	)
})

const CameraDropdownEndContent = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { camera } = useSnapshot(darv.state)
	const { capture } = useSnapshot(darv.state.request)

	return camera && <CameraCaptureStartPopover camera={camera} isRounded mode='darv' onValueChange={darv.updateCapture} value={capture} />
})

const Footer = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { running, camera, mount } = useSnapshot(darv.state)

	return (
		<>
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={darv.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={!camera?.connected || !mount?.connected} isLoading={running} label='Start' onPointerUp={darv.start} startContent={<Icons.Play />} />
		</>
	)
})
