import { Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import type { Camera } from 'nebulosa/src/indi.device'
import type { DeepReadonly } from 'nebulosa/src/types'
import type { CameraCaptureStart } from 'src/shared/types'
import { DEFAULT_POPOVER_PROPS } from '@/shared/constants'
import { CameraTransferFormatSelect } from './CameraTransferFormatSelect'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameFormatSelect } from './FrameFormatSelect'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export type CameraCaptureStartPopoverKey = 'exposureTime' | 'exposureTimeUnit' | 'binX' | 'binY' | 'gain' | 'offset' | 'frameFormat' | 'x' | 'y' | 'width' | 'height' | 'transferFormat' | 'compressed'

export type CameraCaptureStartPopoverMode = 'capture' | 'autoFocus' | 'flatWizard' | 'darv' | 'tppa' | 'guider'

export interface CameraCaptureStartPopoverProps extends Omit<IconButtonProps, 'icon' | 'value' | 'onValueChange'> {
	readonly mode: CameraCaptureStartPopoverMode
	readonly value: Pick<CameraCaptureStart, CameraCaptureStartPopoverKey>
	readonly camera: DeepReadonly<Camera>
	readonly onValueChange: <K extends CameraCaptureStartPopoverKey>(key: K, value: CameraCaptureStart[K]) => void
}

function canExposureTime(mode: CameraCaptureStartPopoverMode) {
	return mode === 'capture' || mode === 'autoFocus' || mode === 'tppa'
}

export function CameraCaptureStartPopover({ mode, camera, color, isDisabled, value: { exposureTime, exposureTimeUnit, binX, binY, gain, offset, x, y, width, height, frameFormat, transferFormat, compressed }, onValueChange, ...props }: CameraCaptureStartPopoverProps) {
	const exposureTimeDisabled = !canExposureTime(mode)

	return (
		<Popover className='max-w-110' {...DEFAULT_POPOVER_PROPS}>
			<PopoverTrigger>
				<IconButton {...props} color={color ?? (camera.connected ? 'success' : 'danger')} icon={Icons.Cog} isDisabled={isDisabled || !camera.connected} />
			</PopoverTrigger>
			<PopoverContent>
				<div className='grid grid-cols-12 items-center gap-2 p-4'>
					<p className='col-span-full font-bold'>CAMERA CAPTURE OPTIONS</p>
					<ExposureTimeInput
						className='col-span-6'
						disabled={exposureTimeDisabled}
						maxValue={camera.exposure.max}
						maxValueUnit='SECOND'
						minValue={exposureTimeDisabled ? 0 : camera.exposure.min}
						minValueUnit='SECOND'
						onUnitChange={(value) => onValueChange('exposureTimeUnit', value)}
						onValueChange={(value) => onValueChange('exposureTime', value)}
						unit={exposureTimeUnit}
						value={exposureTimeDisabled ? 0 : exposureTime}
					/>
					<FrameFormatSelect className='col-span-6' isDisabled={!camera.frameFormats.length} items={camera.frameFormats} onValueChange={(value) => onValueChange('frameFormat', value)} value={frameFormat} />
					<NumberInput className='col-span-3' label='X' maxValue={camera.frame.x.max} minValue={camera.frame.x.min} onValueChange={(value) => onValueChange('x', value)} value={x} />
					<NumberInput className='col-span-3' label='Y' maxValue={camera.frame.y.max} minValue={camera.frame.y.min} onValueChange={(value) => onValueChange('y', value)} value={y} />
					<NumberInput className='col-span-3' label='Width' maxValue={camera.frame.width.max} minValue={camera.frame.width.min} onValueChange={(value) => onValueChange('width', value)} value={width} />
					<NumberInput className='col-span-3' label='Height' maxValue={camera.frame.height.max} minValue={camera.frame.height.min} onValueChange={(value) => onValueChange('height', value)} value={height} />
					<NumberInput className='col-span-3' label='Bin X' maxValue={camera.bin.x.max} minValue={camera.bin.x.min} onValueChange={(value) => onValueChange('binX', value)} value={binX} />
					<NumberInput className='col-span-3' label='Bin Y' maxValue={camera.bin.y.max} minValue={camera.bin.y.min} onValueChange={(value) => onValueChange('binY', value)} value={binY} />
					<NumberInput className='col-span-3' label='Gain' maxValue={camera.gain.max} minValue={camera.gain.min} onValueChange={(value) => onValueChange('gain', value)} value={gain} />
					<NumberInput className='col-span-3' label='Offset' maxValue={camera.offset.max} minValue={camera.offset.min} onValueChange={(value) => onValueChange('offset', value)} value={offset} />
					<CameraTransferFormatSelect className='col-span-6' onValueChange={(value) => onValueChange('transferFormat', value)} value={transferFormat} />
					<Checkbox className='col-span-6' label='Compressed' onValueChange={(value) => onValueChange('compressed', value)} value={compressed} />
				</div>
			</PopoverContent>
		</Popover>
	)
}
