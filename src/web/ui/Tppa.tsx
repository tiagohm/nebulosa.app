import { Checkbox, Chip, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatDEC, formatRA } from 'nebulosa/src/angle'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { TppaMolecule } from '@/molecules/tppa'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { CameraDropdown } from './CameraDropdown'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { MountDropdown } from './MountDropdown'
import { PlateSolverSelect } from './PlateSolverSelect'
import { PlateSolveStartPopover } from './PlateSolveStartPopover'
import { TextButton } from './TextButton'
import { TppaDirectionSelect } from './TppaDirectionSelect'

export const Tppa = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { running, camera, mount, event } = useSnapshot(tppa.state)
	const { direction, moveDuration, stopTrackingWhenDone, compensateRefraction } = useSnapshot(tppa.state.request, { sync: true })
	const { type } = useSnapshot(tppa.state.request.solver)

	const Footer = (
		<>
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={tppa.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={!camera?.connected || !mount?.connected} isLoading={running} label='Start' onPointerUp={tppa.start} startContent={<Icons.Play />} />
		</>
	)

	return (
		<Modal footer={Footer} header='Three-Point Polar Alignment' maxWidth='400px' name='tppa' onHide={tppa.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-full flex flex-row justify-center items-center gap-2'>
					<CameraDropdown buttonProps={{ endContent: <CameraDropdownEndContent /> }} isDisabled={running} onValueChange={(value) => (tppa.state.camera = value)} value={camera} />
					<MountDropdown isDisabled={running} onValueChange={(value) => (tppa.state.mount = value)} value={mount} />
				</div>
				<div className='mt-2 col-span-full flex flex-row items-center justify-between'>
					<Chip color='primary' size='sm'>
						{event.state === 'IDLE' ? 'idle' : event.state === 'MOVING' ? 'moving' : event.state === 'CAPTURING' ? 'capturing' : event.state === 'SOLVING' ? 'solving' : 'aligning'}
					</Chip>
					<div className='flex flex-row items-center gap-1'>
						<Chip color='warning' size='sm'>
							{event.step}
						</Chip>
						<Chip color={event.solved ? 'success' : 'danger'} size='sm'>
							RA: {formatRA(event.solver.rightAscension)}
						</Chip>
						<Chip color={event.solved ? 'success' : 'danger'} size='sm'>
							DEC: {formatDEC(event.solver.declination)}
						</Chip>
					</div>
				</div>
				<PlateSolverSelect className='col-span-6' endContent={<PlateSolverSelectEndContent />} isDisabled={running} onValueChange={(value) => tppa.updateSolver('type', value)} value={type} />
				<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Move for (s)' maxValue={60} minValue={1} onValueChange={(value) => tppa.update('moveDuration', value)} size='sm' value={moveDuration} />
				<TppaDirectionSelect className='col-span-3' isDisabled={running} onValueChange={(value) => tppa.update('direction', value)} value={direction} />
				<Checkbox className='col-span-6' isDisabled={running} isSelected={stopTrackingWhenDone} onValueChange={(value) => tppa.update('stopTrackingWhenDone', value)}>
					Stop tracking when done
				</Checkbox>
				<Checkbox className='col-span-6' isDisabled={running} isSelected={compensateRefraction} onValueChange={(value) => tppa.update('compensateRefraction', value)}>
					Compensate refraction
				</Checkbox>
				<div className='col-span-6 flex flex-col items-center gap-0 mt-3'>
					<span className='font-bold'>Azimuth</span>
					<span className='text-3xl'>{formatDEC(event.error.azimuth)}</span>
				</div>
				<div className='col-span-6 flex flex-col items-center gap-0 mt-3'>
					<span className='font-bold'>Altitude</span>
					<span className='text-3xl'>{formatDEC(event.error.altitude)}</span>
				</div>
			</div>
		</Modal>
	)
})

const CameraDropdownEndContent = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { camera } = useSnapshot(tppa.state)
	const { exposureTime, exposureTimeUnit, binX, binY, gain, offset, frameFormat } = useSnapshot(tppa.state.request.capture, { sync: true })

	return (
		camera && (
			<CameraCaptureStartPopover
				binX={binX}
				binY={binY}
				color={camera.connected ? 'success' : 'danger'}
				exposureTime={exposureTime}
				exposureTimeUnit={exposureTimeUnit}
				frameFormat={frameFormat}
				frameFormats={camera.frameFormats}
				gain={gain}
				isDisabled={!camera.connected}
				maxBin={camera.bin.maxX}
				maxExposure={camera.exposure.max}
				maxGain={camera.gain.max}
				maxOffset={camera.offset.max}
				minExposure={camera.exposure.min}
				offset={offset}
				onValueChange={tppa.updateCapture}
			/>
		)
	)
})

const PlateSolverSelectEndContent = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { type, radius, focalLength, pixelSize } = useSnapshot(tppa.state.request.solver, { sync: true })

	return <PlateSolveStartPopover focalLength={focalLength} onValueChange={tppa.updateSolver} pixelSize={pixelSize} radius={radius} type={type} />
})
