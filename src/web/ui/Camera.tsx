import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, SelectItem, Switch, Tooltip } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { CameraMolecule } from '@/molecules/indi/camera'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { useModal } from '@/shared/hooks'
import { ConnectButton } from './ConnectButton'
import { EnumSelect } from './EnumSelect'
import { ExposureModeButtonGroup } from './ExposureModeButtonGroup'
import { ExposureTimeInput } from './ExposureTimeInput'
import { ExposureTimeProgress } from './ExposureTimeProgress'
import { FrameTypeSelect } from './FrameTypeSelect'

// TODO: memo
export function Camera() {
	const equipment = useMolecule(EquipmentMolecule)
	const camera = useMolecule(CameraMolecule)
	// biome-ignore format: don't break lines!
	const { camera: { connected, coolerPower, temperature, canSetTemperature, exposure, canAbort, frame, canSubFrame, canBin, bin, gain, offset, frameFormats }, connecting, capturing, targetTemperature, request, progress } = useSnapshot(camera.state)
	const modal = useModal(() => equipment.closeModal('CAMERA', camera.scope.camera))

	return (
		<Modal {...modal.props} classNames={{ base: 'min-w-[380px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-row gap-0 items-center'>
							<ConnectButton isConnected={connected} isDisabled={capturing} isLoading={connecting} onPointerUp={camera.connectOrDisconnect} />
							<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
								<span className='leading-5'>Camera</span>
								<span className='text-xs font-normal text-gray-400'>{camera.scope.camera.name}</span>
							</div>
							<div className='flex flex-row items-center gap-2 me-6'></div>
						</ModalHeader>
						<ModalBody>
							<div className='mt-0 grid grid-cols-12 gap-2'>
								<ExposureTimeProgress className='col-span-full mb-2' progress={progress} />
								<Switch className='col-span-3 flex-col-reverse gap-0.2 max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || capturing} size='sm'>
									Cooler ({(coolerPower * 100).toFixed(1)}%)
								</Switch>
								<Switch className='col-span-3 flex-col-reverse gap-0.2 max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || capturing} size='sm'>
									Dew Heater
								</Switch>
								<div className='col-span-6 flex flex-row items-center gap-1'>
									<NumberInput
										endContent={
											<Tooltip content='Apply' placement='bottom'>
												<Button color='success' isIconOnly size='sm' variant='light'>
													<Lucide.Check size={16} />
												</Button>
											</Tooltip>
										}
										isDisabled={!connected || !canSetTemperature || capturing}
										label={`Temperature (${temperature.toFixed(1)}°C)`}
										maxValue={50}
										minValue={-50}
										size='sm'
										step={0.1}
										value={targetTemperature}
									/>
								</div>
								<ExposureTimeInput
									className='col-span-6'
									isDisabled={!connected || request.frameType === 'BIAS' || capturing}
									maxValue={exposure.max}
									maxValueUnit='SECOND'
									minValue={exposure.min}
									minValueUnit='SECOND'
									onUnitChange={(value) => camera.update('exposureTimeUnit', value)}
									onValueChange={(value) => camera.update('exposureTime', value)}
									unit={request.exposureTimeUnit}
									value={request.exposureTime}
								/>
								<FrameTypeSelect className='col-span-6' isDisabled={!connected || capturing} onValueChange={(value) => camera.update('frameType', value)} value={request.frameType} />
								<ExposureModeButtonGroup className='col-span-6' color='secondary' isDisabled={!connected || capturing} onValueChange={(value) => camera.update('exposureMode', value)} value={request.exposureMode} />
								<NumberInput className='col-span-3' isDisabled={!connected || request.exposureMode === 'SINGLE' || capturing} label='Delay (s)' onValueChange={(value) => camera.update('delay', value)} size='sm' value={request.delay} />
								<NumberInput className='col-span-3' isDisabled={!connected || request.exposureMode !== 'FIXED' || capturing} label='Count' minValue={1} onValueChange={(value) => camera.update('count', value)} size='sm' value={request.count} />
								<NumberInput className='col-span-3' isDisabled={!connected || !request.subframe || capturing} label='X' maxValue={frame.maxX} minValue={frame.minX} onValueChange={(value) => camera.update('x', value)} size='sm' value={request.x} />
								<NumberInput className='col-span-3' isDisabled={!connected || !request.subframe || capturing} label='Y' maxValue={frame.maxY} minValue={frame.minY} onValueChange={(value) => camera.update('y', value)} size='sm' value={request.y} />
								<NumberInput className='col-span-3' isDisabled={!connected || !request.subframe || capturing} label='Width' maxValue={frame.maxWidth} minValue={0} onValueChange={(value) => camera.update('width', value)} size='sm' value={request.width} />
								<NumberInput className='col-span-3' isDisabled={!connected || !request.subframe || capturing} label='Height' maxValue={frame.maxWidth} minValue={0} onValueChange={(value) => camera.update('height', value)} size='sm' value={request.height} />
								<Switch className='col-span-3 flex-col-reverse gap-0.2 max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || !canSubFrame || capturing} isSelected={request.subframe} onValueChange={(value) => camera.update('subframe', value)} size='sm'>
									Subframe
								</Switch>
								<div className='col-span-3 flex items-center justify-center'>
									<Tooltip content='Fullscreen' placement='bottom'>
										<Button color='secondary' isDisabled={!connected || capturing} isIconOnly onPointerUp={camera.fullscreen} variant='light'>
											<Lucide.Fullscreen size={16} />
										</Button>
									</Tooltip>
								</div>
								<NumberInput className='col-span-3' isDisabled={!connected || !canBin || capturing} label='Bin X' maxValue={bin.maxX} minValue={1} onValueChange={(value) => camera.update('binX', value)} size='sm' value={request.binX} />
								<NumberInput className='col-span-3' isDisabled={!connected || !canBin || capturing} label='Bin Y' maxValue={bin.maxY} minValue={1} onValueChange={(value) => camera.update('binY', value)} size='sm' value={request.binY} />
								<NumberInput className='col-span-3' isDisabled={!connected || capturing} label='Gain' maxValue={gain.max} minValue={gain.min} onValueChange={(value) => camera.update('gain', value)} size='sm' value={request.gain} />
								<NumberInput className='col-span-3' isDisabled={!connected || capturing} label='Offset' maxValue={offset.max} minValue={offset.min} onValueChange={(value) => camera.update('offset', value)} size='sm' value={request.offset} />
								<EnumSelect className='col-span-6' isDisabled={!connected || !frameFormats.length || capturing} label='Format' onValueChange={(value) => camera.update('frameFormat', value)} value={request.frameFormat}>
									{frameFormats.map((format) => (
										<SelectItem key={format}>{format}</SelectItem>
									))}
								</EnumSelect>
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='danger' isDisabled={!connected || !canAbort || !capturing} onPointerUp={camera.stop} startContent={<Tabler.IconPlayerStopFilled size={16} />} variant='flat'>
								Stop
							</Button>
							<Button color='success' isDisabled={!connected} isLoading={capturing} onPointerUp={camera.start} startContent={<Tabler.IconPlayerPlayFilled size={16} />} variant='flat'>
								Start
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
