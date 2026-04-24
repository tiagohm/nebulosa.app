import type { TrackMode } from 'nebulosa/src/indi.device'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

export interface TrackModeSelectProps extends Omit<SelectProps<TrackMode>, 'children' | 'items'> {
	readonly modes: readonly TrackMode[]
}

const TrackModeItem: SelectItemRenderer<TrackMode> = (mode) => <span>{mode}</span>

export function TrackModeSelect({ disabled, label = 'Tracking Mode', modes, ...props }: TrackModeSelectProps) {
	return (
		<Select disabled={disabled || modes.length === 0} items={modes} label={label} {...props}>
			{TrackModeItem}
		</Select>
	)
}
