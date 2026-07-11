import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useContext, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { cameraStore, type CameraStore } from '@/stores/camera.store'
import { CameraStoreContext } from '../shared/context'
import { equipmentStore } from '../stores/equipment.store'
import type { DevicePanelParams } from '../stores/workspace.store'
import { AutoSaveButton } from './AutoSaveButton'
import { AutoSubFolderModeButton } from './AutoSubFolderButton'
import { CameraTransferFormatSelect } from './CameraTransferFormatSelect'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { IconButton, type IconButtonProps } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { Switch } from './components/Switch'
import { Tab, TabPanel, Tabs } from './components/Tabs'
import { ConnectButton } from './ConnectButton'
import { FocuserDropdown, MountDropdown, RotatorDropdown, WheelDropdown } from './DeviceDropdown'
import { ExposureModeButtonGroup } from './ExposureModeButtonGroup'
import { ExposureTimeInput } from './ExposureTimeInput'
import { ExposureTimeProgress } from './ExposureTimeProgress'
import { FilePickerInput } from './FilePickerInput'
import { FrameFormatSelect } from './FrameFormatSelect'
import { FrameTypeSelect } from './FrameTypeSelect'
import { Icons } from './Icon'
import { IndiPanelControl } from './IndiPanelControl'

export const Camera = memo(({ params }: IDockviewPanelProps<DevicePanelParams>) => {
	const storeRef = useRef<CameraStore | undefined>(undefined)

	useEffect(() => storeRef.current?.mount(), [])

	const { length } = useSnapshot(equipmentStore.state.camera) // used only to rerender this component
	const camera = length > 0 && equipmentStore.state.camera.find((e) => e.id === params.id)

	if (!camera) {
		storeRef.current?.unmount()
		storeRef.current = undefined
		return <div className="flex h-full w-full items-center justify-center">Not available</div>
	}

	const store = storeRef.current ?? cameraStore(camera)
	storeRef.current = store

	return (
		<CameraStoreContext value={store}>
			<Tabs className="px-3">
				<Tab id="control">Camera</Tab>
				<Tab id="options">Options</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="control">
					<Control />
				</TabPanel>
				<TabPanel id="options">
					<Options />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={camera} />
				</TabPanel>
			</Tabs>
		</CameraStoreContext>
	)
})

const Control = memo(() => (
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
	const { capturing, progress } = useSnapshot(camera.state)
	const { connected, connecting } = useSnapshot(camera.state.camera)

	return (
		<div className="col-span-full flex flex-row items-center justify-between gap-2">
			<ConnectButton disabled={capturing} connected={connected} loading={connecting} onClick={camera.connect} />
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
			<AutoSaveButton disabled={capturing} onValueChange={(value) => camera.update('autoSave', value)} value={autoSave} />
			<AutoSubFolderModeButton disabled={!autoSave || capturing} onValueChange={(value) => camera.update('autoSubFolderMode', value)} value={autoSubFolderMode} />
			<FilePickerInput disabled={!autoSave || capturing} fullWidth id={`camera-${camera.state.camera.id}`} mode="directory" onValueChange={camera.updateSavePath} value={savePath} />
		</div>
	)
})

const Options = memo(() => {
	const camera = useContext(CameraStoreContext)
	const { transferFormat, compressed, dither } = useSnapshot(camera.state.request)

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-2">
			<CameraTransferFormatSelect className="col-span-7" onValueChange={(value) => camera.update('transferFormat', value)} value={transferFormat} />
			<Checkbox className="col-span-5" label="Compressed" onValueChange={(value) => camera.update('compressed', value)} value={compressed} />
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
	const { connected, hasCooler, cooler, coolerPower } = useSnapshot(camera.state.camera)
	const isDisabled = !connected || capturing

	if (!hasCooler) return null

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
				onUnitChange={(value) => camera.update('exposureTimeUnit', value)}
				onValueChange={(value) => camera.update('exposureTime', value)}
				unit={exposureTimeUnit}
				value={exposureTime}
			/>
			<FrameTypeSelect className="col-span-6" disabled={!connected || capturing} onValueChange={(value) => camera.update('frameType', value)} value={frameType} />
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
			<ExposureModeButtonGroup className="col-span-6" fullWidth color="secondary" disabled={!connected || capturing} onValueChange={(value) => camera.update('exposureMode', value)} value={exposureMode} />
			<NumberInput className="col-span-3" disabled={!connected || exposureMode === 'single' || capturing} label="Delay (s)" minValue={0} onValueChange={(value) => camera.update('delay', value)} value={delay} />
			<NumberInput className="col-span-3" disabled={!connected || exposureMode !== 'fixed' || capturing} label="Count" minValue={1} onValueChange={(value) => camera.update('count', value)} value={count} />
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
			<NumberInput className="col-span-3" disabled={!connected || !canBin || capturing} label="Bin X" maxValue={bin.x.max} minValue={bin.x.min} onValueChange={(value) => camera.update('binX', value)} value={binX} />
			<NumberInput className="col-span-3" disabled={!connected || !canBin || capturing} label="Bin Y" maxValue={bin.y.max} minValue={bin.y.min} onValueChange={(value) => camera.update('binY', value)} value={binY} />
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
				<Checkbox className="max-w-none flex-col-reverse justify-center gap-0.5 text-xs" disabled={!connected || !canSubFrame || capturing} label="Subframe" onValueChange={(value) => camera.update('subframe', value)} value={subframe} />
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
			<NumberInput className="col-span-3" disabled={isDisabled} label="X" maxValue={frame.x.max} minValue={frame.x.min} onValueChange={(value) => camera.update('x', value)} value={x} />
			<NumberInput className="col-span-3" disabled={isDisabled} label="Y" maxValue={frame.y.max} minValue={frame.y.min} onValueChange={(value) => camera.update('y', value)} value={y} />
			<NumberInput className="col-span-3" disabled={isDisabled} label="Width" maxValue={frame.width.max} minValue={frame.width.min} onValueChange={(value) => camera.update('width', value)} value={width} />
			<NumberInput className="col-span-3" disabled={isDisabled} label="Height" maxValue={frame.height.max} minValue={frame.height.min} onValueChange={(value) => camera.update('height', value)} value={height} />
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
			<NumberInput className="col-span-3" disabled={!connected || capturing} label="Gain" maxValue={gain.max} minValue={gain.min} onValueChange={(value) => camera.update('gain', value)} value={request.gain} />
			<NumberInput className="col-span-3" disabled={!connected || capturing} label="Offset" maxValue={offset.max} minValue={offset.min} onValueChange={(value) => camera.update('offset', value)} value={request.offset} />
			<FrameFormatSelect className="col-span-6" disabled={!connected || frameFormats.length === 0 || capturing} items={frameFormats} onValueChange={(value) => camera.update('frameFormat', value)} value={request.frameFormat} />
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
