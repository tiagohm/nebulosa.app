import { Checkbox, NumberInput, Switch, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo, useCallback } from 'react'
import { useSnapshot } from 'valtio'
import { CameraMolecule } from '@/molecules/indi/camera'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { AutoSaveButton } from './AutoSaveButton'
import { AutoSubFolderModeButton } from './AutoSubFolderButton'
import { ConnectButton } from './ConnectButton'
import { FocuserDropdown, MountDropdown, RotatorDropdown, WheelDropdown } from './DeviceDropdown'
import { ExposureModeButtonGroup } from './ExposureModeButtonGroup'
import { ExposureTimeInput } from './ExposureTimeInput'
import { ExposureTimeProgress } from './ExposureTimeProgress'
import { FilePickerInput } from './FilePickerInput'
import { FrameFormatSelect } from './FrameFormatSelect'
import { FrameTypeSelect } from './FrameTypeSelect'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const Camera = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing, progress, minimized } = useSnapshot(camera.state)
	const { connecting, connected, hasCooler, cooler, coolerPower, temperature, canSetTemperature, exposure, canAbort, frame, canSubFrame, canBin, bin, gain, offset, frameFormats } = useSnapshot(camera.state.camera)
	const { targetTemperature, request } = useSnapshot(camera.state, { sync: true })

	const updateSavePath = useCallback((value?: string) => {
		camera.update('savePath', value)
	}, [])

	const Footer = (
		<>
			<CameraEquipment isDisabled={!connected || capturing} />
			<TextButton color='danger' isDisabled={!connected || !canAbort || !capturing} label='Stop' onPointerUp={camera.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={!connected} isLoading={capturing} label='Start' onPointerUp={camera.start} startContent={<Icons.Play />} />
		</>
	)

	const Header = (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isDisabled={capturing} isLoading={connecting} onPointerUp={camera.connect} />
				<IndiPanelControlButton device={camera.scope.camera.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Camera</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{camera.scope.camera.name}</span>
			</div>
			<IconButton color='primary' icon={minimized ? Icons.ChevronDown : Icons.ChevronUp} onPointerUp={camera.minimize} variant='flat' />
		</div>
	)

	return (
		<Modal footer={Footer} header={Header} id={`camera-${camera.scope.camera.name}`} maxWidth='380px' onHide={camera.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-full flex flex-row items-center justify-between mb-2'>
					<ExposureTimeProgress progress={progress} />
				</div>
				<Activity mode={minimized ? 'hidden' : 'visible'}>
					<div className='col-span-full flex flex-row items-center gap-1'>
						<AutoSaveButton onValueChange={(value) => camera.update('autoSave', value)} value={request.autoSave} />
						<AutoSubFolderModeButton isDisabled={!request.autoSave} onValueChange={(value) => camera.update('autoSubFolderMode', value)} value={request.autoSubFolderMode} />
						<FilePickerInput id={`camera-${camera.scope.camera.name}`} isDisabled={!request.autoSave} mode='directory' onValueChange={updateSavePath} value={request.savePath} />
					</div>
					<Switch className='col-span-3 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || capturing || !hasCooler} isSelected={cooler} onValueChange={camera.cooler} size='sm'>
						Cooler ({(coolerPower * 100).toFixed(1)}%)
					</Switch>
					<Switch className='col-span-3 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={true || !connected || capturing} size='sm'>
						Dew Heater
					</Switch>
					<div className='col-span-6 flex flex-row items-center gap-1'>
						<NumberInput
							endContent={
								<Tooltip content='Apply' placement='bottom' showArrow>
									<IconButton color='success' icon={Icons.Check} onPointerUp={() => camera.temperature(targetTemperature)} />
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
						<Tooltip content='Fullscreen' placement='bottom' showArrow>
							<IconButton color='secondary' icon={Icons.Fullscreen} isDisabled={!connected || !request.subframe || capturing} onPointerUp={camera.fullscreen} variant='flat' />
						</Tooltip>
					</div>
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || request.exposureMode === 'SINGLE' || capturing} label='Delay (s)' minValue={0} onValueChange={(value) => camera.update('delay', value)} size='sm' value={request.delay} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || request.exposureMode !== 'FIXED' || capturing} label='Count' minValue={1} onValueChange={(value) => camera.update('count', value)} size='sm' value={request.count} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || !request.subframe || capturing} label='X' maxValue={frame.x.max} minValue={frame.x.min} onValueChange={(value) => camera.update('x', value)} size='sm' value={request.x} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || !request.subframe || capturing} label='Y' maxValue={frame.y.max} minValue={frame.y.min} onValueChange={(value) => camera.update('y', value)} size='sm' value={request.y} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || !canBin || capturing} label='Bin X' maxValue={bin.x.max} minValue={1} onValueChange={(value) => camera.update('binX', value)} size='sm' value={request.binX} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || !canBin || capturing} label='Bin Y' maxValue={bin.y.max} minValue={1} onValueChange={(value) => camera.update('binY', value)} size='sm' value={request.binY} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || !request.subframe || capturing} label='Width' maxValue={frame.width.max} minValue={frame.width.min} onValueChange={(value) => camera.update('width', value)} size='sm' value={request.width} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || !request.subframe || capturing} label='Height' maxValue={frame.height.max} minValue={frame.height.min} onValueChange={(value) => camera.update('height', value)} size='sm' value={request.height} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || capturing} label='Gain' maxValue={gain.max} minValue={gain.min} onValueChange={(value) => camera.update('gain', value)} size='sm' value={request.gain} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || capturing} label='Offset' maxValue={offset.max} minValue={offset.min} onValueChange={(value) => camera.update('offset', value)} size='sm' value={request.offset} />
					<FrameFormatSelect className='col-span-6' isDisabled={!connected || !frameFormats.length || capturing} items={frameFormats} onValueChange={(value) => camera.update('frameFormat', value)} value={request.frameFormat} />
				</Activity>
			</div>
		</Modal>
	)
})

interface CameraEquipmentProps {
	readonly isDisabled?: boolean
}

const CameraEquipment = memo(({ isDisabled }: CameraEquipmentProps) => {
	const camera = useMolecule(CameraMolecule)
	const { mount, wheel, focuser, rotator } = useSnapshot(camera.state.equipment)

	return (
		<div className='flex flex-1 flex-row items-center gap-1'>
			<MountDropdown isDisabled={isDisabled} onValueChange={camera.updateMount} tooltipContent={`MOUNT: ${mount?.name ?? 'None'}`} value={mount} />
			<WheelDropdown isDisabled={isDisabled} onValueChange={camera.updateWheel} tooltipContent={`WHEEL: ${wheel?.name ?? 'None'}`} value={wheel} />
			<FocuserDropdown isDisabled={isDisabled} onValueChange={camera.updateFocuser} tooltipContent={`FOCUSER: ${focuser?.name ?? 'None'}`} value={focuser} />
			<RotatorDropdown isDisabled={isDisabled} onValueChange={camera.updateRotator} tooltipContent={`ROTATOR: ${rotator?.name ?? 'None'}`} value={rotator} />
		</div>
	)
})
