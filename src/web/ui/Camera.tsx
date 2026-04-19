import { Switch } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { CameraMolecule } from '@/molecules/indi/camera'
import { AutoSaveButton } from './AutoSaveButton'
import { AutoSubFolderModeButton } from './AutoSubFolderButton'
import { CameraTransferFormatSelect } from './CameraTransferFormatSelect'
import { ConnectButton } from './ConnectButton'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
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

export const Camera = memo(() => {
	const camera = useMolecule(CameraMolecule)

	return (
		<Modal footer={<Footer />} header={<Header />} id={`camera-${camera.scope.camera.name}`} maxWidth='360px' onHide={camera.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { minimized } = useSnapshot(camera.state)

	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Progress />
			<Activity mode={minimized ? 'hidden' : 'visible'}>
				<Path />
				<Cooler />
				<Temperature />
				<Exposure />
				<ExposureMode />
				<Bin />
				<Frame />
				<GainAndFormat />
			</Activity>
		</div>
	)
})

const Header = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing, minimized } = useSnapshot(camera.state)
	const { connected, connecting } = useSnapshot(camera.state.camera)

	return (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton disabled={capturing} isConnected={connected} loading={connecting} onPointerUp={camera.connect} />
				<IndiPanelControlButton device={camera.scope.camera.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Camera</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{camera.scope.camera.name}</span>
			</div>
			<IconButton color='primary' icon={minimized ? Icons.ChevronDown : Icons.ChevronUp} onPointerUp={camera.minimize} variant='ghost' />
		</div>
	)
})

const Progress = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { progress } = useSnapshot(camera.state)

	return (
		<div className='col-span-full flex flex-row items-center justify-between mb-2'>
			<ExposureTimeProgress progress={progress} />
			<OptionsButton />
		</div>
	)
})

const Path = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { autoSave, autoSubFolderMode, savePath } = useSnapshot(camera.state.request)

	return (
		<div className='col-span-full flex flex-row items-center gap-1'>
			<AutoSaveButton onValueChange={(value) => camera.update('autoSave', value)} value={autoSave} />
			<AutoSubFolderModeButton disabled={!autoSave} onValueChange={(value) => camera.update('autoSubFolderMode', value)} value={autoSubFolderMode} />
			<FilePickerInput id={`camera-${camera.scope.camera.name}`} isDisabled={!autoSave} mode='directory' onValueChange={camera.updateSavePath} value={savePath} />
		</div>
	)
})

const OptionsButton = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing } = useSnapshot(camera.state)
	const { connected } = useSnapshot(camera.state.camera)
	const { show } = useSnapshot(camera.state.request)

	return (
		<>
			<IconButton disabled={!connected || capturing} icon={Icons.Cog} onPointerUp={() => (camera.state.request.show = true)} />
			<Activity mode={show && connected && !capturing ? 'visible' : 'hidden'}>
				<OptionsModal />
			</Activity>
		</>
	)
})

const OptionsModal = memo(() => {
	const camera = useMolecule(CameraMolecule)

	return (
		<Modal header='Options' id={`camera-options-${camera.scope.camera.name}`} maxWidth='280px' onHide={() => (camera.state.request.show = false)}>
			<OptionsBody />
		</Modal>
	)
})

const OptionsBody = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { transferFormat, compressed, dither } = useSnapshot(camera.state.request)

	return (
		<div className='grid grid-cols-12 items-center gap-2 p-2'>
			<CameraTransferFormatSelect className='col-span-6' onValueChange={(value) => camera.update('transferFormat', value)} value={transferFormat} />
			<Checkbox className='col-span-6' label='Compressed' onValueChange={(value) => camera.update('compressed', value)} value={compressed} />
			<div className='col-span-full flex flex-row items-center gap-2'>
				<span className='font-bold text-sm'>DITHER</span>
				<Switch isSelected={dither.enabled} onValueChange={(value) => camera.updateDither('enabled', value)} size='sm' />
			</div>
			<NumberInput className='col-span-8' disabled={!dither.enabled} fractionDigits={1} label='Dither pixels (px)' maxValue={25} minValue={1} onValueChange={(value) => camera.updateDither('amount', value)} placeholder='5' step={0.1} value={dither.amount} />
			<Checkbox className='col-span-4' disabled={!dither.enabled} label='RA only' onValueChange={(value) => camera.updateDither('raOnly', value)} value={dither.raOnly} />
		</div>
	)
})

