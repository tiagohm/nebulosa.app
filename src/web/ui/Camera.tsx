import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, Switch, Tooltip } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { CameraMolecule } from '@/molecules/indi/camera'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { useModal } from '@/shared/hooks'
import { ConnectButton } from './ConnectButton'
import { ExposureModeButtonGroup } from './ExposureModeButtonGroup'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameTypeSelect } from './FrameTypeSelect'

// TODO: memo
export function Camera() {
	const equipment = useMolecule(EquipmentMolecule)
	const camera = useMolecule(CameraMolecule)
	// biome-ignore format: don't break lines!
	const { camera: { connected, coolerPower, temperature, canSetTemperature, exposure }, connecting, capturing, targetTemperature, exposureTime, exposureTimeUnit, frameType, exposureMode, delay, count, x, y, width, height, subframe, binX, binY, frameFormat, gain, offset } = useSnapshot(camera.state)
	const modal = useModal(() => equipment.closeModal('CAMERA', camera.scope.camera))

	return (
		<Modal {...modal.props} classNames={{ base: 'min-w-[380px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-row gap-0 items-center'>
							<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={camera.connectOrDisconnect} />
							<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
								<span className='leading-5'>Camera</span>
								<span className='text-xs font-normal text-gray-400'>{camera.scope.camera.name}</span>
							</div>
							<div className='flex flex-row items-center gap-2 me-6'></div>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'>
								<Switch className='col-span-3 flex-col-reverse gap-0.2 max-w-none' classNames={{ label: 'text-xs ms-0' }} size='sm'>
									Cooler ({(coolerPower * 100).toFixed(1)}%)
								</Switch>
								<Switch className='col-span-3 flex-col-reverse gap-0.2 max-w-none' classNames={{ label: 'text-xs ms-0' }} size='sm'>
									Dew Heater
								</Switch>
								<div className='col-span-6 flex flex-row items-center gap-1'>
									<NumberInput isDisabled={!canSetTemperature} label={`Temperature (${temperature.toFixed(1)}°C)`} maxValue={50} minValue={-50} size='sm' step={0.1} value={targetTemperature} />
									<Tooltip content='Apply' placement='bottom'>
										<Button color='success' isDisabled={!canSetTemperature} isIconOnly size='sm' variant='light'>
											<Lucide.Check size={16} />
										</Button>
									</Tooltip>
								</div>
								<ExposureTimeInput
									className='col-span-6'
									maximumInMicrosseconds={exposure.max}
									minimumInMicrosseconds={exposure.min}
									onUnitChange={(value) => camera.update('exposureTimeUnit', value)}
									onValueChange={(value) => camera.update('exposureTime', value)}
									unit={exposureTimeUnit}
									value={exposureTime}
								/>
								<FrameTypeSelect className='col-span-6' onValueChange={(value) => camera.update('frameType', value)} value={frameType} />
								<ExposureModeButtonGroup className='col-span-6' color='secondary' onValueChange={(value) => camera.update('exposureMode', value)} value={exposureMode} />
								<NumberInput className='col-span-3' isDisabled={exposureMode === 'SINGLE'} label='Delay (ms)' onValueChange={(value) => camera.update('delay', value)} size='sm' value={delay} />
								<NumberInput className='col-span-3' isDisabled={exposureMode !== 'FIXED'} label='Count' minValue={1} onValueChange={(value) => camera.update('count', value)} size='sm' value={count} />
								<NumberInput className='col-span-3' isDisabled={!subframe} label='X' onValueChange={(value) => camera.update('x', value)} size='sm' value={x} />
								<NumberInput className='col-span-3' isDisabled={!subframe} label='Y' onValueChange={(value) => camera.update('y', value)} size='sm' value={y} />
								<NumberInput className='col-span-3' isDisabled={!subframe} label='Width' onValueChange={(value) => camera.update('width', value)} size='sm' value={width} />
								<NumberInput className='col-span-3' isDisabled={!subframe} label='Height' onValueChange={(value) => camera.update('height', value)} size='sm' value={height} />
								<Switch className='col-span-3 flex-col-reverse gap-0.2 max-w-none' classNames={{ label: 'text-xs ms-0' }} isSelected={subframe} onValueChange={(value) => camera.update('subframe', value)} size='sm'>
									Subframe
								</Switch>
								<div className='col-span-3 flex items-center justify-center'>
									<Tooltip content='Fullscreen' placement='bottom'>
										<Button color='secondary' isIconOnly variant='light'>
											<Lucide.Fullscreen size={16} />
										</Button>
									</Tooltip>
								</div>
								<NumberInput className='col-span-3' label='Bin X' minValue={1} onValueChange={(value) => camera.update('binX', value)} size='sm' value={binX} />
								<NumberInput className='col-span-3' label='Bin Y' minValue={1} onValueChange={(value) => camera.update('binY', value)} size='sm' value={binY} />
								<NumberInput className='col-span-3' label='Gain' minValue={0} onValueChange={(value) => camera.update('gain', value)} size='sm' value={gain} />
								<NumberInput className='col-span-3' label='Offset' minValue={0} onValueChange={(value) => camera.update('offset', value)} size='sm' value={offset} />
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='danger' isDisabled={!capturing} onPointerUp={camera.stop} startContent={<Tabler.IconPlayerStopFilled size={16} />} variant='flat'>
								Stop
							</Button>
							<Button color='success' isLoading={capturing} onPointerUp={camera.start} startContent={<Tabler.IconPlayerPlayFilled size={16} />} variant='flat'>
								Start
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
