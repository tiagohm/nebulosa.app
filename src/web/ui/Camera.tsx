import { useDevice } from '@hooks/device.hook'
import { CameraStoreContext } from '@shared/context'
import { cameraStore } from '@stores/camera.store'
import { AutoSaveButton } from '@ui/AutoSaveButton'
import { AutoSubFolderModeButton } from '@ui/AutoSubFolderButton'
import { CameraTransferFormatSelect } from '@ui/CameraTransferFormatSelect'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { IconButton, type IconButtonProps } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Switch } from '@ui/components/Switch'
import { Tab, TabPanel, Tabs } from '@ui/components/Tabs'
import { ConnectButton } from '@ui/ConnectButton'
import { FocuserDropdown, MountDropdown, RotatorDropdown, WheelDropdown } from '@ui/DeviceDropdown'
import { ExposureModeButtonGroup } from '@ui/ExposureModeButtonGroup'
import { ExposureTimeInput } from '@ui/ExposureTimeInput'
import { ExposureTimeProgress } from '@ui/ExposureTimeProgress'
import { FilePickerInput } from '@ui/FilePickerInput'
import { FrameFormatSelect } from '@ui/FrameFormatSelect'
import { FrameTypeSelect } from '@ui/FrameTypeSelect'
import { Icons } from '@ui/Icon'
import { IndiPanelControl } from '@ui/IndiPanelControl'
import type { IDockviewPanelProps } from 'dockview-react'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

export const Camera = memo(({ params }: IDockviewPanelProps<Device>) => {
	const camera = useDevice('camera', params.id, cameraStore)

	if (!camera) return <div className="flex h-full w-full items-center justify-center">Not available</div>

	return (
		<CameraStoreContext value={camera.store}>
			<Tabs className="h-full p-3" startContent={<TabStartContent />}>
				<Tab id="main">Camera</Tab>
				<Tab id="options">Options</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="main">
					<Main />
				</TabPanel>
				<TabPanel id="options">
					<Options />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={camera.device} />
				</TabPanel>
			</Tabs>
		</CameraStoreContext>
	)
})

const TabStartContent = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected, connecting } = useSnapshot(camera.state.camera)

	return <ConnectButton disabled={capturing} connected={connected} loading={connecting} onClick={camera.connect} />
})

const Main = memo(() => (
	<div className="grid grid-cols-12 gap-2">
		<Header />
		<Path />
		<Cooler />
		<Temperature />
		<Exposure />
		<ExposureMode />
		<Bin />
		<Frame />
		<GainAndFormat />
		<Footer />
	</div>
))

const Header = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { progress } = useSnapshot(camera.state)

	return (
		<div className="col-span-full flex flex-row items-center justify-between gap-2">
			<ExposureTimeProgress className="min-w-0 flex-1 overflow-x-auto" progress={progress} />
		</div>
	)
})

const Path = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { autoSave, autoSubFolderMode, savePath } = useSnapshot(camera.state.request)

	return (
		<div className="col-span-full flex flex-row items-center gap-1">
			<AutoSaveButton disabled={capturing} onValueChange={camera.capture.setAutoSave} value={autoSave} />
			<AutoSubFolderModeButton disabled={!autoSave || capturing} onValueChange={camera.capture.setAutoSubFolderMode} value={autoSubFolderMode} />
			<FilePickerInput disabled={!autoSave || capturing} fullWidth id={`camera-${camera.state.camera.id}`} mode="directory" onValueChange={camera.capture.setSavePath} value={savePath} />
		</div>
	)
})

const Options = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { transferFormat, compressed, dither } = useSnapshot(camera.state.request)

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-2">
			<CameraTransferFormatSelect className="col-span-7" onValueChange={camera.capture.setTransferFormat} value={transferFormat} />
			<Checkbox className="col-span-5" label="Compressed" onValueChange={camera.capture.setCompressed} value={compressed} />
			<div className="col-span-full flex flex-row items-center gap-2 border-t border-dashed border-neutral-500 pt-2">
				<span className="text-sm font-bold">DITHER</span>
				<Switch onValueChange={(value) => camera.updateDither('enabled', value)} value={dither.enabled} />
			</div>
			<NumberInput className="col-span-8" disabled={!dither.enabled} fractionDigits={1} label="Dither pixels (px)" maxValue={25} minValue={1} onValueChange={(value) => camera.updateDither('amount', value)} placeholder="5" step={0.1} value={dither.amount} />
			<Checkbox className="col-span-4" disabled={!dither.enabled} label="RA only" onValueChange={(value) => camera.updateDither('raOnly', value)} value={dither.raOnly} />
		</div>
	)
})

