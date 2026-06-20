import { memo, useContext } from 'react'
import type { DarvState } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { darvStore } from '@/stores/darv.store'
import { equipmentStore } from '@/stores/equipment.store'
import { useStore } from '../hooks/store.hook'
import { CameraDeviceContext, DarvStoreContext, MountDeviceContext } from '../shared/context'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { Button } from './components/Button'
import { Chip, type ChipProps } from './components/Chip'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { Popover } from './components/Popover'
import { TextInput } from './components/TextInput'
import { ConnectButton } from './ConnectButton'
import { DarvExposureModeButtonGroup } from './DarvExposureModeButtonGroup'
import { DarvExposurePresetModeButtonGroup } from './DarvExposurePresetModeButtonGroup'
import { HemisphereSelect } from './HemisphereSelect'
import { Icons } from './Icon'
import { Modal } from './Modal'

const DARV_STATE_COLORS = {
	idle: 'default',
	waiting: 'warning',
	forwarding: 'primary',
	backwarding: 'secondary',
} satisfies Record<DarvState, NonNullable<ChipProps['color']>>

export const Darv = memo(() => {
	const camera = useContext(CameraDeviceContext)
	const mount = useContext(MountDeviceContext)
	const darv = useStore(() => darvStore(camera, mount), [camera, mount])

	return (
		<DarvStoreContext value={darv}>
			<Modal footer={<Footer />} header="Drift Alignment by Robert Vice" id={`darv-${camera.id}-${mount.id}`} initialWidth="376px" onHide={darv.hide}>
				<Body />
			</Modal>
		</DarvStoreContext>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<CameraAndMount />
		<Status />
		<Input />
	</div>
))

const CameraAndMount = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { capture } = useSnapshot(darv.state.request)
	const { connected: cameraConnected } = useSnapshot(darv.state.camera)
	const { connected: mountConnected } = useSnapshot(darv.state.mount)

	const CameraStartContent = <ConnectButton connected={cameraConnected} onClick={() => equipmentStore.connect(darv.state.camera)} size="sm" />
	const MountStartContent = <ConnectButton connected={mountConnected} onClick={() => equipmentStore.connect(darv.state.mount)} size="sm" />
	const CameraEndContent = <CameraCaptureStartPopover camera={darv.state.camera} mode="darv" onValueChange={darv.updateCapture} value={capture} />

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-between gap-2">
			<TextInput className="flex-1" readOnly label="Camera" value={darv.state.camera.name} startContent={CameraStartContent} endContent={CameraEndContent} />
			<TextInput className="flex-1" readOnly label="Mount" value={darv.state.mount.name} startContent={MountStartContent} />
		</div>
	)
})

const Status = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { state } = useSnapshot(darv.state.event)

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-between">
			<Chip color={DARV_STATE_COLORS[state]} size="sm">
				{state}
			</Chip>
		</div>
	)
})

const Input = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { running } = useSnapshot(darv.state)
	const { hemisphere, duration, initialPause } = useSnapshot(darv.state.request)

	return (
		<>
			<NumberInput className="col-span-6" disabled={running} label="Initial pause" endContent="s" maxValue={60} minValue={1} onValueChange={(value) => darv.update('initialPause', value)} value={initialPause} />
			<NumberInput className="col-span-6" disabled={running} label="Exposure time" maxValue={1200} minValue={1} onValueChange={(value) => darv.update('duration', value)} value={duration} startContent={<ExposureEstimatorPopover />} endContent="s" />
			<HemisphereSelect className="col-span-6" disabled={running} onValueChange={(value) => darv.update('hemisphere', value)} value={hemisphere} />
		</>
	)
})

const Footer = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { running, camera, mount } = useSnapshot(darv.state)

	return (
		<>
			<Button color="danger" disabled={!running} label="Stop" onClick={darv.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={!camera?.connected || !mount?.connected} label="Start" loading={running} onClick={darv.start} startContent={<Icons.Play />} />
		</>
	)
})

const ExposureEstimatorPopover = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { running } = useSnapshot(darv.state)
	const { connected } = useSnapshot(darv.state.mount)

	return (
		<Popover className="w-100" disabled={running} trigger={<IconButton disabled={running || !connected} icon={Icons.Calculator} size="sm" tooltipContent="Estimate exposure" />}>
			<ExposureEstimatorPopoverContent />
		</Popover>
	)
})

const ExposureEstimatorPopoverContent = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { focalLength, pixelSize, mode, preset, presetMode } = useSnapshot(darv.state.exposureEstimation)

	return (
		<div className="grid w-full grid-cols-24 gap-2 p-1">
			<NumberInput className="col-span-12" endContent="mm" fullWidth label="Focal length" maxValue={100000} minValue={1} onValueChange={(value) => darv.updateExposureEstimation('focalLength', value)} value={focalLength} />
			<NumberInput className="col-span-12" endContent="µm" fractionDigits={2} fullWidth label="Pixel size" maxValue={1000} minValue={0.01} onValueChange={(value) => darv.updateExposureEstimation('pixelSize', value)} step={0.01} value={pixelSize} />
			<div className="col-span-full flex flex-col gap-1">
				<span className="text-xs text-neutral-400">Mode</span>
				<DarvExposureModeButtonGroup fullWidth onValueChange={(value) => darv.updateExposureEstimation('mode', value)} size="sm" value={mode} />
			</div>
			<div className="col-span-full flex flex-col gap-1">
				<span className="text-xs text-neutral-400">Preset</span>
				<DarvExposurePresetModeButtonGroup fullWidth onValueChange={(value) => darv.updateExposureEstimation('presetMode', value)} size="sm" value={presetMode} />
			</div>
			<NumberInput disabled={presetMode !== 'custom'} className="col-span-12" label="RA trail length" endContent="px" minValue={1} maxValue={1000} value={preset.targetTrail} onValueChange={(value) => darv.updateExposureEstimationPreset('targetTrail', value)} />
			<NumberInput disabled={presetMode !== 'custom'} className="col-span-12" label="Min. separation" endContent="px" minValue={1} maxValue={10} value={preset.detectableSeparation} onValueChange={(value) => darv.updateExposureEstimationPreset('detectableSeparation', value)} />
			<NumberInput disabled={presetMode !== 'custom'} className="col-span-full" label="Target polar error" minValue={1} maxValue={30} endContent="arcmin" value={preset.targetPolarError} onValueChange={(value) => darv.updateExposureEstimationPreset('targetPolarError', value)} />
			<Button className="col-span-full mt-1" color="success" fullWidth label="Estimate" onClick={darv.estimateExposure} startContent={<Icons.Calculator />} />
		</div>
	)
})
