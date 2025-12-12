import { SelectItem } from '@heroui/react'
import type { TrackMode } from 'nebulosa/src/indi.device'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export interface TrackModeSelectProps extends Omit<EnumSelectProps<TrackMode>, 'children'> {
	readonly modes: readonly TrackMode[]
}

export function TrackModeSelect({ modes, isDisabled, label = 'Tracking Mode', ...props }: TrackModeSelectProps) {
	return (
		<EnumSelect {...props} isDisabled={isDisabled || !modes.length} label={label}>
			{modes.map((mode) => (
				<SelectItem key={mode}>{mode}</SelectItem>
			))}
		</EnumSelect>
	)
}
