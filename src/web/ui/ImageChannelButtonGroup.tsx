import { ButtonGroup, type ButtonGroupProps } from '@heroui/react'
import type { ImageChannel } from 'nebulosa/src/image.types'
import { TextButton } from './TextButton'

export interface ImageChannelButtonGroupProps extends Omit<ButtonGroupProps, 'children'> {
	readonly value?: ImageChannel
	readonly onValueChange: (value?: ImageChannel) => void
	readonly allowNoneSelection?: boolean
}

export function ImageChannelButtonGroup({ value, onValueChange, allowNoneSelection, ...props }: ImageChannelButtonGroupProps) {
	return (
		<ButtonGroup {...props}>
			{allowNoneSelection && <TextButton color='secondary' label='NONE' onPointerUp={() => onValueChange(undefined)} variant={value === undefined ? 'flat' : 'light'} />}
			<TextButton color='danger' label='RED' onPointerUp={() => onValueChange('RED')} variant={value === 'RED' ? 'flat' : 'light'} />
			<TextButton color='success' label='GREEN' onPointerUp={() => onValueChange('GREEN')} variant={value === 'GREEN' ? 'flat' : 'light'} />
			<TextButton color='primary' label='BLUE' onPointerUp={() => onValueChange('BLUE')} variant={value === 'BLUE' ? 'flat' : 'light'} />
		</ButtonGroup>
	)
}
