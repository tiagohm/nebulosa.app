import { NumberInput, Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import type { Camera } from 'nebulosa/src/indi.device'
import type { CameraCaptureStart } from 'src/shared/types'
import type { DeepReadonly } from 'utility-types'
import { DEFAULT_POPOVER_PROPS, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameFormatSelect } from './FrameFormatSelect'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export type CameraCaptureStartPopoverKey = 'exposureTime' | 'exposureTimeUnit' | 'binX' | 'binY' | 'gain' | 'offset' | 'frameFormat' | 'x' | 'y' | 'width' | 'height'

export type CameraCaptureStartPopoverMode = 'capture' | 'autoFocus' | 'flatWizard' | 'darv' | 'tppa'

export interface CameraCaptureStartPopoverProps extends Omit<IconButtonProps, 'icon' | 'value' | 'onValueChange'> {
	readonly mode: CameraCaptureStartPopoverMode
	readonly value: Pick<CameraCaptureStart, CameraCaptureStartPopoverKey>
	readonly camera: DeepReadonly<Camera>
	readonly onValueChange: <K extends CameraCaptureStartPopoverKey>(key: K, value: CameraCaptureStart[K]) => void
}

function canExposureTime(mode: CameraCaptureStartPopoverMode) {
	return mode === 'capture' || mode === 'autoFocus' || mode === 'tppa'
}

export function CameraCaptureStartPopover({ mode, camera, color, isDisabled, value: { exposureTime, exposureTimeUnit, binX, binY, gain, offset, x, y, width, height, frameFormat }, onValueChange, ...props }: CameraCaptureStartPopoverProps) {
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
						isDisabled={exposureTimeDisabled}
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
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='X' maxValue={camera.frame.x.max} minValue={camera.frame.x.min} onValueChange={(value) => onValueChange('x', value)} size='sm' value={x} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Y' maxValue={camera.frame.y.max} minValue={camera.frame.y.min} onValueChange={(value) => onValueChange('y', value)} size='sm' value={y} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Width' maxValue={camera.frame.width.max} minValue={camera.frame.width.min} onValueChange={(value) => onValueChange('width', value)} size='sm' value={width} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Height' maxValue={camera.frame.height.max} minValue={camera.frame.height.min} onValueChange={(value) => onValueChange('height', value)} size='sm' value={height} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Bin X' maxValue={camera.bin.x.max} minValue={camera.bin.x.min} onValueChange={(value) => onValueChange('binX', value)} size='sm' value={binX} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Bin Y' maxValue={camera.bin.y.max} minValue={camera.bin.y.min} onValueChange={(value) => onValueChange('binY', value)} size='sm' value={binY} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Gain' maxValue={camera.gain.max} minValue={camera.gain.min} onValueChange={(value) => onValueChange('gain', value)} size='sm' value={gain} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Offset' maxValue={camera.offset.max} minValue={camera.offset.min} onValueChange={(value) => onValueChange('offset', value)} size='sm' value={offset} />
				</div>
			</PopoverContent>
		</Popover>
	)
}
