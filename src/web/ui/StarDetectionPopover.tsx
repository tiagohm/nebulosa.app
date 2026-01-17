import { Input, NumberInput, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
import type { StarDetection } from 'src/shared/types'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface StarDetectionPopoverProps extends Omit<IconButtonProps, 'icon' | 'value' | 'onValueChange'> {
	readonly value: StarDetection
	readonly onValueChange: <K extends keyof StarDetection>(key: K, value: StarDetection[K]) => void
}

export function StarDetectionPopover({ value: { executable, minSNR, maxStars }, onValueChange, ...props }: StarDetectionPopoverProps) {
	return (
		<Popover placement='bottom' showArrow>
			<Tooltip content='Star Detection' placement='bottom' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton {...props} icon={Icons.Cog} />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<div className='grid grid-cols-2 items-center gap-2 p-4 max-w-80'>
					<p className='col-span-full font-bold'>STAR DETECTION OPTIONS</p>
					<Input className='col-span-full' label='Executable path' onValueChange={(value) => onValueChange('executable', value)} size='sm' value={executable} />
					<NumberInput className='col-span-1' formatOptions={INTEGER_NUMBER_FORMAT} label='Min SNR' maxValue={500} minValue={0} onValueChange={(value) => onValueChange('minSNR', value)} size='sm' value={minSNR} />
					<NumberInput className='col-span-1' formatOptions={INTEGER_NUMBER_FORMAT} label='Max Stars' maxValue={2000} minValue={0} onValueChange={(value) => onValueChange('maxStars', value)} size='sm' value={maxStars} />
				</div>
			</PopoverContent>
		</Popover>
	)
}
