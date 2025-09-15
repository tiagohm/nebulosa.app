import { NumberInput, Popover, PopoverContent, PopoverTrigger, SelectItem } from '@heroui/react'
import type { CameraCaptureStart } from 'src/shared/types'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { EnumSelect } from './EnumSelect'
import { ExposureTimeInput } from './ExposureTimeInput'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export type CameraCaptureStartPopoverKey = 'exposureTime' | 'exposureTimeUnit' | 'binX' | 'binY' | 'gain' | 'offset' | 'frameFormat'

export interface CameraCaptureStartPopoverProps extends Pick<CameraCaptureStart, CameraCaptureStartPopoverKey>, Omit<IconButtonProps, 'icon'> {
	readonly minExposure: number
	readonly maxExposure: number
	readonly maxBin: number
	readonly maxGain: number
	readonly maxOffset: number
	readonly frameFormats: readonly string[]
	readonly onValueChange?: <K extends CameraCaptureStartPopoverKey>(key: K, value: CameraCaptureStart[K]) => void
}

export function CameraCaptureStartPopover({ maxExposure, minExposure, exposureTime, exposureTimeUnit, binX, binY, maxBin, gain, maxGain, offset, maxOffset, frameFormat, frameFormats, onValueChange, ...props }: CameraCaptureStartPopoverProps) {
	return (
		<Popover className='max-w-110' placement='bottom' showArrow>
			<PopoverTrigger>
				<IconButton {...props} icon={Icons.Cog} />
			</PopoverTrigger>
			<PopoverContent>
				<div className='grid grid-cols-12 gap-2 p-4'>
					<p className='col-span-full font-bold'>CAMERA CAPTURE OPTIONS</p>
					<ExposureTimeInput
						className='col-span-6'
						maxValue={maxExposure}
						maxValueUnit='SECOND'
						minValue={minExposure}
						minValueUnit='SECOND'
						onUnitChange={(value) => onValueChange?.('exposureTimeUnit', value)}
						onValueChange={(value) => onValueChange?.('exposureTime', value)}
						unit={exposureTimeUnit}
						value={exposureTime}
					/>
					<EnumSelect className='col-span-6' isDisabled={!frameFormats.length} label='Format' onValueChange={(value) => onValueChange?.('frameFormat', value)} value={frameFormat}>
						{frameFormats.map((format) => (
							<SelectItem key={format}>{format}</SelectItem>
						))}
					</EnumSelect>
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Bin X' maxValue={maxBin} minValue={1} onValueChange={(value) => onValueChange?.('binX', value)} size='sm' value={binX} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Bin Y' maxValue={maxBin} minValue={1} onValueChange={(value) => onValueChange?.('binY', value)} size='sm' value={binY} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Gain' maxValue={maxGain} minValue={0} onValueChange={(value) => onValueChange?.('gain', value)} size='sm' value={gain} />
					<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} label='Offset' maxValue={maxOffset} minValue={0} onValueChange={(value) => onValueChange?.('offset', value)} size='sm' value={offset} />
				</div>
			</PopoverContent>
		</Popover>
	)
}
