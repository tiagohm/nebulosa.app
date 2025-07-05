import { Button, Checkbox, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, SelectItem, Switch, Tooltip } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo, useCallback } from 'react'
import { useSnapshot } from 'valtio'
import { CameraMolecule } from '@/molecules/indi/camera'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { useModal } from '@/shared/hooks'
import { AutoSaveButton } from './AutoSaveButton'
import { AutoSubFolderModeButton } from './AutoSubFolderButton'
import { ConnectButton } from './ConnectButton'
import { EnumSelect } from './EnumSelect'
import { ExposureModeButtonGroup } from './ExposureModeButtonGroup'
import { ExposureTimeInput } from './ExposureTimeInput'
import { ExposureTimeProgress } from './ExposureTimeProgress'
import { FilePickerInput } from './FilePickerInput'
import { FrameTypeSelect } from './FrameTypeSelect'

export const Camera = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const camera = useMolecule(CameraMolecule)
	// biome-ignore format: don't break lines!
	const { camera: { connected, hasCooler, cooler, coolerPower, temperature, canSetTemperature, exposure, canAbort, frame, canSubFrame, canBin, bin, gain, offset, frameFormats }, connecting, capturing, targetTemperature, request, progress } = useSnapshot(camera.state)
	const modal = useModal(() => equipment.closeModal('camera', camera.scope.camera))

	const updateSavePath = useCallback((value?: string) => {
		camera.update('savePath', value)
	}, [])

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
								<div className='col-span-full flex flex-row items-center gap-1'>
									<AutoSaveButton onValueChange={(value) => camera.update('autoSave', value)} value={request.autoSave} />
									<AutoSubFolderModeButton isDisabled={!request.autoSave} onValueChange={(value) => camera.update('autoSubFolderMode', value)} value={request.autoSubFolderMode} />
									<FilePickerInput isDisabled={!request.autoSave} mode='directory' name={`camera-${camera.scope.camera.name}`} onValueChange={updateSavePath} value={request.savePath} />
								</div>
								<Switch className='col-span-3 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || capturing || !hasCooler} isSelected={cooler} onValueChange={(value) => camera.cooler(value)} size='sm'>
									Cooler ({(coolerPower * 100).toFixed(1)}%)
								</Switch>
								<Switch className='col-span-3 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={true || !connected || capturing} size='sm'>
									Dew Heater
								</Switch>
								<div className='col-span-6 flex flex-row items-center gap-1'>
									<NumberInput
										endContent={
											<Tooltip content='Apply' placement='bottom'>
												<Button color='success' isIconOnly onPointerUp={() => camera.temperature(targetTemperature)} size='sm' variant='light'>
													<Lucide.Check size={18} />
												</Button>
											</Tooltip>
										}
										isDisabled={!connected || !canSetTemperature || capturing}
										label={`Temperature (${temperature.toFixed(1)}°C)`}
										maxValue={50}
										minValue={-50}
										onValueChange={(value) => (camera.state.targetTemperature = value)}
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
								<div className='col-span-6 flex flex-row items-center justify-center gap-2'>
									<Checkbox className='flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || !canSubFrame || capturing} isSelected={request.subframe} onValueChange={(value) => camera.update('subframe', value)} size='sm'>
										Subframe
									</Checkbox>
									<Tooltip content='Fullscreen' placement='bottom'>
										<Button color='secondary' isDisabled={!connected || !request.subframe || capturing} isIconOnly onPointerUp={camera.fullscreen} variant='light'>
											<Lucide.Fullscreen size={18} />
										</Button>
									</Tooltip>
								</div>
								<NumberInput className='col-span-3' isDisabled={!connected || request.exposureMode === 'SINGLE' || capturing} label='Delay (s)' minValue={0} onValueChange={(value) => camera.update('delay', value)} size='sm' value={request.delay} />
								<NumberInput className='col-span-3' isDisabled={!connected || request.exposureMode !== 'FIXED' || capturing} label='Count' minValue={1} onValueChange={(value) => camera.update('count', value)} size='sm' value={request.count} />
								<NumberInput className='col-span-3' isDisabled={!connected || !request.subframe || capturing} label='X' maxValue={frame.maxX} minValue={frame.minX} onValueChange={(value) => camera.update('x', value)} size='sm' value={request.x} />
								<NumberInput className='col-span-3' isDisabled={!connected || !request.subframe || capturing} label='Y' maxValue={frame.maxY} minValue={frame.minY} onValueChange={(value) => camera.update('y', value)} size='sm' value={request.y} />
								<NumberInput className='col-span-3' isDisabled={!connected || !canBin || capturing} label='Bin X' maxValue={bin.maxX} minValue={1} onValueChange={(value) => camera.update('binX', value)} size='sm' value={request.binX} />
								<NumberInput className='col-span-3' isDisabled={!connected || !canBin || capturing} label='Bin Y' maxValue={bin.maxY} minValue={1} onValueChange={(value) => camera.update('binY', value)} size='sm' value={request.binY} />
								<NumberInput className='col-span-3' isDisabled={!connected || !request.subframe || capturing} label='Width' maxValue={frame.maxWidth} minValue={0} onValueChange={(value) => camera.update('width', value)} size='sm' value={request.width} />
								<NumberInput className='col-span-3' isDisabled={!connected || !request.subframe || capturing} label='Height' maxValue={frame.maxWidth} minValue={0} onValueChange={(value) => camera.update('height', value)} size='sm' value={request.height} />
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
							<Button color='danger' isDisabled={!connected || !canAbort || !capturing} onPointerUp={camera.stop} startContent={<Tabler.IconPlayerStopFilled size={18} />} variant='flat'>
								Stop
							</Button>
							<Button color='success' isDisabled={!connected} isLoading={capturing} onPointerUp={camera.start} startContent={<Tabler.IconPlayerPlayFilled size={18} />} variant='flat'>
								Start
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
