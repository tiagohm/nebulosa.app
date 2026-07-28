import { useStore } from '@hooks/store.hook'
import { CameraCaptureStoreContext, DarvStoreContext } from '@shared/context'
import { darvStore } from '@stores/darv.store'
import { CameraCaptureStartPopover } from '@ui/CameraCaptureStartPopover'
import { Button } from '@ui/components/Button'
import { Chip } from '@ui/components/Chip'
import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Popover } from '@ui/components/Popover'
import { DarvExposureModeButtonGroup } from '@ui/DarvExposureModeButtonGroup'
import { DarvExposurePresetModeButtonGroup } from '@ui/DarvExposurePresetModeButtonGroup'
import { DarvHemisphereSelect } from '@ui/DarvHemisphereSelect'
import { CameraDropdown, MountDropdown } from '@ui/DeviceDropdown'
import { Icons } from '@ui/Icon'
import type { IDockviewPanelProps } from 'dockview-react'
import { formatALT } from 'nebulosa/src/math/units/angle'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

export const Darv = memo(({ api }: IDockviewPanelProps) => {
	const darv = useStore(() => darvStore(api), [api.id])

	return (
		<DarvStoreContext value={darv}>
			<div className="grid grid-cols-12 gap-2 p-2">
				<CameraAndMount />
				<Status />
				<Input />
				<Footer />
			</div>
		</DarvStoreContext>
	)
})

const CameraAndMount = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { camera, mount, running } = useSnapshot(darv.state)

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-center gap-2">
			<CameraDropdown showLabel disabled={running} value={camera} onValueChange={(value) => (darv.state.camera = value)} startContent={<CameraDropdownEndContent />} />
			<MountDropdown showLabel disabled={running} value={mount} onValueChange={(value) => (darv.state.mount = value)} />
		</div>
	)
})

const Status = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { state } = useSnapshot(darv.state.event)
	const color = state === 'idle' ? 'default' : state === 'waiting' ? 'warning' : state === 'forwarding' ? 'primary' : 'secondary'

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-between">
			<Chip color={color} size="sm">
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
			<NumberInput className="col-span-6" disabled={running} label="Initial pause" endContent="s" maxValue={60} minValue={1} onValueChange={darv.setInitialPause} value={initialPause} />
			<NumberInput className="col-span-6" disabled={running} label="Exposure time" maxValue={1200} minValue={1} onValueChange={darv.setDuration} value={duration} startContent={<ExposureEstimatorPopover />} endContent="s" />
			<DarvHemisphereSelect className="col-span-6" disabled={running} onValueChange={darv.setHemisphere} value={hemisphere} />
		</>
	)
})

const Footer = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { running, camera, mount } = useSnapshot(darv.state)

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="danger" disabled={!running} label="Stop" onClick={darv.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={!camera?.connected || !mount?.connected} label="Start" loading={running} onClick={darv.start} startContent={<Icons.Play />} />
		</div>
	)
})

const ExposureEstimatorPopover = memo(() => (
	<Popover className="w-100" trigger={<ExposureEstimatorPopoverTrigger />}>
		<ExposureEstimatorPopoverContent />
	</Popover>
))

const ExposureEstimatorPopoverTrigger = memo((props: Record<string, unknown>) => {
	const darv = useContext(DarvStoreContext)
	const { mount } = useSnapshot(darv.state)

	return <IconButton {...props} disabled={!mount?.connected} icon={Icons.Calculator} size="sm" tooltipContent="Estimate exposure" />
})

const ExposureEstimatorPopoverContent = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { mount } = useSnapshot(darv.state)
	const { focalLength, pixelSize, mode, preset, presetMode } = useSnapshot(darv.state.exposureEstimation)

	if (!mount) return null

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
			<div className="col-span-8 flex flex-col gap-0">
				<span className="font-bold">LATITUDE:</span>
				<span>{formatALT(mount.geographicCoordinate.latitude)}</span>
			</div>
			<div className="col-span-8 flex flex-col gap-0">
				<span className="font-bold">DECLINATION:</span>
				<span>{formatALT(mount.equatorialCoordinate.declination)}</span>
			</div>
			<div className="col-span-8 flex flex-col gap-0">
				<span className="font-bold">GUIDE RATE:</span>
				<span>{mount.hasGuideRate ? mount.guideRate.rightAscension : 1}</span>
			</div>
			<NumberInput disabled={presetMode !== 'custom'} className="col-span-12" label="RA trail length" endContent="px" minValue={1} maxValue={1000} value={preset.targetTrail} onValueChange={(value) => darv.updateExposureEstimationPreset('targetTrail', value)} />
			<NumberInput disabled={presetMode !== 'custom'} className="col-span-12" label="Min. separation" endContent="px" minValue={1} maxValue={10} value={preset.detectableSeparation} onValueChange={(value) => darv.updateExposureEstimationPreset('detectableSeparation', value)} />
			<NumberInput disabled={presetMode !== 'custom'} className="col-span-full" label="Target polar error" minValue={1} maxValue={30} endContent="arcmin" value={preset.targetPolarError} onValueChange={(value) => darv.updateExposureEstimationPreset('targetPolarError', value)} />
			<Button className="col-span-full mt-1" color="success" fullWidth label="Estimate" onClick={darv.estimateExposure} startContent={<Icons.Calculator />} />
		</div>
	)
})

const CameraDropdownEndContent = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { camera } = useSnapshot(darv.state)

	return (
		camera && (
			<CameraCaptureStoreContext value={darv.capture}>
				<CameraCaptureStartPopover camera={camera} mode="darv" />
			</CameraCaptureStoreContext>
		)
	)
})
