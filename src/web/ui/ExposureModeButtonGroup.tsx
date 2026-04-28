import type { ExposureMode } from 'src/shared/types'
import { ButtonGroup, ButtonGroupItem, type ButtonGroupProps } from './components/ButtonGroup'

export type ExposureModeButtonGroupProps = Omit<ButtonGroupProps<ExposureMode>, 'children'>

// Render the exposure mode segmented selector.
export function ExposureModeButtonGroup({ value, onValueChange, color = 'primary', ...props }: ExposureModeButtonGroupProps) {
	return (
		<ButtonGroup {...props} color={color} onValueChange={onValueChange} value={value}>
			<ButtonGroupItem id="SINGLE" label="Single" />
			<ButtonGroupItem id="FIXED" label="Fixed" />
			<ButtonGroupItem id="LOOP" label="Loop" />
		</ButtonGroup>
	)
}
