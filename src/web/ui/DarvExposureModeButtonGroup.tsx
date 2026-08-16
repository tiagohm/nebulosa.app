import { ButtonGroup, ButtonGroupItem } from '@ui/components/ButtonGroup'
import type { ButtonGroupProps } from '@ui/components/ButtonGroup'
import type { DarvExposureMode } from 'nebulosa/src/observation/alignment/polaralignment.darv'

export function DarvExposureModeButtonGroup(props: Omit<ButtonGroupProps<DarvExposureMode>, 'children'>) {
	return (
		<ButtonGroup {...props}>
			<ButtonGroupItem id="azimuth" label="Azimuth" />
			<ButtonGroupItem id="altitude" label="Altitude" />
		</ButtonGroup>
	)
}