const Cooler = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing } = useSnapshot(camera.state)
	const { connected, hasCooler, cooler, coolerPower } = useSnapshot(camera.state.camera)

	return (
		<>
			<Switch className='col-span-3 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || capturing || !hasCooler} isSelected={cooler} onValueChange={camera.cooler} size='sm'>
				Cooler ({(coolerPower * 100).toFixed(1)}%)
			</Switch>
			<Switch className='col-span-3 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={true || !connected || capturing} size='sm'>
				Dew Heater
			</Switch>
		</>
	)
})

const Temperature = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing } = useSnapshot(camera.state)
	const { connected, temperature, canSetTemperature } = useSnapshot(camera.state.camera)
	const { targetTemperature } = useSnapshot(camera.state)

	return (
		<NumberInput
			className='col-span-6'
			disabled={!connected || !canSetTemperature || capturing}
			endContent={<TemperatureNumberInputEndContent />}
			fractionDigits={1}
			label={`Temperature (${temperature.toFixed(1)}°C)`}
			maxValue={50}
			minValue={-50}
			onValueChange={(value) => (camera.state.targetTemperature = value)}
			step={0.1}
			value={targetTemperature}
		/>
	)
})

const TemperatureNumberInputEndContent = memo(() => {
	const camera = useMolecule(CameraMolecule)

	return <IconButton color='success' icon={Icons.Check} onPointerUp={camera.temperature} size='sm' tooltipContent='Apply' />
})

const Exposure = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing } = useSnapshot(camera.state)
	const { connected, exposure } = useSnapshot(camera.state.camera)
	const { exposureTime, exposureTimeUnit, frameType } = useSnapshot(camera.state.request)

	return (
		<>
			<ExposureTimeInput
				className='col-span-6'
				disabled={!connected || frameType === 'BIAS' || capturing}
				maxValue={exposure.max}
				maxValueUnit='SECOND'
				minValue={exposure.min}
				minValueUnit='SECOND'
				onUnitChange={(value) => camera.update('exposureTimeUnit', value)}
				onValueChange={(value) => camera.update('exposureTime', value)}
				unit={exposureTimeUnit}
				value={exposureTime}
			/>
			<FrameTypeSelect className='col-span-6' isDisabled={!connected || capturing} onValueChange={(value) => camera.update('frameType', value)} value={frameType} />
		</>
	)
})

const ExposureMode = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing } = useSnapshot(camera.state)
	const { connected } = useSnapshot(camera.state.camera)
	const { exposureMode, delay, count } = useSnapshot(camera.state.request)

	return (
		<>
			<ExposureModeButtonGroup className='col-span-6' color='secondary' isDisabled={!connected || capturing} onValueChange={(value) => camera.update('exposureMode', value)} value={exposureMode} />
			<NumberInput className='col-span-3' disabled={!connected || exposureMode === 'SINGLE' || capturing} label='Delay (s)' minValue={0} onValueChange={(value) => camera.update('delay', value)} value={delay} />
			<NumberInput className='col-span-3' disabled={!connected || exposureMode !== 'FIXED' || capturing} label='Count' minValue={1} onValueChange={(value) => camera.update('count', value)} value={count} />
		</>
	)
})

const Bin = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing } = useSnapshot(camera.state)
	const { connected, bin, canBin } = useSnapshot(camera.state.camera)
	const { binX, binY } = useSnapshot(camera.state.request)

	return (
		<>
			<NumberInput className='col-span-3' disabled={!connected || !canBin || capturing} label='Bin X' maxValue={bin.x.max} minValue={1} onValueChange={(value) => camera.update('binX', value)} value={binX} />
			<NumberInput className='col-span-3' disabled={!connected || !canBin || capturing} label='Bin Y' maxValue={bin.y.max} minValue={1} onValueChange={(value) => camera.update('binY', value)} value={binY} />
		</>
	)
})

