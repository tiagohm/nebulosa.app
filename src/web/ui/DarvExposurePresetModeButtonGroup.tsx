import { ButtonGroup, ButtonGroupItem } from '@ui/components/ButtonGroup'
import type { ButtonGroupProps } from '@ui/components/ButtonGroup'
import type { DarvExposurePresetMode } from 'nebulosa/src/observation/alignment/polaralignment.darv'

export function DarvExposurePresetModeButtonGroup(props: Omit<ButtonGroupProps<'custom' | DarvExposurePresetMode>, 'children'>) {
	return (
		<ButtonGroup {...props}>
			<ButtonGroupItem id="coarse" label="Coarse" />
			<ButtonGroupItem id="medium" label="Medium" />
			<ButtonGroupItem id="fine" label="Fine" />
			<ButtonGroupItem id="custom" label="Custom" />
		</ButtonGroup>
	)
}
