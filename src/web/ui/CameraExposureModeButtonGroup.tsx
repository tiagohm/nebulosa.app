import { ButtonGroup, ButtonGroupItem } from '@ui/components/ButtonGroup'
import type { ButtonGroupProps } from '@ui/components/ButtonGroup'
import type { CameraExposureMode } from 'src/types/camera'

export type CameraExposureModeButtonGroupProps = Omit<ButtonGroupProps<CameraExposureMode>, 'children'>

// Render the exposure mode segmented selector.
export function CameraExposureModeButtonGroup({ value, onValueChange, color = 'primary', ...props }: CameraExposureModeButtonGroupProps) {
	return (
		<ButtonGroup {...props} color={color} onValueChange={onValueChange} value={value}>
			<ButtonGroupItem id="single" label="Single" />
			<ButtonGroupItem id="fixed" label="Fixed" />
			<ButtonGroupItem id="loop" label="Loop" />
		</ButtonGroup>
	)
}
