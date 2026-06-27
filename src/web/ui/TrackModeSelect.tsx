import type { TrackMode } from 'nebulosa/src/devices/indi/device'
import { Select, type SelectProps } from './components/Select'

export interface TrackModeSelectProps extends Omit<SelectProps<TrackMode>, 'children' | 'items'> {
	readonly modes: readonly TrackMode[]
}

function TrackModeItem(mode: TrackMode) {
	return <span>{mode === 'SIDEREAL' ? 'Sidereal' : mode === 'SOLAR' ? 'Solar' : mode === 'LUNAR' ? 'Lunar' : mode === 'KING' ? 'King' : 'Custom'}</span>
}

export function TrackModeSelect({ disabled, label = 'Tracking Mode', modes, ...props }: TrackModeSelectProps) {
	return (
		<Select disabled={disabled || modes.length === 0} items={modes} label={label} {...props}>
			{TrackModeItem}
		</Select>
	)
}
