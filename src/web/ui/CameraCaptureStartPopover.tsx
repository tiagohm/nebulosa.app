import { NumberInput, Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import type { CameraCaptureStart } from 'src/shared/types'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { ExposureTimeInput } from './ExposureTimeInput'
import { FrameFormatSelect } from './FrameFormatSelect'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export type CameraCaptureStartPopoverKey = 'exposureTime' | 'exposureTimeUnit' | 'binX' | 'binY' | 'gain' | 'offset' | 'frameFormat'

export type CameraCaptureStartPopoverMode = 'capture' | 'autoFocus' | 'flatWizard' | 'darv' | 'tppa'

export interface CameraCaptureStartPopoverProps extends Omit<IconButtonProps, 'icon' | 'value' | 'onValueChange'> {
	readonly mode: CameraCaptureStartPopoverMode
	readonly value: Pick<CameraCaptureStart, CameraCaptureStartPopoverKey>
	readonly minExposure: number
	readonly maxExposure: number
	readonly maxBin: number
	readonly maxGain: number
	readonly maxOffset: number
	readonly frameFormats: readonly string[]
	readonly onValueChange: <K extends CameraCaptureStartPopoverKey>(key: K, value: CameraCaptureStart[K]) => void
}

function canExposureTime(mode: CameraCaptureStartPopoverMode) {
	return mode === 'capture' || mode === 'autoFocus' || mode === 'tppa'
}

export function CameraCaptureStartPopover({ mode, maxExposure, minExposure, maxBin, maxGain, maxOffset, frameFormats, value: { exposureTime, exposureTimeUnit, binX, binY, gain, offset, frameFormat }, onValueChange, ...props }: CameraCaptureStartPopoverProps) {
	const exposureTimeDisabled = !canExposureTime(mode)

	return (
		<Popover className='max-w-110' placement='bottom' showArrow>
			<PopoverTrigger>
				<IconButton {...props} icon={Icons.Cog} />
			</PopoverTrigger>
			<PopoverContent>
				<div className='grid grid-cols-12 items-center gap-2 p-4'>
					<p className='col-span-full font-bold'>CAMERA CAPTURE OPTIONS</p>
					<ExposureTimeInput
						className='col-span-6'
						isDisabled={exposureTimeDisabled}
						maxValue={maxExposure}
						maxValueUnit='SECOND'
						minValue={minExposure}
						minValueUnit='SECOND'
						onUnitChange={(value) => onValueChange('exposureTimeUnit', value)}
						onValueChange={(value) => onValueChange('exposureTime', value)}
						unit={exposureTimeUnit}
						value={exposureTimeDisabled ? 0 : exposureTime}
					/>
					<FrameFormatSelect className='col-span-6' isDisabled={!frameFormats.length} items={frameFormats} onValueChange={(value) => onValueChange('frameFormat', value)} value={frameFormat} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Bin X' maxValue={maxBin} minValue={1} onValueChange={(value) => onValueChange('binX', value)} size='sm' value={binX} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Bin Y' maxValue={maxBin} minValue={1} onValueChange={(value) => onValueChange('binY', value)} size='sm' value={binY} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Gain' maxValue={maxGain} minValue={0} onValueChange={(value) => onValueChange('gain', value)} size='sm' value={gain} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Offset' maxValue={maxOffset} minValue={0} onValueChange={(value) => onValueChange('offset', value)} size='sm' value={offset} />
				</div>
			</PopoverContent>
		</Popover>
	)
}
