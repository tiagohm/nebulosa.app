import { ButtonGroup, type ButtonGroupProps } from '@heroui/react'
import type { ImageChannel } from 'nebulosa/src/image.types'
import { Button } from './components/Button'

export interface ImageChannelButtonGroupProps extends Omit<ButtonGroupProps, 'children'> {
	readonly value?: ImageChannel
	readonly onValueChange: (value?: ImageChannel) => void
	readonly allowNoneSelection?: boolean
}

export function ImageChannelButtonGroup({ value, onValueChange, allowNoneSelection, ...props }: ImageChannelButtonGroupProps) {
	return (
		<ButtonGroup {...props}>
			{allowNoneSelection && <Button color="secondary" label="NONE" onPointerUp={() => onValueChange(undefined)} variant={value === undefined ? 'flat' : 'ghost'} />}
			<Button color="danger" label="RED" onPointerUp={() => onValueChange('RED')} variant={value === 'RED' ? 'flat' : 'ghost'} />
			<Button color="success" label="GREEN" onPointerUp={() => onValueChange('GREEN')} variant={value === 'GREEN' ? 'flat' : 'ghost'} />
			<Button color="primary" label="BLUE" onPointerUp={() => onValueChange('BLUE')} variant={value === 'BLUE' ? 'flat' : 'ghost'} />
		</ButtonGroup>
	)
}
