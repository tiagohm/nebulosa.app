import type { StarDetection } from 'src/shared/types'
import { NumberInput } from './components/NumberInput'
import { Popover } from './components/Popover'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface StarDetectionPopoverProps extends Omit<IconButtonProps, 'icon' | 'value' | 'onValueChange'> {
	readonly value: StarDetection
	readonly onValueChange: <K extends keyof StarDetection>(key: K, value: StarDetection[K]) => void
}

export function StarDetectionPopover({ value: { type, executable, minSNR, maxStars }, onValueChange, ...props }: StarDetectionPopoverProps) {
	return (
		<Popover trigger={<IconButton content="Star Detection" icon={Icons.Cog} {...props} />}>
			<div className="grid max-w-80 grid-cols-2 items-center gap-2 p-4">
				<p className="col-span-full font-bold">STAR DETECTION OPTIONS</p>
				<TextInput className="col-span-full" disabled={type === 'NEBULOSA'} label="Executable path" onValueChange={(value) => onValueChange('executable', value)} value={executable} />
				<NumberInput className="col-span-1" label="Min SNR" maxValue={500} minValue={0} onValueChange={(value) => onValueChange('minSNR', value)} value={minSNR} />
				<NumberInput className="col-span-1" label="Max Stars" maxValue={2000} minValue={0} onValueChange={(value) => onValueChange('maxStars', value)} value={maxStars} />
			</div>
		</Popover>
	)
}