const Frame = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing } = useSnapshot(camera.state)
	const { connected, canSubFrame, frame } = useSnapshot(camera.state.camera)
	const { subframe, x, y, width, height } = useSnapshot(camera.state.request)

	return (
		<>
			<div className='col-span-6 flex flex-row items-center justify-center gap-2'>
				<Checkbox className='flex-col-reverse gap-0.4 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} disabled={!connected || !canSubFrame || capturing} label='Subframe' onValueChange={(value) => camera.update('subframe', value)} value={subframe} />
				<IconButton color='secondary' disabled={!connected || !subframe || capturing} icon={Icons.Fullscreen} onPointerUp={camera.fullscreen} tooltipContent='Fullscreen' variant='flat' />
			</div>
			<NumberInput className='col-span-3' disabled={!connected || !subframe || capturing} label='X' maxValue={frame.x.max} minValue={frame.x.min} onValueChange={(value) => camera.update('x', value)} value={x} />
			<NumberInput className='col-span-3' disabled={!connected || !subframe || capturing} label='Y' maxValue={frame.y.max} minValue={frame.y.min} onValueChange={(value) => camera.update('y', value)} value={y} />
			<NumberInput className='col-span-3' disabled={!connected || !subframe || capturing} label='Width' maxValue={frame.width.max} minValue={frame.width.min} onValueChange={(value) => camera.update('width', value)} value={width} />
			<NumberInput className='col-span-3' disabled={!connected || !subframe || capturing} label='Height' maxValue={frame.height.max} minValue={frame.height.min} onValueChange={(value) => camera.update('height', value)} value={height} />
		</>
	)
})

const GainAndFormat = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing } = useSnapshot(camera.state)
	const { connected, gain, offset, frameFormats } = useSnapshot(camera.state.camera)
	const { request } = useSnapshot(camera.state)

	return (
		<>
			<NumberInput className='col-span-3' disabled={!connected || capturing} label='Gain' maxValue={gain.max} minValue={gain.min} onValueChange={(value) => camera.update('gain', value)} value={request.gain} />
			<NumberInput className='col-span-3' disabled={!connected || capturing} label='Offset' maxValue={offset.max} minValue={offset.min} onValueChange={(value) => camera.update('offset', value)} value={request.offset} />
			<FrameFormatSelect className='col-span-6' isDisabled={!connected || !frameFormats.length || capturing} items={frameFormats} onValueChange={(value) => camera.update('frameFormat', value)} value={request.frameFormat} />
		</>
	)
})

const CameraEquipment = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing } = useSnapshot(camera.state)
	const { connected } = useSnapshot(camera.state.camera)
	const { mount, wheel, focuser, rotator } = useSnapshot(camera.state.equipment)
	const isDisabled = !connected || capturing

	return (
		<>
			<MountDropdown isDisabled={isDisabled} onValueChange={camera.updateMount} tooltipContent={`MOUNT: ${mount?.name ?? 'None'}`} value={mount} />
			<WheelDropdown isDisabled={isDisabled} onValueChange={camera.updateWheel} tooltipContent={`WHEEL: ${wheel?.name ?? 'None'}`} value={wheel} />
			<FocuserDropdown isDisabled={isDisabled} onValueChange={camera.updateFocuser} tooltipContent={`FOCUSER: ${focuser?.name ?? 'None'}`} value={focuser} />
			<RotatorDropdown isDisabled={isDisabled} onValueChange={camera.updateRotator} tooltipContent={`ROTATOR: ${rotator?.name ?? 'None'}`} value={rotator} />
		</>
	)
})

const Footer = memo(() => {
	const camera = useMolecule(CameraMolecule)
	const { capturing } = useSnapshot(camera.state)
	const { connected, canAbort } = useSnapshot(camera.state.camera)

	return (
		<>
			<div className='flex flex-1 flex-row items-center gap-1'>
				<CameraEquipment />
			</div>
			<Button color='danger' disabled={!connected || !canAbort || !capturing} label='Stop' onPointerUp={camera.stop} startContent={<Icons.Stop />} />
			<Button color='success' disabled={!connected} label='Start' loading={capturing} onPointerUp={camera.start} startContent={<Icons.Play />} />
		</>
	)
})
