import { ButtonGroup, ButtonGroupItem } from '@ui/components/ButtonGroup'
import type { ButtonGroupProps } from '@ui/components/ButtonGroup'
import type { ImageFormat } from 'nebulosa/src/imaging/model/types'

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
