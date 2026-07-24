import { CameraCaptureStoreContext } from '@shared/context'
import { CameraExposureTimeInput } from '@ui/CameraExposureTimeInput'
import { CameraTransferFormatSelect } from '@ui/CameraTransferFormatSelect'
import { Checkbox } from '@ui/components/Checkbox'
import { IconButton, type IconButtonProps } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Popover } from '@ui/components/Popover'
import { FrameFormatSelect } from '@ui/FrameFormatSelect'
import { Icons } from '@ui/Icon'
import type { DeepReadonly } from 'nebulosa/src/core/types'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { useContext } from 'react'
import { useSnapshot } from 'valtio'

export type CameraCaptureStartPopoverMode = 'capture' | 'autoFocus' | 'flatWizard' | 'darv' | 'tppa' | 'guider'

export interface CameraCaptureStartPopoverProps extends Omit<IconButtonProps, 'icon' | 'value' | 'onValueChange'> {
	readonly mode: CameraCaptureStartPopoverMode
	readonly camera: DeepReadonly<Camera>
}

function canExposureTime(mode: CameraCaptureStartPopoverMode) {
	return mode === 'capture' || mode === 'autoFocus' || mode === 'tppa'
}

export function CameraCaptureStartPopover({ mode, camera, color, disabled, ...props }: CameraCaptureStartPopoverProps) {
	const capture = useContext(CameraCaptureStoreContext)
	const { exposureTimeUnit, exposureTime, frameFormat, x, y, width, height, binX, binY, gain, offset, transferFormat, compressed } = useSnapshot(capture.state)
	const exposureTimeDisabled = !canExposureTime(mode)

	return (
		<Popover className="max-w-90vw w-120" trigger={<IconButton {...props} color={color ?? (camera.connected ? 'success' : 'danger')} disabled={disabled || !camera.connected} icon={Icons.Cog} size="sm" />}>
			<div className="grid grid-cols-12 items-center gap-2 p-4">
				<p className="col-span-full font-bold">CAMERA CAPTURE OPTIONS</p>
				<CameraExposureTimeInput
					className="col-span-6"
					disabled={exposureTimeDisabled}
					fullWidth
					maxValue={camera.exposure.max}
					maxValueUnit="second"
					minValue={exposureTimeDisabled ? 0 : camera.exposure.min}
					minValueUnit="second"
					onUnitChange={capture.setExposureTimeUnit}
					onValueChange={capture.setExposureTime}
					unit={exposureTimeUnit}
					value={exposureTimeDisabled ? 0 : exposureTime}
				/>
				<FrameFormatSelect className="col-span-6" disabled={camera.frameFormats.length === 0} items={camera.frameFormats} onValueChange={capture.setFrameFormat} value={frameFormat} />
				<NumberInput className="col-span-3" label="X" maxValue={camera.frame.x.max} minValue={camera.frame.x.min} onValueChange={capture.setX} value={x} />
				<NumberInput className="col-span-3" label="Y" maxValue={camera.frame.y.max} minValue={camera.frame.y.min} onValueChange={capture.setY} value={y} />
				<NumberInput className="col-span-3" label="Width" maxValue={camera.frame.width.max} minValue={camera.frame.width.min} onValueChange={capture.setWidth} value={width} />
				<NumberInput className="col-span-3" label="Height" maxValue={camera.frame.height.max} minValue={camera.frame.height.min} onValueChange={capture.setHeight} value={height} />
				<NumberInput className="col-span-3" label="Bin X" maxValue={camera.bin.x.max} minValue={camera.bin.x.min} onValueChange={capture.setBinX} value={binX} />
				<NumberInput className="col-span-3" label="Bin Y" maxValue={camera.bin.y.max} minValue={camera.bin.y.min} onValueChange={capture.setBinY} value={binY} />
				<NumberInput className="col-span-3" label="Gain" maxValue={camera.gain.max} minValue={camera.gain.min} onValueChange={capture.setGain} value={gain} />
				<NumberInput className="col-span-3" label="Offset" maxValue={camera.offset.max} minValue={camera.offset.min} onValueChange={capture.setOffset} value={offset} />
				<CameraTransferFormatSelect className="col-span-6" onValueChange={capture.setTransferFormat} value={transferFormat} />
				<Checkbox className="col-span-6" label="Compressed" onValueChange={capture.setCompressed} value={compressed} />
			</div>
		</Popover>
	)
}