const Cooler = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected, hasCooler, hasCoolerControl, cooler, coolerPower } = useSnapshot(camera.state.camera)
	const isDisabled = !connected || capturing

	if (!hasCooler || !hasCoolerControl) return null

	return (
		<div className="col-span-6 flex flex-row items-center">
			<Switch className="w-1/2" disabled={isDisabled} onValueChange={camera.cooler} label={`${(coolerPower * 100).toFixed(1)}%`} thumbContent={<Icons.SnowFlake />} value={cooler} />
		</div>
	)
})

const Temperature = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected, temperature, canSetTemperature } = useSnapshot(camera.state.camera)
	const { targetTemperature } = useSnapshot(camera.state)
	const isDisabled = !connected || !canSetTemperature || capturing

	if (!canSetTemperature) return null

	return (
		<NumberInput
			className="col-span-6"
			disabled={isDisabled}
			endContent={<TemperatureNumberInputEndContent disabled={isDisabled} onClick={camera.temperature} />}
			fractionDigits={1}
			fullWidth
			label={`Temp: ${temperature.toFixed(1)}°C`}
			maxValue={50}
			minValue={-50}
			onValueChange={(value) => (camera.state.targetTemperature = value)}
			step={0.1}
			value={targetTemperature}
		/>
	)
})

interface TemperatureNumberInputEndContentProps extends Omit<IconButtonProps, 'icon' | 'children'> {}

function TemperatureNumberInputEndContent(props: TemperatureNumberInputEndContentProps) {
	return <IconButton color="success" icon={Icons.Check} size="sm" tooltipContent="Apply" {...props} />
}

const Exposure = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected, exposure } = useSnapshot(camera.state.camera)
	const { exposureTime, exposureTimeUnit, frameType } = useSnapshot(camera.state.request)

	return (
		<>
			<ExposureTimeInput
				className="col-span-6"
				disabled={!connected || frameType === 'BIAS' || capturing}
				maxValue={exposure.max}
				maxValueUnit="second"
				minValue={exposure.min}
				minValueUnit="second"
				onUnitChange={camera.capture.setExposureTimeUnit}
				onValueChange={camera.capture.setExposureTime}
				unit={exposureTimeUnit}
				value={exposureTime}
			/>
			<FrameTypeSelect className="col-span-6" disabled={!connected || capturing} onValueChange={camera.capture.setFrameType} value={frameType} />
		</>
	)
})

const ExposureMode = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected } = useSnapshot(camera.state.camera)
	const { exposureMode, delay, count } = useSnapshot(camera.state.request)

	return (
		<>
			<ExposureModeButtonGroup className="col-span-6" fullWidth color="secondary" disabled={!connected || capturing} onValueChange={camera.capture.setExposureMode} value={exposureMode} />
			<NumberInput className="col-span-3" disabled={!connected || exposureMode === 'single' || capturing} label="Delay (s)" minValue={0} onValueChange={camera.capture.setDelay} value={delay} />
			<NumberInput className="col-span-3" disabled={!connected || exposureMode !== 'fixed' || capturing} label="Count" minValue={1} onValueChange={camera.capture.setCount} value={count} />
		</>
	)
})

const Bin = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected, bin, canBin } = useSnapshot(camera.state.camera)
	const { binX, binY } = useSnapshot(camera.state.request)

	return (
		<>
			<NumberInput className="col-span-3" disabled={!connected || !canBin || capturing} label="Bin X" maxValue={bin.x.max} minValue={bin.x.min} onValueChange={camera.capture.setBinX} value={binX} />
			<NumberInput className="col-span-3" disabled={!connected || !canBin || capturing} label="Bin Y" maxValue={bin.y.max} minValue={bin.y.min} onValueChange={camera.capture.setBinY} value={binY} />
		</>
	)
})

