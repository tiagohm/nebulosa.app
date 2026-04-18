import { ButtonGroup, type ButtonGroupProps } from '@heroui/react'
import type { ImageFormat } from 'nebulosa/src/image.types'
import { Button } from './components/Button'

export interface ImageFormatButtonGroupProps extends ButtonGroupProps {
	readonly value: ImageFormat
	readonly onValueChange: (value: ImageFormat) => void
}

export function ImageFormatButtonGroup({ value, onValueChange, ...props }: ImageFormatButtonGroupProps) {
	return (
		<ButtonGroup {...props}>
			<Button color='secondary' label='FITS' onPointerUp={() => onValueChange('fits')} size='sm' variant={value === 'fits' ? 'flat' : 'ghost'} />
			<Button color='secondary' label='XISF' onPointerUp={() => onValueChange('xisf')} size='sm' variant={value === 'xisf' ? 'flat' : 'ghost'} />
			<Button color='secondary' label='JPEG' onPointerUp={() => onValueChange('jpeg')} size='sm' variant={value === 'jpeg' ? 'flat' : 'ghost'} />
		</ButtonGroup>
	)
}
