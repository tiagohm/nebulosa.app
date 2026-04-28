import type { ImageChannel } from 'nebulosa/src/image.types'
import { ButtonGroup, ButtonGroupItem, type ButtonGroupProps } from './components/ButtonGroup'

const NO_IMAGE_CHANNEL = 'NONE'

type ImageChannelButtonGroupValue = ImageChannel | 'NONE'

export interface ImageChannelButtonGroupProps extends Omit<ButtonGroupProps<ImageChannelButtonGroupValue>, 'children' | 'onValueChange' | 'value'> {
	readonly value?: ImageChannel
	readonly onValueChange: (value?: ImageChannel) => void
	readonly allowNoneSelection?: boolean
}

// Render the RGB channel segmented selector with optional empty selection.
export function ImageChannelButtonGroup({ value, onValueChange, allowNoneSelection, ...props }: ImageChannelButtonGroupProps) {
	// Maps the optional external channel value onto an explicit selectable item id.
	function handleValueChange(nextValue: ImageChannelButtonGroupValue) {
		onValueChange(nextValue === NO_IMAGE_CHANNEL ? undefined : nextValue)
	}

	return (
		<ButtonGroup {...props} color="secondary" onValueChange={handleValueChange} value={value ?? NO_IMAGE_CHANNEL}>
			{allowNoneSelection && <ButtonGroupItem id={NO_IMAGE_CHANNEL} label="NONE" />}
			<ButtonGroupItem color="danger" id="RED" label="RED" />
			<ButtonGroupItem color="success" id="GREEN" label="GREEN" />
			<ButtonGroupItem color="primary" id="BLUE" label="BLUE" />
		</ButtonGroup>
	)
}
