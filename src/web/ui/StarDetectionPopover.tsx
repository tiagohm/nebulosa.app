import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
import type { StarDetection } from 'src/shared/types'
import { DEFAULT_POPOVER_PROPS } from '@/shared/constants'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface StarDetectionPopoverProps extends Omit<IconButtonProps, 'icon' | 'value' | 'onValueChange'> {
	readonly value: StarDetection
	readonly onValueChange: <K extends keyof StarDetection>(key: K, value: StarDetection[K]) => void
}

export function StarDetectionPopover({ value: { type, executable, minSNR, maxStars }, onValueChange, ...props }: StarDetectionPopoverProps) {
	return (
		<Popover {...DEFAULT_POPOVER_PROPS}>
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
					<TextInput className='col-span-full' disabled={type === 'NEBULOSA'} label='Executable path' onValueChange={(value) => onValueChange('executable', value)} value={executable} />
					<NumberInput className='col-span-1' label='Min SNR' maxValue={500} minValue={0} onValueChange={(value) => onValueChange('minSNR', value)} value={minSNR} />
					<NumberInput className='col-span-1' label='Max Stars' maxValue={2000} minValue={0} onValueChange={(value) => onValueChange('maxStars', value)} value={maxStars} />
				</div>
			</PopoverContent>
		</Popover>
	)
}