const Frame = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected, canSubFrame } = useSnapshot(camera.state.camera)
	const { subframe } = useSnapshot(camera.state.request)

	return (
		<>
			<div className="col-span-6 flex flex-row items-center justify-center gap-2">
				<Checkbox className="max-w-none flex-col-reverse justify-center gap-0.5 text-xs" disabled={!connected || !canSubFrame || capturing} label="Subframe" onValueChange={camera.capture.setSubframe} value={subframe} />
				<IconButton color="secondary" disabled={!connected || !canSubFrame || !subframe || capturing} icon={Icons.Fullscreen} onClick={camera.fullscreen} tooltipContent="Fullscreen" variant="flat" />
				<IconButton color="secondary" disabled={!connected || !canSubFrame || !subframe || capturing} icon={Icons.Box} onClick={camera.requestRoi} tooltipContent="Apply ROI" variant="flat" />
			</div>
			<FrameDimensions />
		</>
	)
})

const FrameDimensions = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected, canSubFrame, frame } = useSnapshot(camera.state.camera)
	const { subframe, x, y, width, height } = useSnapshot(camera.state.request)
	const isDisabled = !connected || !canSubFrame || capturing

	if (!subframe || !canSubFrame) return null

	return (
		<>
			<NumberInput className="col-span-3" disabled={isDisabled} label="X" maxValue={frame.x.max} minValue={frame.x.min} onValueChange={camera.capture.setX} value={x} />
			<NumberInput className="col-span-3" disabled={isDisabled} label="Y" maxValue={frame.y.max} minValue={frame.y.min} onValueChange={camera.capture.setY} value={y} />
			<NumberInput className="col-span-3" disabled={isDisabled} label="Width" maxValue={frame.width.max} minValue={frame.width.min} onValueChange={camera.capture.setWidth} value={width} />
			<NumberInput className="col-span-3" disabled={isDisabled} label="Height" maxValue={frame.height.max} minValue={frame.height.min} onValueChange={camera.capture.setHeight} value={height} />
		</>
	)
})

const GainAndFormat = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected, gain, offset, frameFormats } = useSnapshot(camera.state.camera)
	const { request } = useSnapshot(camera.state)

	return (
		<>
			<NumberInput className="col-span-3" disabled={!connected || capturing} label="Gain" maxValue={gain.max} minValue={gain.min} onValueChange={camera.capture.setGain} value={request.gain} />
			<NumberInput className="col-span-3" disabled={!connected || capturing} label="Offset" maxValue={offset.max} minValue={offset.min} onValueChange={camera.capture.setOffset} value={request.offset} />
			<FrameFormatSelect className="col-span-6" disabled={!connected || frameFormats.length === 0 || capturing} items={frameFormats} onValueChange={camera.capture.setFrameFormat} value={request.frameFormat} />
		</>
	)
})

const CameraEquipment = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected } = useSnapshot(camera.state.camera)
	const { mount, wheel, focuser, rotator } = useSnapshot(camera.state.equipment)
	const isDisabled = !connected || capturing

	return (
		<>
			<MountDropdown disabled={isDisabled} onValueChange={camera.updateMount} tooltipContent={`MOUNT: ${mount?.name ?? 'None'}`} value={mount} />
			<WheelDropdown disabled={isDisabled} onValueChange={camera.updateWheel} tooltipContent={`WHEEL: ${wheel?.name ?? 'None'}`} value={wheel} />
			<FocuserDropdown disabled={isDisabled} onValueChange={camera.updateFocuser} tooltipContent={`FOCUSER: ${focuser?.name ?? 'None'}`} value={focuser} />
			<RotatorDropdown disabled={isDisabled} onValueChange={camera.updateRotator} tooltipContent={`ROTATOR: ${rotator?.name ?? 'None'}`} value={rotator} />
		</>
	)
})

const Footer = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { capturing } = useSnapshot(camera.state)
	const { connected, canAbort } = useSnapshot(camera.state.camera)

	return (
		<div className="col-span-full flex flex-row items-center gap-2">
			<div className="flex min-w-0 flex-1 flex-row items-center gap-1 overflow-x-auto">
				<CameraEquipment />
			</div>
			<Button color="danger" disabled={!connected || !canAbort || !capturing} label="Stop" onClick={camera.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={!connected} label="Start" loading={capturing} onClick={camera.start} startContent={<Icons.Play />} />
		</div>
	)
})
