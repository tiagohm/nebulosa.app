import { IconButton } from '@ui/components/IconButton'
import type { IconButtonProps } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Popover } from '@ui/components/Popover'
import { TextInput } from '@ui/components/TextInput'
import { Icons } from '@ui/Icon'
import type { StarDetection } from 'src/types/stardetection'

export interface StarDetectionPopoverProps extends Omit<IconButtonProps, 'icon' | 'value' | 'onValueChange'>, Pick<StarDetection, 'type' | 'executable' | 'minSNR' | 'maxStars'> {
	readonly onExecutableChange: (value: string) => void
	readonly onMinSNRChange: (value: number) => void
	readonly onMaxStarsChange: (value: number) => void
}

export function StarDetectionPopover({ disabled = false, tooltipContent = 'Star Detection options', type, executable, minSNR, maxStars, onExecutableChange, onMinSNRChange, onMaxStarsChange, ...props }: StarDetectionPopoverProps) {
	return (
		<Popover disabled={disabled} trigger={<IconButton disabled={disabled} icon={Icons.Cog} tooltipContent={tooltipContent} size="sm" {...props} />}>
			<div className="grid max-w-80 grid-cols-2 items-center gap-2 p-4">
				<p className="col-span-full font-bold">STAR DETECTION OPTIONS</p>
				<TextInput className="col-span-full" disabled={disabled || type === 'nebulosa'} label="Executable path" onValueChange={onExecutableChange} value={executable} />
				<NumberInput className="col-span-1" disabled={disabled} label="Min SNR" maxValue={500} minValue={0} onValueChange={onMinSNRChange} value={minSNR} />
				<NumberInput className="col-span-1" disabled={disabled} label="Max Stars" maxValue={2000} minValue={0} onValueChange={onMaxStarsChange} value={maxStars} />
			</div>
		</Popover>
	)
}
