import type { DarvExposurePresetType } from 'nebulosa/src/polaralignment'
import { ButtonGroup, ButtonGroupItem, type ButtonGroupProps } from './components/ButtonGroup'

export function DarvExposurePresetTypeButtonGroup(props: Omit<ButtonGroupProps<'custom' | DarvExposurePresetType>, 'children'>) {
	return (
		<ButtonGroup {...props}>
			<ButtonGroupItem id="coarse" label="Coarse" />
			<ButtonGroupItem id="medium" label="Medium" />
			<ButtonGroupItem id="fine" label="Fine" />
			<ButtonGroupItem id="custom" label="Custom" />
		</ButtonGroup>
	)
}
