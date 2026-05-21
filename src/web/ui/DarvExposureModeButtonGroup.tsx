import type { DarvExposureMode } from 'nebulosa/src/polaralignment'
import { ButtonGroup, ButtonGroupItem, type ButtonGroupProps } from './components/ButtonGroup'

export function DarvExposureModeButtonGroup(props: Omit<ButtonGroupProps<DarvExposureMode>, 'children'>) {
	return (
		<ButtonGroup {...props}>
			<ButtonGroupItem id="azimuth" label="Azimuth" />
			<ButtonGroupItem id="altitude" label="Altitude" />
		</ButtonGroup>
	)
}
