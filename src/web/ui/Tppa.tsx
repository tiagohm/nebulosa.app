import { Checkbox, Chip, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatDEC, formatRA } from 'nebulosa/src/angle'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { TppaMolecule } from '@/molecules/tppa'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { CameraDropdown, MountDropdown } from './DeviceDropdown'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { PlateSolverSelect } from './PlateSolverSelect'
import { PlateSolveStartPopover } from './PlateSolveStartPopover'
import { TextButton } from './TextButton'
import { TppaDirectionSelect } from './TppaDirectionSelect'

export const Tppa = memo(() => {
	const tppa = useMolecule(TppaMolecule)

	return (
		<Modal footer={<Footer />} header='Three-Point Polar Alignment' id='tppa' maxWidth='400px' onHide={tppa.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Devices />
			<Status />
			<Inputs />
			<Result />
		</div>
	)
})

const Devices = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { running, camera, mount } = useSnapshot(tppa.state)

	return (
		<div className='col-span-full flex flex-row justify-center items-center gap-2'>
			<CameraDropdown endContent={<CameraDropdownEndContent />} isDisabled={running} onValueChange={(value) => (tppa.state.camera = value)} showLabel value={camera} />
			<MountDropdown isDisabled={running} onValueChange={(value) => (tppa.state.mount = value)} showLabel value={mount} />
		</div>
	)
})

const CameraDropdownEndContent = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { camera } = useSnapshot(tppa.state)
	const { capture } = useSnapshot(tppa.state.request)

	return camera && <CameraCaptureStartPopover camera={camera} isRounded mode='tppa' onValueChange={tppa.updateCapture} value={capture} />
})

const Status = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { event } = useSnapshot(tppa.state)
	const { state, solved, solver } = event

	return (
		<div className='mt-2 col-span-full flex flex-row items-center justify-between'>
			<Chip color='primary' size='sm'>
				{state === 'IDLE' ? 'idle' : state === 'MOVING' ? 'moving' : state === 'CAPTURING' ? 'capturing' : state === 'SOLVING' ? 'solving' : state === 'WAITING' ? 'waiting' : state === 'SETTLING' ? 'settling' : 'aligning'}
			</Chip>
			<div className='flex flex-row items-center gap-1'>
				<Chip color='warning' size='sm'>
					{event.step}
				</Chip>
				<Chip color={solved ? 'success' : 'danger'} size='sm'>
					RA: {formatRA(solver.rightAscension)}
				</Chip>
				<Chip color={solved ? 'success' : 'danger'} size='sm'>
					DEC: {formatDEC(solver.declination)}
				</Chip>
			</div>
		</div>
	)
})

const Inputs = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { running } = useSnapshot(tppa.state)
	const { direction, moveDuration, compensateRefraction, maxAttempts, delayBeforeCapture } = useSnapshot(tppa.state.request)
	const { type } = useSnapshot(tppa.state.request.solver)

	return (
		<>
			<PlateSolverSelect className='col-span-6' endContent={<PlateSolverSelectEndContent />} isDisabled={running} onValueChange={(value) => tppa.updateSolver('type', value)} value={type} />
			<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Move for (s)' maxValue={60} minValue={1} onValueChange={(value) => tppa.update('moveDuration', value)} size='sm' value={moveDuration} />
			<TppaDirectionSelect className='col-span-3' isDisabled={running} onValueChange={(value) => tppa.update('direction', value)} value={direction} />
			<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Max attempts' maxValue={30} minValue={3} onValueChange={(value) => tppa.update('maxAttempts', value)} size='sm' value={maxAttempts} />
			<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Delay before capture (s)' maxValue={120} minValue={0} onValueChange={(value) => tppa.update('delayBeforeCapture', value)} size='sm' value={delayBeforeCapture} />
			<Checkbox className='col-span-full' isDisabled={running} isSelected={compensateRefraction} onValueChange={(value) => tppa.update('compensateRefraction', value)}>
				Compensate refraction
			</Checkbox>
		</>
	)
})

const PlateSolverSelectEndContent = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { type, radius, focalLength, pixelSize } = useSnapshot(tppa.state.request.solver)

	return <PlateSolveStartPopover focalLength={focalLength} onValueChange={tppa.updateSolver} pixelSize={pixelSize} radius={radius} type={type} />
})

const Result = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { azimuth, altitude } = useSnapshot(tppa.state.event.error)

	return (
		<>
			<div className='col-span-6 flex flex-col items-center gap-0 mt-3'>
				<span className='font-bold'>Azimuth</span>
				<span className='text-3xl'>{formatDEC(azimuth)}</span>
			</div>
			<div className='col-span-6 flex flex-col items-center gap-0 mt-3'>
				<span className='font-bold'>Altitude</span>
				<span className='text-3xl'>{formatDEC(altitude)}</span>
			</div>
		</>
	)
})

const Footer = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { running, camera, mount } = useSnapshot(tppa.state)

	return (
		<>
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={tppa.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={!camera?.connected || !mount?.connected} isLoading={running} label='Start' onPointerUp={tppa.start} startContent={<Icons.Play />} />
		</>
	)
})
