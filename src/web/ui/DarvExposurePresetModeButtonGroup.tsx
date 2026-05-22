import type { DarvExposurePresetMode } from 'nebulosa/src/polaralignment'
import { ButtonGroup, ButtonGroupItem, type ButtonGroupProps } from './components/ButtonGroup'

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
