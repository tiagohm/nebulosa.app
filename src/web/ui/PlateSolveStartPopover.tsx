import { NumberInput, Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import type { PlateSolveStart } from 'src/shared/types'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

export type PlateSolveStartPopoverKey = 'radius' | 'focalLength' | 'pixelSize'

export interface PlateSolveStartPopoverProps extends Pick<PlateSolveStart, PlateSolveStartPopoverKey> {
	readonly onValueChange?: (key: PlateSolveStartPopoverKey, value: number) => void
}

export function PlateSolveStartPopover({ radius, focalLength, pixelSize, onValueChange }: PlateSolveStartPopoverProps) {
	return (
		<Popover className='max-w-110' placement='bottom' showArrow={true}>
			<PopoverTrigger>
				<IconButton icon={Icons.Cog} />
			</PopoverTrigger>
			<PopoverContent>
				<div className='grid grid-cols-12 gap-2 p-4'>
					<NumberInput className='col-span-3' formatOptions={DECIMAL_NUMBER_FORMAT} label='Radius (°)' maxValue={360} minValue={0} onValueChange={(value) => onValueChange?.('radius', value)} size='sm' step={0.1} value={radius ?? 4} />
					<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} label='Focal Length (mm)' maxValue={100000} minValue={0} onValueChange={(value) => onValueChange?.('focalLength', value)} size='sm' value={focalLength} />
					<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} label='Pixel size (µm)' maxValue={1000} minValue={0} onValueChange={(value) => onValueChange?.('pixelSize', value)} size='sm' step={0.01} value={pixelSize} />
				</div>
			</PopoverContent>
		</Popover>
	)
}
