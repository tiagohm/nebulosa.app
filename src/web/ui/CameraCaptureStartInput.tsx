import { CameraCaptureStoreContext } from '@shared/context'
import { tw } from '@shared/util'
import { CameraExposureTimeInput } from '@ui/CameraExposureTimeInput'
import { CameraTransferFormatSelect } from '@ui/CameraTransferFormatSelect'
import { Checkbox } from '@ui/components/Checkbox'
import { NumberInput } from '@ui/components/NumberInput'
import { FrameFormatSelect } from '@ui/FrameFormatSelect'
import type { DeepReadonly } from 'nebulosa/src/core/types'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { useContext } from 'react'
import { useSnapshot } from 'valtio'

export type CameraCaptureStartInputMode = 'capture' | 'autoFocus' | 'flatWizard' | 'darv' | 'tppa' | 'guider'

export interface CameraCaptureStartInputProps extends Omit<React.ComponentProps<'div'>, 'children'> {
	readonly disabled?: boolean
	readonly mode: CameraCaptureStartInputMode
	readonly camera: DeepReadonly<Camera>
}

export function CameraCaptureStartInput({ mode, camera, color, disabled, className, ...props }: CameraCaptureStartInputProps) {
	const capture = useContext(CameraCaptureStoreContext)
	const { exposureTimeUnit, exposureTime, frameFormat, x, y, width, height, binX, binY, gain, offset, transferFormat, compressed } = useSnapshot(capture.state)
	const exposureTimeDisabled = !canExposureTime(mode)

	return (
		<div className={tw('flex flex-row flex-wrap items-center gap-2 p-2', className)} {...props}>
			<CameraExposureTimeInput
				className="min-w-0"
				disabled={disabled || exposureTimeDisabled}
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
			<FrameFormatSelect className="min-w-40" disabled={disabled || camera.frameFormats.length === 0} items={camera.frameFormats} onValueChange={capture.setFrameFormat} value={frameFormat} />
			<NumberInput className="max-w-25 min-w-0" disabled={disabled} label="X" maxValue={camera.frame.x.max} minValue={camera.frame.x.min} onValueChange={capture.setX} value={x} />
			<NumberInput className="max-w-25 min-w-0" disabled={disabled} label="Y" maxValue={camera.frame.y.max} minValue={camera.frame.y.min} onValueChange={capture.setY} value={y} />
			<NumberInput className="max-w-25 min-w-0" disabled={disabled} label="Width" maxValue={camera.frame.width.max} minValue={camera.frame.width.min} onValueChange={capture.setWidth} value={width} />
			<NumberInput className="max-w-25 min-w-0" disabled={disabled} label="Height" maxValue={camera.frame.height.max} minValue={camera.frame.height.min} onValueChange={capture.setHeight} value={height} />
			<NumberInput className="max-w-25 min-w-0" disabled={disabled} label="Bin X" maxValue={camera.bin.x.max} minValue={camera.bin.x.min} onValueChange={capture.setBinX} value={binX} />
			<NumberInput className="max-w-25 min-w-0" disabled={disabled} label="Bin Y" maxValue={camera.bin.y.max} minValue={camera.bin.y.min} onValueChange={capture.setBinY} value={binY} />
			<NumberInput className="max-w-25 min-w-0" disabled={disabled} label="Gain" maxValue={camera.gain.max} minValue={camera.gain.min} onValueChange={capture.setGain} value={gain} />
			<NumberInput className="max-w-25 min-w-0" disabled={disabled} label="Offset" maxValue={camera.offset.max} minValue={camera.offset.min} onValueChange={capture.setOffset} value={offset} />
			<CameraTransferFormatSelect className="min-w-40" disabled={disabled} onValueChange={capture.setTransferFormat} value={transferFormat} />
			<Checkbox className="min-w-0" disabled={disabled} label="Compressed" onValueChange={capture.setCompressed} value={compressed} />
		</div>
	)
}

function canExposureTime(mode: CameraCaptureStartInputMode) {
	return mode === 'capture' || mode === 'autoFocus' || mode === 'tppa' || mode === 'guider'
}
