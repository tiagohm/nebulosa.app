import type { ImageFormat } from 'nebulosa/src/image.types'
import { ButtonGroup, ButtonGroupItem, type ButtonGroupProps } from './components/ButtonGroup'

export type ImageFormatButtonGroupProps = Omit<ButtonGroupProps<ImageFormat>, 'children'>

// Render the image format segmented selector.
export function ImageFormatButtonGroup({ value, onValueChange, ...props }: ImageFormatButtonGroupProps) {
	return (
		<ButtonGroup {...props} color="secondary" onValueChange={onValueChange} value={value}>
			<ButtonGroupItem id="fits" label="FITS" />
			<ButtonGroupItem id="xisf" label="XISF" />
			<ButtonGroupItem id="jpeg" label="JPEG" />
		</ButtonGroup>
	)
}
