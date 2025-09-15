import { Chip, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { DarvMolecule } from '@/molecules/darv'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { CameraDropdown } from './CameraDropdown'
import { HemisphereSelect } from './HemisphereSelect'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { MountDropdown } from './MountDropdown'
import { TextButton } from './TextButton'

export const Darv = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { running, camera, mount, event } = useSnapshot(darv.state)
	const { hemisphere, duration, initialPause } = useSnapshot(darv.state.request, { sync: true })

	const Footer = (
		<>
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={darv.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={!camera?.connected || !mount?.connected} isLoading={running} label='Start' onPointerUp={darv.start} startContent={<Icons.Play />} />
		</>
	)

	return (
		<Modal footer={Footer} header='Drift Alignment by Robert Vice' maxWidth='350px' name='darv' onHide={darv.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-full flex flex-row justify-center items-center gap-2'>
					<CameraDropdown buttonProps={{ endContent: <CameraDropdownEndContent /> }} isDisabled={running} onValueChange={(value) => (darv.state.camera = value)} value={camera} />
					<MountDropdown isDisabled={running} onValueChange={(value) => (darv.state.mount = value)} value={mount} />
				</div>
				<div className='mt-2 col-span-full flex flex-row items-center justify-between'>
					<Chip color='primary' size='sm'>
						{event.state === 'IDLE' ? 'idle' : event.state === 'WAITING' ? 'waiting' : event.state === 'FORWARDING' ? 'forwading' : 'backwarding'}
					</Chip>
				</div>
				<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Initial pause (s)' maxValue={60} minValue={1} onValueChange={(value) => darv.update('initialPause', value)} size='sm' value={initialPause} />
				<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Drift for (s)' maxValue={1200} minValue={1} onValueChange={(value) => darv.update('duration', value)} size='sm' value={duration} />
				<HemisphereSelect className='col-span-4' isDisabled={running} onValueChange={(value) => darv.update('hemisphere', value)} value={hemisphere} />
			</div>
		</Modal>
	)
})

const CameraDropdownEndContent = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { camera } = useSnapshot(darv.state)
	const { exposureTime, exposureTimeUnit, binX, binY, gain, offset, frameFormat } = useSnapshot(darv.state.request.capture, { sync: true })

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
				onValueChange={darv.updateCapture}
			/>
		)
	)
})
