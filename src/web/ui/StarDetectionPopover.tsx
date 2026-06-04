import type { StarDetection } from 'src/shared/types'
import { IconButton, type IconButtonProps } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { Popover } from './components/Popover'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'

export interface StarDetectionPopoverProps extends Omit<IconButtonProps, 'icon' | 'value' | 'onValueChange'> {
	readonly value: StarDetection
	readonly onValueChange: <K extends keyof StarDetection>(key: K, value: StarDetection[K]) => void
}

export function StarDetectionPopover({ disabled = false, tooltipContent = 'Star Detection options', value: { type, executable, minSNR, maxStars }, onValueChange, ...props }: StarDetectionPopoverProps) {
	return (
		<Popover disabled={disabled} trigger={<IconButton disabled={disabled} icon={Icons.Cog} tooltipContent={tooltipContent} size="sm" {...props} />}>
			<div className="grid max-w-80 grid-cols-2 items-center gap-2 p-4">
				<p className="col-span-full font-bold">STAR DETECTION OPTIONS</p>
				<TextInput className="col-span-full" disabled={disabled || type === 'nebulosa'} label="Executable path" onValueChange={(value) => onValueChange('executable', value)} value={executable} />
				<NumberInput className="col-span-1" disabled={disabled} label="Min SNR" maxValue={500} minValue={0} onValueChange={(value) => onValueChange('minSNR', value)} value={minSNR} />
				<NumberInput className="col-span-1" disabled={disabled} label="Max Stars" maxValue={2000} minValue={0} onValueChange={(value) => onValueChange('maxStars', value)} value={maxStars} />
			</div>
		</Popover>
	)
}
